import type { FileSystem } from '../host';
import { uuid } from '../id';
import type { Answer, Assignment, AssignmentStatus, ResponseSet } from '../schemas';
import { classifyOutcome, recordOutcomes } from './askLedger';
import { getAssignment, getAssignmentSnapshot, updateAssignmentStatus } from './assignmentService';
import { captureResponseFeedback } from './profileFeedback';
import { getResponse, saveResponse } from './responseService';

/**
 * The **recipient's** answer lifecycle for an in-app (household) assignment (08-questionnaires §3.3):
 * open → save progress (resume later) → submit, or decline (silently or with a short note). Editable
 * until submit, then locked. Raw answers stay encrypted in the send folder and never feed the coach
 * directly — analysis (§13.4) derives an Insight from a submitted ResponseSet.
 *
 * Authorization (is the active person the recipient? does the role allow `questionnaires.answer`?) is
 * enforced one layer up in the bridge; these services own the storage + status transitions.
 */

/** Statuses where the recipient can still open / answer / decline. After these, the send is locked. */
const ANSWERABLE_STATUSES: ReadonlySet<AssignmentStatus> = new Set<AssignmentStatus>([
  'sent',
  'opened',
  'inProgress',
]);

/** Statuses a recipient can RE-OPEN to edit + resubmit (56-answer-review-edit §3.1): a submitted send, or one
 *  the sender already analyzed. Re-opening keeps the existing answers + revision; the next submit bumps it. */
const REOPENABLE_STATUSES: ReadonlySet<AssignmentStatus> = new Set<AssignmentStatus>([
  'submitted',
  'analyzed',
]);

/** Whether the recipient can still act on an assignment in this status. */
export function isAnswerable(status: AssignmentStatus): boolean {
  return ANSWERABLE_STATUSES.has(status);
}

/** Whether the recipient can re-open a submitted assignment to edit + resubmit (56 §3.1). */
export function isReopenable(status: AssignmentStatus): boolean {
  return REOPENABLE_STATUSES.has(status);
}

/** Read an answerable assignment or throw — the shared guard for every recipient mutation. */
async function requireAnswerable(
  fs: FileSystem,
  key: Uint8Array,
  assignmentId: string,
): Promise<Assignment> {
  const assignment = await getAssignment(fs, key, assignmentId);
  if (!assignment) throw new Error(`Assignment not found: ${assignmentId}`);
  if (!isAnswerable(assignment.status)) {
    throw new Error('This questionnaire can no longer be answered.');
  }
  return assignment;
}

/** Mark a freshly-sent assignment as opened (idempotent — only `sent` transitions). */
export async function openAssignment(
  fs: FileSystem,
  key: Uint8Array,
  assignmentId: string,
): Promise<Assignment> {
  const assignment = await getAssignment(fs, key, assignmentId);
  if (!assignment) throw new Error(`Assignment not found: ${assignmentId}`);
  if (assignment.status !== 'sent') return assignment;
  return updateAssignmentStatus(fs, key, assignmentId, 'opened');
}

/**
 * Persist a **draft** (unsubmitted) ResponseSet so the recipient can resume later, and move the
 * assignment to `inProgress`. The ResponseSet id is stable across saves/resume/submit (reused from any
 * existing draft), so the eventual submit keeps the same identity.
 */
export async function saveProgress(
  fs: FileSystem,
  key: Uint8Array,
  input: { assignmentId: string; answers: Answer[] },
): Promise<ResponseSet> {
  await requireAnswerable(fs, key, input.assignmentId);
  const existing = await getResponse(fs, key, input.assignmentId);
  const draft: ResponseSet = {
    id: existing?.id ?? uuid(),
    schemaVersion: 1,
    assignmentId: input.assignmentId,
    answers: input.answers,
    ...(existing?.reAskOf !== undefined ? { reAskOf: existing.reAskOf } : {}),
    // Carry the last-submitted revision forward while editing (56 §5) — a draft is unsubmitted (no
    // `submittedAt`), but the resubmit must know the prior revision to increment it.
    ...(existing?.revision !== undefined ? { revision: existing.revision } : {}),
    // no `submittedAt` — a draft is unsubmitted; the assignment status carries the lifecycle
  };
  await saveResponse(fs, key, draft);
  await updateAssignmentStatus(fs, key, input.assignmentId, 'inProgress');
  return draft;
}

/**
 * Re-open a submitted (or already-analyzed) assignment so the recipient can edit + resend (56 §3.1). Moves the
 * status back to `inProgress`, keeping the existing ResponseSet (answers + `submittedAt` + `revision`) intact —
 * the next `submitResponse` bumps the revision, which is how the sender detects a stale analysis. Recipient
 * authorization is enforced in the bridge.
 */
export async function reopenAssignment(
  fs: FileSystem,
  key: Uint8Array,
  assignmentId: string,
): Promise<Assignment> {
  const assignment = await getAssignment(fs, key, assignmentId);
  if (!assignment) throw new Error(`Assignment not found: ${assignmentId}`);
  if (assignment.status === 'inProgress') return assignment; // already editable — idempotent
  if (!isReopenable(assignment.status)) {
    throw new Error('This questionnaire can no longer be edited.');
  }
  return updateAssignmentStatus(fs, key, assignmentId, 'inProgress');
}

/**
 * Submit the recipient's answers: persist the final ResponseSet (stamping `submittedAt`) and lock the
 * assignment at `submitted`. Reuses any draft's id so a save→submit keeps one identity.
 */
export async function submitResponse(
  fs: FileSystem,
  key: Uint8Array,
  input: { assignmentId: string; answers: Answer[] },
): Promise<ResponseSet> {
  await requireAnswerable(fs, key, input.assignmentId);
  const existing = await getResponse(fs, key, input.assignmentId);
  const response: ResponseSet = {
    id: existing?.id ?? uuid(),
    schemaVersion: 1,
    assignmentId: input.assignmentId,
    answers: input.answers,
    submittedAt: new Date().toISOString(),
    // Monotonic revision (56 §5): first submit → 1, each resubmit → prior + 1. The recipient re-opens to edit
    // (keeping the prior revision), then this bump tells the sender their analysis is now stale.
    revision: (existing?.revision ?? 0) + 1,
    ...(existing?.reAskOf !== undefined ? { reAskOf: existing.reAskOf } : {}),
  };
  await saveResponse(fs, key, response);
  await updateAssignmentStatus(fs, key, input.assignmentId, 'submitted');
  // Learn from any per-question declines: record them in the recipient's Personalization Profile so future
  // generation stops asking what they said doesn't apply / they'd rather not (spec 69 §3.3). Best-effort —
  // a capture failure must never break the submit contract.
  try {
    await captureResponseFeedback(fs, key, input.assignmentId);
  } catch {
    // profile capture is a learning side-effect, not part of the submit
  }
  // Record how each question LANDED (spec 71 §5.4) — the signal that lets the app notice a vein it keeps
  // mining is one the person keeps skipping, and stop, rather than counting asks alone. Best-effort.
  try {
    await recordSubmissionOutcomes(fs, key, input.assignmentId, input.answers);
  } catch {
    // outcome learning is a side-effect, not part of the submit
  }
  return response;
}

/**
 * Stamp each asked question's outcome onto the recipient's ask ledger. Deterministic (no AI): a decline is
 * `declined`, an unanswered question is `skipped`, and a substantive free-text answer is `rich`. Every question
 * in the frozen snapshot is covered — a question the person never touched is exactly the `skipped` signal.
 */
async function recordSubmissionOutcomes(
  fs: FileSystem,
  key: Uint8Array,
  assignmentId: string,
  answers: readonly Answer[],
): Promise<void> {
  const assignment = await getAssignment(fs, key, assignmentId);
  if (!assignment || assignment.recipient.kind !== 'person') return;
  const snapshot = await getAssignmentSnapshot(fs, key, assignmentId);
  if (!snapshot) return;
  const byId = new Map(answers.map((a) => [a.questionId, a.value]));
  await recordOutcomes(
    fs,
    key,
    assignment.recipient.personId,
    snapshot.questions.map((q) => ({
      questionId: q.id,
      outcome: classifyOutcome(q, byId.get(q.id)),
    })),
  );
}

/** Decline an assignment, silently or with an optional short note. Locks it at `declined`. */
export async function declineAssignment(
  fs: FileSystem,
  key: Uint8Array,
  input: { assignmentId: string; note?: string },
): Promise<Assignment> {
  await requireAnswerable(fs, key, input.assignmentId);
  const note = input.note?.trim();
  return updateAssignmentStatus(fs, key, input.assignmentId, 'declined', {
    ...(note ? { declineNote: note } : {}),
  });
}

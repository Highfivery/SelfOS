import type { FileSystem } from '../host';
import { uuid } from '../id';
import type { Answer, Assignment, AssignmentStatus, ResponseSet } from '../schemas';
import { getAssignment, updateAssignmentStatus } from './assignmentService';
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

/** Whether the recipient can still act on an assignment in this status. */
export function isAnswerable(status: AssignmentStatus): boolean {
  return ANSWERABLE_STATUSES.has(status);
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
    // no `submittedAt` — a draft is unsubmitted; the assignment status carries the lifecycle
  };
  await saveResponse(fs, key, draft);
  await updateAssignmentStatus(fs, key, input.assignmentId, 'inProgress');
  return draft;
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
    ...(existing?.reAskOf !== undefined ? { reAskOf: existing.reAskOf } : {}),
  };
  await saveResponse(fs, key, response);
  await updateAssignmentStatus(fs, key, input.assignmentId, 'submitted');
  return response;
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

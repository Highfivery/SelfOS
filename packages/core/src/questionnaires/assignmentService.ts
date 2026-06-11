import type { FileSystem } from '../host';
import { uuid } from '../id';
import {
  AssignmentSchema,
  QuestionnaireSchema,
  type Assignment,
  type AssignmentStatus,
  type Channel,
  type PrivacyMode,
  type Questionnaire,
  type Recipient,
} from '../schemas';
import { readEncryptedJson, writeEncryptedJson } from '../vault';
import { SENDS_DIR, assignmentPath, sendDir, snapshotPath } from './paths';
import { getQuestionnaire, validateQuestionnaire } from './questionnaireService';

/**
 * Assignments — one send of a questionnaire to one recipient (08-questionnaires §4.3). Sending freezes
 * an **immutable snapshot** of the questionnaire in the send folder, so later edits to the definition
 * never change what an in-flight recipient sees or how their answers map.
 */

export interface CreateAssignmentInput {
  questionnaireId: string;
  senderPersonId: string;
  recipient: Recipient;
  channel: Channel;
  privacy: PrivacyMode;
  senderVisibleToRecipient: boolean;
  expiresAt?: string;
}

/**
 * Send a questionnaire: validate it (a send must be complete), **snapshot** the current definition into
 * the send folder, and create the Assignment (status `sent`). Relay link material (token/PIN/keys) is
 * attached by the external-delivery slice; in-app/household sends need none.
 */
export async function createAssignment(
  fs: FileSystem,
  key: Uint8Array,
  input: CreateAssignmentInput,
): Promise<Assignment> {
  const questionnaire = await getQuestionnaire(fs, key, input.questionnaireId);
  if (!questionnaire) throw new Error(`Questionnaire not found: ${input.questionnaireId}`);
  const problems = validateQuestionnaire(questionnaire);
  if (problems.length > 0) {
    throw new Error(`Cannot send an incomplete questionnaire: ${problems.join(' ')}`);
  }

  const id = uuid();
  const at = new Date().toISOString();
  // Immutable snapshot first, then the assignment: freeze the questionnaire as-sent so a later edit to the
  // def can't change it. Order is deliberate — if we crash between the two writes, an orphan snapshot is
  // invisible to listAssignments (which keys off assignment.enc) and deleteAssignment cleans the folder;
  // the reverse (an assignment with no snapshot) would be a dangling, unanswerable send.
  await writeEncryptedJson(fs, snapshotPath(id), questionnaire, key);
  const assignment: Assignment = {
    id,
    schemaVersion: 1,
    questionnaireId: questionnaire.id,
    senderPersonId: input.senderPersonId,
    recipient: input.recipient,
    channel: input.channel,
    privacy: input.privacy,
    senderVisibleToRecipient: input.senderVisibleToRecipient,
    status: 'sent',
    createdAt: at,
    updatedAt: at,
    ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
  };
  await writeEncryptedJson(fs, assignmentPath(id), assignment, key);
  return assignment;
}

/** Read one assignment; null if absent. */
export async function getAssignment(
  fs: FileSystem,
  key: Uint8Array,
  id: string,
): Promise<Assignment | null> {
  const raw = await readEncryptedJson(fs, assignmentPath(id), key);
  return raw ? AssignmentSchema.parse(raw) : null;
}

/** Read the immutable questionnaire snapshot for an assignment (what the recipient answers). */
export async function getAssignmentSnapshot(
  fs: FileSystem,
  key: Uint8Array,
  id: string,
): Promise<Questionnaire | null> {
  const raw = await readEncryptedJson(fs, snapshotPath(id), key);
  return raw ? QuestionnaireSchema.parse(raw) : null;
}

/**
 * List assignments, newest first (by `createdAt`). Optionally scoped to one **sender** (the My
 * Questionnaires / Results side) or one **recipient person** (the Inbox side — only in-app person
 * recipients can match). Passing both narrows to assignments matching both.
 */
export async function listAssignments(
  fs: FileSystem,
  key: Uint8Array,
  filter: { senderPersonId?: string; recipientPersonId?: string } = {},
): Promise<Assignment[]> {
  const out: Assignment[] = [];
  for (const name of await fs.list(SENDS_DIR)) {
    const raw = await readEncryptedJson(fs, assignmentPath(name), key);
    if (!raw) continue; // stray non-send entry (e.g. a synced .DS_Store) → skipped
    const assignment = AssignmentSchema.parse(raw);
    if (filter.senderPersonId && assignment.senderPersonId !== filter.senderPersonId) continue;
    if (
      filter.recipientPersonId &&
      !(
        assignment.recipient.kind === 'person' &&
        assignment.recipient.personId === filter.recipientPersonId
      )
    ) {
      continue;
    }
    out.push(assignment);
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return out;
}

/** Transition an assignment's status (e.g. opened → submitted, or declined with an optional note). */
export async function updateAssignmentStatus(
  fs: FileSystem,
  key: Uint8Array,
  id: string,
  status: AssignmentStatus,
  options: { declineNote?: string } = {},
): Promise<Assignment> {
  const existing = await getAssignment(fs, key, id);
  if (!existing) throw new Error(`Assignment not found: ${id}`);
  const updated: Assignment = {
    ...existing,
    status,
    updatedAt: new Date().toISOString(),
    ...(options.declineNote !== undefined ? { declineNote: options.declineNote } : {}),
  };
  await writeEncryptedJson(fs, assignmentPath(id), updated, key);
  return updated;
}

/** Delete an assignment and its whole send folder (snapshot + response). No key needed. */
export async function deleteAssignment(fs: FileSystem, id: string): Promise<void> {
  await fs.remove(sendDir(id));
}

import type { FileSystem } from '../host';
import { uuid } from '../id';
import {
  type Assignment,
  type CompatibilityVisibility,
  type Question,
  type Questionnaire,
} from '../schemas';
import { writeEncryptedJson } from '../vault';
import { assignmentPath, snapshotPath } from './paths';
import { getQuestionnaire, validateQuestionnaire } from './questionnaireService';

/**
 * Compatibility dual-send (08-questionnaires §3.6/§13.5d/§16.1). A compatibility questionnaire compares
 * **two participants** — which may be the **sender + someone else** (the couples case, the default) or
 * **two other people**. The AI has already personalized a **variant** per participant (same answer types
 * + `canonicalId`, so the answers stay aligned). This service freezes each variant as its own immutable
 * snapshot and creates the two paired Assignments, linked by a shared `compatibilityGroupId`. When a
 * participant is the sender, that assignment's recipient IS the sender (they answer their own variant).
 *
 * Both sends are **Private**: raw answers are never shown inline (the alignment report is the deliverable).
 * `senderSeesAll` additionally unlocks a raw-answer reveal (§8.4) — gated by `questionnaires.readRaw` (or
 * the Owner) in the bridge, not here; no audit log.
 */

export interface CompatibilityRecipient {
  personId: string; // a participant — may be the sender themselves (§16.1)
  questions: Question[]; // the personalized variant (aligned to the canonical questions by canonicalId)
}

export interface CreateCompatibilitySendInput {
  questionnaireId: string;
  senderPersonId: string;
  visibility: CompatibilityVisibility;
  recipients: [CompatibilityRecipient, CompatibilityRecipient];
}

/**
 * Freeze ONE in-app participant's variant snapshot + Assignment under a shared compatibility group. Used for
 * both household members and — for an **external** compatibility send (08 §17.12-B) — the **sender's** in-app
 * member (the external participant's side is a relay send via `createRelaySend`, sharing the same group id).
 */
export async function writeCompatibilityMember(
  fs: FileSystem,
  key: Uint8Array,
  input: {
    canonical: Questionnaire;
    senderPersonId: string;
    participantPersonId: string;
    questions: Question[];
    visibility: CompatibilityVisibility;
    compatibilityGroupId: string;
  },
): Promise<string> {
  // The as-sent snapshot is the canonical questionnaire with this participant's personalized variant, pinned
  // to the chosen visibility so the report + disclosure derive from one frozen source.
  const variant: Questionnaire = {
    ...input.canonical,
    questions: input.questions,
    compatibility: { enabled: true, visibility: input.visibility },
  };
  const problems = validateQuestionnaire(variant);
  if (problems.length > 0) {
    throw new Error(`Cannot send an incomplete questionnaire: ${problems.join(' ')}`);
  }
  const id = uuid();
  const at = new Date().toISOString();
  // Snapshot first, then the assignment (the same crash-safe order as createAssignment).
  await writeEncryptedJson(fs, snapshotPath(id), variant, key);
  const assignment: Assignment = {
    id,
    schemaVersion: 1,
    questionnaireId: input.canonical.id,
    senderPersonId: input.senderPersonId,
    recipient: { kind: 'person', personId: input.participantPersonId },
    channel: 'inApp',
    privacy: 'private', // compatibility sends never expose raw answers inline (§3.6)
    senderVisibleToRecipient: true,
    compatibilityGroupId: input.compatibilityGroupId,
    status: 'sent',
    createdAt: at,
    updatedAt: at,
  };
  await writeEncryptedJson(fs, assignmentPath(id), assignment, key);
  return id;
}

/** Freeze the two in-app variant snapshots + create the paired Assignments. Returns the shared group id. */
export async function createCompatibilitySend(
  fs: FileSystem,
  key: Uint8Array,
  input: CreateCompatibilitySendInput,
): Promise<string> {
  const canonical = await getQuestionnaire(fs, key, input.questionnaireId);
  if (!canonical) throw new Error(`Questionnaire not found: ${input.questionnaireId}`);
  if (!canonical.compatibility?.enabled) {
    throw new Error('This questionnaire is not a compatibility questionnaire.');
  }

  const compatibilityGroupId = uuid();
  for (const recipient of input.recipients) {
    await writeCompatibilityMember(fs, key, {
      canonical,
      senderPersonId: input.senderPersonId,
      participantPersonId: recipient.personId,
      questions: recipient.questions,
      visibility: input.visibility,
      compatibilityGroupId,
    });
  }
  return compatibilityGroupId;
}

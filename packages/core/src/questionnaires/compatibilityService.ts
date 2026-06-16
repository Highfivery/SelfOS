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

/** Freeze the two variant snapshots + create the paired Assignments. Returns the shared group id. */
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
  const at = new Date().toISOString();

  for (const recipient of input.recipients) {
    // The as-sent snapshot is the canonical questionnaire with this recipient's personalized variant,
    // pinned to the chosen visibility so the report + disclosure derive from one frozen source.
    const variant: Questionnaire = {
      ...canonical,
      questions: recipient.questions,
      compatibility: { enabled: true, visibility: input.visibility },
    };
    const problems = validateQuestionnaire(variant);
    if (problems.length > 0) {
      throw new Error(`Cannot send an incomplete questionnaire: ${problems.join(' ')}`);
    }

    const id = uuid();
    // Snapshot first, then the assignment (the same crash-safe order as createAssignment).
    await writeEncryptedJson(fs, snapshotPath(id), variant, key);
    const assignment: Assignment = {
      id,
      schemaVersion: 1,
      questionnaireId: canonical.id,
      senderPersonId: input.senderPersonId,
      recipient: { kind: 'person', personId: recipient.personId },
      channel: 'inApp',
      privacy: 'private', // compatibility sends never expose raw answers inline (§3.6)
      senderVisibleToRecipient: true,
      compatibilityGroupId,
      status: 'sent',
      createdAt: at,
      updatedAt: at,
    };
    await writeEncryptedJson(fs, assignmentPath(id), assignment, key);
  }

  return compatibilityGroupId;
}

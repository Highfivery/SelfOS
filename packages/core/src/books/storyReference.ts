import { formatIntakeForGeneration, getIntakeSession } from '../intake/intakeService';
import { listCoveredTopics } from '../questionnaires/coveredTopicsStore';
import {
  buildDedupReference,
  gatherRecipientAskedPrompts,
  gatherRecipientFeedbackGuidance,
  gatherRecipientInsightFacts,
  gatherRecipientPriorAnswers,
} from '../questionnaires/recipientHistory';
import type { AiDeps } from '../questionnaires/generationService';

/**
 * Everything the biographer already knows about this person, assembled once (72 §5.5).
 *
 * The questionnaire path has always had this; the CONVERSATION never did, which is why the memory chat
 * opened cold and asked about things the person answered in onboarding two months ago. Both paths use this
 * now, so "it reads like it hasn't read my file" can't be true of one channel and not the other.
 *
 * Author-blind: it is fed to the model and never returned to a UI.
 */
export async function gatherBiographerReference(
  fs: AiDeps['fs'],
  key: Uint8Array,
  personId: string,
): Promise<{ dedupReference: string; askedPrompts: string[]; feedbackGuidance: string }> {
  const [priorAnswers, insightFacts, priorPrompts, intakeSession, feedbackGuidance, coveredTopics] =
    await Promise.all([
      gatherRecipientPriorAnswers(fs, key, personId),
      gatherRecipientInsightFacts(fs, key, personId),
      gatherRecipientAskedPrompts(fs, key, personId),
      getIntakeSession(fs, key, personId),
      // spec 69 §5.9 — the biographer learns from the person's own prior skips/declines too.
      gatherRecipientFeedbackGuidance(fs, key, personId),
      // §28.3 covered-topics parity (spec 69 §5.2): a self-send, so author = recipient = the person.
      listCoveredTopics(fs, key, personId, personId),
    ]);
  const intake = intakeSession
    ? formatIntakeForGeneration(intakeSession)
    : { text: '', prompts: [] as string[] };
  const coveredNotes = coveredTopics.map((t) => t.note);
  const coveredPrompts = coveredTopics
    .map((t) => t.sourcePrompt)
    .filter((p): p is string => Boolean(p));
  return {
    dedupReference: buildDedupReference({
      intakeText: intake.text,
      priorAnswers,
      insightFacts,
      priorPrompts,
      ...(coveredNotes.length ? { coveredTopics: coveredNotes } : {}),
    }),
    askedPrompts: [...priorPrompts, ...intake.prompts, ...coveredPrompts],
    feedbackGuidance,
  };
}

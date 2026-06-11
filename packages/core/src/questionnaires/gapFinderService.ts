import { z } from 'zod';
import { QuestionnaireSuggestionSchema, type QuestionnaireSuggestResult } from '../schemas';
import { buildGapFinderUserMessage, GAP_FINDER_SYSTEM } from './aiPrompts';
import { gatherGenerationContext } from './contextProviders';
import { extractJsonArray, runClaude, type AiDeps } from './generationService';

/**
 * The gap-finder / "Suggested" surface (08-questionnaires §3.7/§13.3). Scans the author's **structured
 * context only** (profiles, relationships, prior Insights — never raw chat transcripts, §12.22) via the
 * context-provider registry and proposes the next questionnaires to send. Budget-gated + metered like
 * generation; over budget it surfaces a calm state without calling Claude.
 */
export type SuggestResult = QuestionnaireSuggestResult;

export async function suggestQuestionnaires(
  deps: AiDeps,
  input: { targetPersonId?: string } = {},
): Promise<SuggestResult> {
  const context = await gatherGenerationContext(deps.fs, deps.key, {
    authorPersonId: deps.personId,
    includeAuthor: true,
    ...(input.targetPersonId !== undefined ? { targetPersonId: input.targetPersonId } : {}),
    includeTarget: input.targetPersonId !== undefined,
    includeRelationship: input.targetPersonId !== undefined,
  });

  const call = await runClaude(
    deps,
    GAP_FINDER_SYSTEM,
    buildGapFinderUserMessage(context),
    'questionnaire.suggest',
    1200,
  );
  if (!call.ok) return { ok: false, reason: call.reason, message: call.message };

  const validated = z.array(QuestionnaireSuggestionSchema).safeParse(extractJsonArray(call.text));
  const suggestions = (validated.success ? validated.data : []).filter(
    (s) => s.questions.length > 0,
  );
  if (suggestions.length === 0) {
    return {
      ok: false,
      reason: 'REFUSED',
      usage: call.usage,
      message: 'No suggestions right now — add more about the people in your life.',
    };
  }
  return { ok: true, suggestions, usage: call.usage };
}

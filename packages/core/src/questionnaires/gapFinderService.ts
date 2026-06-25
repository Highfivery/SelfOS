import { z } from 'zod';
import {
  classifyParseOutcome,
  extractJsonArray,
  salvageJsonArray,
  tolerantArray,
} from '../ai/jsonSalvage';
import {
  SuggestionQuestionSchema,
  type QuestionnaireSuggestion,
  type QuestionnaireSuggestResult,
} from '../schemas';
import { buildGapFinderUserMessage, GAP_FINDER_SYSTEM } from './aiPrompts';
import { gatherGenerationContext, isThinContext } from './contextProviders';
import { runClaude, type AiDeps } from './generationService';

/**
 * The gap-finder / "Suggested" surface (08-questionnaires §3.7/§13.3). Scans the author's **structured
 * context only** (profiles, relationships, prior Insights — never raw chat transcripts, §12.22) via the
 * context-provider registry and proposes the next questionnaires to send. Budget-gated + metered like
 * generation; over budget it surfaces a calm state without calling Claude.
 *
 * Parsing is TOLERANT (37-ai-output-robustness): a successful Claude call whose suggestions are imperfect —
 * one omitting `required`, one malformed among good ones, or a reply cut off mid-array — must never be
 * thrown away with a data-blaming message (the reported bug). Per-element salvage keeps the usable
 * suggestions; a genuinely-empty result is classified honestly (TRUNCATED / MALFORMED / REFUSED). The
 * "add more about the people in your life" hint is reserved for the PRE-CALL empty-context case (§11).
 */
export type SuggestResult = QuestionnaireSuggestResult;

/** A sample question with an off-spec `type` catches to this sentinel (empty prompt → dropped). */
const QUESTION_SENTINEL: QuestionnaireSuggestion['questions'][number] = {
  type: 'shortText',
  prompt: '',
};

/**
 * Parse-time suggestion schema with a TOLERANT inner `questions` array (37 §3.1). The live model guesses
 * answer-type names, and a single off-spec `type` used to fail the whole `questions` array → the whole
 * suggestion was discarded → with every suggestion losing one sample question the batch went empty →
 * "unexpected shape". Now a bad sample question drops only itself, so a suggestion with one good + one bad
 * question still survives (keeping the good one). `type` (the questionnaire type, e.g. "general") and
 * `rationale` tolerate omission so a missing non-essential field never discards a usable proposal; only a
 * `title` is hard-required. The OUTER array keeps a suggestion only when it has a title AND a usable question.
 */
const SuggestionParseSchema = z.object({
  title: z.string().min(1),
  type: z.string().min(1).catch('general'),
  rationale: z.string().catch(''),
  questions: tolerantArray(
    SuggestionQuestionSchema,
    QUESTION_SENTINEL,
    (q) => q.prompt.trim() !== '',
  ),
});

/** A bad suggestion catches to this sentinel and is dropped (title empty → never kept). */
const SUGGESTION_SENTINEL: QuestionnaireSuggestion = {
  title: '',
  type: '',
  rationale: '',
  questions: [],
};

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

  // Pre-call emptiness check (37 §11): when there's genuinely nothing to work with (only identity
  // boilerplate, no notes/tags/relationships/insights), say so without spending — this is an empty state,
  // not an AI failure (no `reason`), so a post-call zero-result can be honest instead of a data blame.
  if (isThinContext(context)) {
    return {
      ok: false,
      message: 'Add more about the people in your life and I’ll have suggestions.',
    };
  }

  const call = await runClaude(
    deps,
    GAP_FINDER_SYSTEM,
    buildGapFinderUserMessage(context),
    'questionnaire.suggest',
    1200,
  );
  if (!call.ok) return { ok: false, reason: call.reason, message: call.message };

  // Per-element salvage: a whole `[ ... ]` if it parses, else the complete elements of a truncated array.
  // Each suggestion catches to the sentinel and is dropped unless it has a title + ≥1 usable sample
  // question; each sample question is itself per-element tolerant (a bad `type` drops only that question).
  const whole = extractJsonArray(call.text);
  const raw = Array.isArray(whole) ? whole : salvageJsonArray(call.text);
  const suggestions = tolerantArray(
    SuggestionParseSchema,
    SUGGESTION_SENTINEL,
    (s) => s.title.trim() !== '' && s.questions.length > 0,
  ).parse(raw);

  if (suggestions.length === 0) {
    // The call succeeded but no usable suggestion survived — an HONEST parse outcome, never a data blame.
    const { reason, message } = classifyParseOutcome(call.text, 'suggestion set');
    return { ok: false, reason, usage: call.usage, message };
  }
  return { ok: true, suggestions, usage: call.usage };
}

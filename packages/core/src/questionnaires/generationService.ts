import { z } from 'zod';
import {
  classifyParseOutcome,
  extractJsonArray,
  extractJsonObject,
  salvageJsonArray,
  tolerantArray,
} from '../ai/jsonSalvage';
import { uuid } from '../id';
import {
  AnswerTypeSchema,
  type AiFailureReason,
  type Question,
  type QuestionnaireGenerateResult,
  type QuestionnaireImproveResult,
  type SensitivityTier,
} from '../schemas';
import { mergedIntimacyTopics } from '../intimacy/topics';
import {
  buildGenerationUserMessage,
  buildImproveUserMessage,
  buildVariantUserMessage,
  GENERATION_SYSTEM,
  IMPROVE_SYSTEM,
  VARIANT_SYSTEM,
  type IntimacyGenerateMode,
} from './aiPrompts';
import { runClaude, type AiDeps } from './aiCall';
import { gatherGenerationContext, type GenerationContextRequest } from './contextProviders';
import { readCustomIntimacyTopics } from './customTypeService';
import { isNearDuplicate } from './dedup';
import { semanticDedupFilter } from './semanticDedup';

/**
 * AI question generation + per-question improve (08-questionnaires §3.1/§13.3). Mirrors `chatService`'s
 * budget → call → record path: every call is budget-gated (warn→block, owner override) and metered
 * through `06`, charged to the active person. Output is parsed + Zod-validated here (the model never
 * supplies ids); a model refusal (no usable questions) degrades to a calm result, not a throw.
 */

export type { AiFailureReason };
export type GenerateResult = QuestionnaireGenerateResult;
export type ImproveResult = QuestionnaireImproveResult;

// `runClaude` / `AiDeps` / `ClaudeCallResult` live in `./aiCall` (shared, cycle-free); re-exported here so every
// existing `from './generationService'` importer keeps working.
export { runClaude } from './aiCall';
export type { AiDeps, ClaudeCallResult } from './aiCall';

/** The model returns ungiven-id question objects; ids are minted here. matrix/allocation aren't generated. */
const GeneratedQuestionSchema = z.object({
  type: AnswerTypeSchema,
  prompt: z.string().min(1),
  required: z.boolean().optional(),
  help: z.string().optional(),
  options: z.array(z.string()).optional(),
  scale: z.object({ min: z.number(), max: z.number() }).optional(),
});

/** A bad generated question catches to this sentinel (empty prompt → dropped by the keep filter). */
const QUESTION_SENTINEL: z.infer<typeof GeneratedQuestionSchema> = {
  type: 'shortText',
  prompt: '',
};

/**
 * Generation returns an object: a short `title` (08 §16.4) + the questions array. The questions are parsed
 * per-element (37 §3.1): one malformed/out-of-enum question drops, the rest survive.
 */
const GeneratedSetSchema = z.object({
  title: z.string().optional(),
  questions: tolerantArray(
    GeneratedQuestionSchema,
    QUESTION_SENTINEL,
    (q) => q.prompt.trim() !== '',
  ),
});

const OPTION_TYPES = new Set(['singleChoice', 'multiChoice', 'ranking', 'thisOrThat']);
const SCALE_TYPES = new Set(['rating', 'slider']);

/** Map a validated generated object to a well-formed Question, dropping ones missing required fields. */
function toQuestion(raw: z.infer<typeof GeneratedQuestionSchema>): Question | null {
  if (OPTION_TYPES.has(raw.type) && (raw.options?.length ?? 0) < 2) return null;
  if (SCALE_TYPES.has(raw.type) && !raw.scale) return null;
  return {
    id: uuid(),
    type: raw.type,
    prompt: raw.prompt.trim(),
    required: raw.required ?? false,
    ...(raw.help?.trim() ? { help: raw.help.trim() } : {}),
    ...(OPTION_TYPES.has(raw.type) && raw.options
      ? { options: raw.options.map((o) => o.trim()).filter(Boolean) }
      : {}),
    ...(SCALE_TYPES.has(raw.type) && raw.scale ? { scale: raw.scale } : {}),
  };
}

export interface GenerateRequest {
  type: string;
  sensitivity: SensitivityTier;
  brief?: string;
  context: GenerationContextRequest;
  existingPrompts: string[];
  count?: number;
  // Intimacy draft format (08 §17.12-C): direct questions, described scenarios, or a mix.
  intimacyMode?: IntimacyGenerateMode;
  // The recipient's full answered content (08 §17.4/§19.1), assembled host-side by the caller (bridge). Fed to
  // the model ONLY to avoid repeating + to go deeper — never surfaced to the author.
  recipientHistory?: string;
  // The exact prompts the recipient was already asked in prior questionnaires (08 §23.5) — a structured list for
  // the deterministic hard near-duplicate FILTER (the string `recipientHistory` drives the model; this drives
  // the code filter, so a re-ask the model slips past is still dropped).
  recipientAskedPrompts?: readonly string[];
  // The intimacy acts the recipient already rated in onboarding (08 §19.3) — reframes the intimacy seeding so
  // it goes deeper on rated acts instead of re-asking them.
  coveredIntimacyActs?: readonly { label: string; rating: string }[];
}

/** Generate questions from a brief and/or the configured structured context. */
export async function generateQuestions(
  deps: AiDeps,
  request: GenerateRequest,
): Promise<GenerateResult> {
  const requestedCount = request.count ?? 5;
  // The semantic de-dup pass (08 §23.5, layer 3) runs when the recipient has known material to compare against.
  // When it will run, OVER-ASK a small buffer so the questions it drops as duplicates don't leave us short of
  // the requested count; we trim back after filtering. No recipient history ⇒ nothing to compare ⇒ no over-ask.
  const dedupReference = request.recipientHistory?.trim() ?? '';
  const willSemanticDedup = dedupReference !== '';
  const askCount = willSemanticDedup ? Math.min(requestedCount + 3, 23) : requestedCount;

  // Pass the questionnaire type so the insights provider derives a relevance topic (28 §13.1) — an intimacy
  // questionnaire surfaces the author's Intimacy/Relationships portrait facts, etc.
  const context = await gatherGenerationContext(deps.fs, deps.key, {
    ...request.context,
    questionnaireType: request.type,
  });
  // The intimacy topic inventory (08 §16.5a) seeds the explicit framing for an intimacy questionnaire at the
  // explicit/unfiltered tiers — the built-in topics merged with the Owner's custom additions (vault prefs).
  const user = buildGenerationUserMessage({
    type: request.type,
    sensitivity: request.sensitivity,
    ...(request.brief !== undefined ? { brief: request.brief } : {}),
    context,
    existingPrompts: request.existingPrompts,
    count: askCount,
    intimacyTopics: mergedIntimacyTopics(await readCustomIntimacyTopics(deps.fs)),
    ...(request.intimacyMode !== undefined ? { intimacyMode: request.intimacyMode } : {}),
    ...(request.recipientHistory !== undefined
      ? { recipientHistory: request.recipientHistory }
      : {}),
    ...(request.coveredIntimacyActs !== undefined
      ? { coveredIntimacyActs: request.coveredIntimacyActs }
      : {}),
  });

  // A generous output budget (thinking is off) that SCALES with the (over-asked) count (08 §23.4) — a 20-question
  // set with long multi-choice option lists would blow past a fixed 2500 and truncate the JSON. ~350 tokens per
  // question with a 2500 floor (so a small set keeps the same headroom as before).
  const maxTokens = Math.max(2500, askCount * 350);
  const call = await runClaude(deps, GENERATION_SYSTEM, user, 'questionnaire.generate', maxTokens);
  if (!call.ok) return { ok: false, reason: call.reason, message: call.message };

  // Generation returns {title, questions}. Tolerate a legacy bare-array reply (older model responses) and a
  // truncated array (salvage the complete elements). Each is per-element tolerant (one bad question drops).
  const objParse = GeneratedSetSchema.safeParse(extractJsonObject(call.text));
  let set: z.infer<typeof GeneratedSetSchema> | null = null;
  if (objParse.success) {
    set = objParse.data;
  } else {
    const whole = extractJsonArray(call.text);
    const rawArray = Array.isArray(whole) ? whole : salvageJsonArray(call.text);
    const arr = tolerantArray(
      GeneratedQuestionSchema,
      QUESTION_SENTINEL,
      (q) => q.prompt.trim() !== '',
    ).parse(rawArray);
    if (arr.length > 0) set = { questions: arr };
  }
  if (!set) {
    // The call succeeded but no parseable JSON came back — classify it honestly (cut off vs unexpected
    // shape vs a detected refusal), never blame the brief (37 §3.1/§3.2).
    const { reason, message } = classifyParseOutcome(call.text, 'draft');
    return { ok: false, reason, usage: call.usage, message };
  }
  // Hard de-dup (08 §23.5): drop a built question that near-duplicates (a) one already kept this round, (b) a
  // question already in the draft, or (c) one the recipient was already asked in a prior questionnaire — not
  // just an exact-normalized repeat. This is the deterministic backstop to the model's soft "avoid overlap".
  const askedPrompts = request.recipientAskedPrompts ?? [];
  const questions: Question[] = [];
  const keptPrompts: string[] = [];
  for (const raw of set.questions) {
    const q = toQuestion(raw);
    if (!q) continue;
    if (isNearDuplicate(q.prompt, request.existingPrompts)) continue;
    if (isNearDuplicate(q.prompt, askedPrompts)) continue;
    if (isNearDuplicate(q.prompt, keptPrompts)) continue;
    questions.push(q);
    keptPrompts.push(q.prompt);
  }
  if (questions.length === 0) {
    // A set parsed but yielded nothing new/usable (all duplicates or unbuildable) — a calm retry, not a
    // parse failure and not a data blame.
    return {
      ok: false,
      reason: 'MALFORMED',
      usage: call.usage,
      message: 'No new questions came back. Please try again.',
    };
  }

  // Semantic de-dup (08 §23.5, layer 3): a second bounded, metered call drops questions that mean the same as
  // something the recipient already shared/was asked, in different words (the fuzzy filter misses those). It is
  // FAIL-SAFE — on AI-off / over-budget / a parse miss it keeps every question. Then TRIM to the requested
  // count (we over-asked to absorb the drops). Fewer than requested is acceptable (all we had were new).
  let finalQuestions = questions;
  if (willSemanticDedup && questions.length > 1) {
    const sem = await semanticDedupFilter(deps, questions, dedupReference);
    finalQuestions = sem.kept;
  }
  finalQuestions = finalQuestions.slice(0, requestedCount);

  const title = set.title?.trim();
  // We return the generation call's usage for the renderer's optimistic budget refresh; the semantic pass's
  // `questionnaire.dedup` usage is billed separately (recorded inside `runClaude`) — the ring reloads to reflect it.
  return { ok: true, questions: finalQuestions, ...(title ? { title } : {}), usage: call.usage };
}

/**
 * Generate one answerer's **personalized variant** of a compatibility questionnaire (08-questionnaires
 * §3.6/§13.5d/§17.12): rewrite each canonical prompt so it asks `forName` (the answerer) about THEIR
 * experience with `aboutName` (the OTHER participant) — so each person is asked about the other, not about
 * themselves. Keeps the SAME answer type + `canonicalId` so the two variants stay aligned. Only prompts are
 * personalized — the answer structure
 * (type/options/scale/branch) is preserved from the canonical question, and the question id is kept (so a
 * branch reference stays valid and the id doubles as the alignment key). The target context is limited to
 * **shareable** facts (the §13.3 privacy boundary — a `targetContext` with `includeAuthor: false`).
 */
export async function generateVariant(
  deps: AiDeps,
  input: {
    forName: string;
    forGender?: string;
    aboutName: string;
    aboutGender?: string;
    questions: Question[];
    targetContext: GenerationContextRequest;
  },
): Promise<QuestionnaireGenerateResult> {
  const context = await gatherGenerationContext(deps.fs, deps.key, input.targetContext);
  const user = buildVariantUserMessage({
    forName: input.forName,
    ...(input.forGender ? { forGender: input.forGender } : {}),
    aboutName: input.aboutName,
    ...(input.aboutGender ? { aboutGender: input.aboutGender } : {}),
    ...(context.trim() ? { context } : {}),
    questions: input.questions.map((q) => ({
      prompt: q.prompt,
      ...(q.options ? { options: q.options } : {}),
    })),
  });
  const call = await runClaude(deps, VARIANT_SYSTEM, user, 'questionnaire.generate', 1500);
  if (!call.ok) return { ok: false, reason: call.reason, message: call.message };

  // The model returns one object per question: { prompt, options }. Both the prompt AND options are
  // personalized — options carry the partner's gendered pronouns (§17.14e), so leaving them un-rewritten
  // was the "answers read as if the other person were answering" bug.
  const variantElement = z.object({
    prompt: z.string(),
    options: z.array(z.string()).nullable().optional(),
  });
  const VARIANT_SENTINEL: z.infer<typeof variantElement> = { prompt: '' };
  // Per-element + truncation tolerant (37 §3.1): map what came back; a short/partial reply just means the
  // trailing questions keep their canonical (un-personalized but still aligned) form. Index-aligned, so a
  // dropped element is NOT compacted — keep the empty sentinel so indices still line up with the questions.
  const whole = extractJsonArray(call.text);
  const rawArray = Array.isArray(whole) ? whole : salvageJsonArray(call.text);
  const variants = z.array(variantElement.catch(VARIANT_SENTINEL)).catch([]).parse(rawArray);
  if (variants.length === 0) {
    const { reason, message } = classifyParseOutcome(call.text, 'personalized questionnaire');
    return { ok: false, reason, usage: call.usage, message };
  }
  // SAFETY: an option rewrite is only accepted when it preserves the option COUNT (so the two variants stay
  // aligned + the answer structure is intact); otherwise keep the canonical options for that question.
  const questions: Question[] = input.questions.map((q, i) => {
    const out = variants[i];
    const personalized = out?.prompt.trim();
    const rewrittenOptions =
      q.options && out?.options && out.options.length === q.options.length
        ? out.options.map((o) => o.trim())
        : undefined;
    return {
      ...q,
      canonicalId: q.canonicalId ?? q.id, // the alignment key (defaults to the canonical question id)
      ...(personalized ? { prompt: personalized } : {}),
      ...(rewrittenOptions ? { options: rewrittenOptions } : {}),
    };
  });
  return { ok: true, questions, usage: call.usage };
}

/** Reword a single question per an instruction ("warmer", "tighter", …). */
export async function improveQuestion(
  deps: AiDeps,
  input: { prompt: string; type: string; instruction: string },
): Promise<ImproveResult> {
  const user = buildImproveUserMessage(input);
  const call = await runClaude(deps, IMPROVE_SYSTEM, user, 'questionnaire.generate', 200);
  if (!call.ok) return { ok: false, reason: call.reason, message: call.message };
  const text = call.text
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim();
  if (text === '') {
    // Empty after stripping — classify honestly off the raw reply (an empty reply is a cut-off retry; a
    // decline is REFUSED) rather than the old catch-all "couldn't reword" (37 §3.2).
    const { reason, message } = classifyParseOutcome(call.text, 'reworded question');
    return { ok: false, reason, usage: call.usage, message };
  }
  return { ok: true, prompt: text, usage: call.usage };
}

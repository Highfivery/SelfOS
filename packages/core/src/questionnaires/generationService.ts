import { z } from 'zod';
import {
  classifyParseOutcome,
  extractJsonArray,
  extractJsonObject,
  salvageJsonArray,
  tolerantArray,
} from '../ai/jsonSalvage';
import type { ClaudeClient, FileSystem } from '../host';
import { uuid } from '../id';
import {
  AnswerTypeSchema,
  type AiFailureReason,
  type Question,
  type QuestionnaireGenerateResult,
  type QuestionnaireImproveResult,
  type SensitivityTier,
  type UsageEvent,
} from '../schemas';
import { mergedIntimacyTopics } from '../intimacy/topics';
import { checkBudget, costOf, recordUsage } from '../usage';
import {
  buildGenerationUserMessage,
  buildImproveUserMessage,
  buildVariantUserMessage,
  GENERATION_SYSTEM,
  IMPROVE_SYSTEM,
  VARIANT_SYSTEM,
  type IntimacyGenerateMode,
} from './aiPrompts';
import { gatherGenerationContext, type GenerationContextRequest } from './contextProviders';
import { readCustomIntimacyTopics } from './customTypeService';

/**
 * AI question generation + per-question improve (08-questionnaires §3.1/§13.3). Mirrors `chatService`'s
 * budget → call → record path: every call is budget-gated (warn→block, owner override) and metered
 * through `06`, charged to the active person. Output is parsed + Zod-validated here (the model never
 * supplies ids); a model refusal (no usable questions) degrades to a calm result, not a throw.
 */

export type { AiFailureReason };
export type GenerateResult = QuestionnaireGenerateResult;
export type ImproveResult = QuestionnaireImproveResult;

export interface AiDeps {
  fs: FileSystem;
  key: Uint8Array;
  client: ClaudeClient;
  apiKey: string | null;
  model: string;
  personId: string;
  now: Date;
  override?: boolean;
}

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

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

export type ClaudeCallResult =
  | { ok: true; text: string; usage: UsageEvent }
  | { ok: false; reason: AiFailureReason; message: string };

/** Shared budget-gated, metered one-shot Claude call (used by generate / improve / gap-finder). */
export async function runClaude(
  deps: AiDeps,
  system: string,
  userText: string,
  type: string,
  maxTokens: number,
): Promise<ClaudeCallResult> {
  const { fs, key, apiKey, model, personId, now } = deps;
  if (!apiKey) return { ok: false, reason: 'NO_KEY', message: 'Add your Claude API key first.' };
  const person = await checkBudget(fs, key, {
    scope: 'person',
    personId,
    now,
    override: deps.override,
  });
  const app = await checkBudget(fs, key, { scope: 'app', now, override: deps.override });
  if (person.state === 'over' || app.state === 'over') {
    return { ok: false, reason: 'BUDGET', message: 'AI budget reached for this period.' };
  }

  let streamed;
  try {
    streamed = await deps.client.stream(
      {
        apiKey,
        model,
        system,
        messages: [{ role: 'user', content: userText }],
        maxTokens,
        // These are bounded structured-JSON calls — disable adaptive thinking so it can't consume the whole
        // token budget and truncate the JSON to empty (the intimacy-generation bug, 08 §17.9). Verified live:
        // sonnet + adaptive thinking + 1500 tokens → stop_reason `max_tokens`, empty output → "No usable
        // questions"; with thinking off the full budget goes to the JSON.
        extendedThinking: false,
      },
      () => {},
    );
  } catch {
    return { ok: false, reason: 'ERROR', message: 'Generation failed. Please try again.' };
  }

  const usage: UsageEvent = {
    id: uuid(),
    schemaVersion: 1,
    type,
    personId,
    model,
    at: now.toISOString(),
    inputTokens: streamed.usage.inputTokens,
    outputTokens: streamed.usage.outputTokens,
    cacheWriteTokens: streamed.usage.cacheWriteTokens,
    cacheReadTokens: streamed.usage.cacheReadTokens,
    costUsd: costOf(model, streamed.usage),
  };
  await recordUsage(fs, key, usage);
  return { ok: true, text: streamed.text, usage };
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
  // The intimacy acts the recipient already rated in onboarding (08 §19.3) — reframes the intimacy seeding so
  // it goes deeper on rated acts instead of re-asking them.
  coveredIntimacyActs?: readonly { label: string; rating: string }[];
}

/** Generate questions from a brief and/or the configured structured context. */
export async function generateQuestions(
  deps: AiDeps,
  request: GenerateRequest,
): Promise<GenerateResult> {
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
    count: request.count ?? 5,
    intimacyTopics: mergedIntimacyTopics(await readCustomIntimacyTopics(deps.fs)),
    ...(request.intimacyMode !== undefined ? { intimacyMode: request.intimacyMode } : {}),
    ...(request.recipientHistory !== undefined
      ? { recipientHistory: request.recipientHistory }
      : {}),
    ...(request.coveredIntimacyActs !== undefined
      ? { coveredIntimacyActs: request.coveredIntimacyActs }
      : {}),
  });

  // A generous output budget (thinking is off) — an intimacy set with long multi-choice option lists can run
  // past 1500 tokens; 2500 leaves headroom so the JSON is never truncated.
  const call = await runClaude(deps, GENERATION_SYSTEM, user, 'questionnaire.generate', 2500);
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
  const seen = new Set(request.existingPrompts.map(norm));
  const questions: Question[] = [];
  for (const raw of set.questions) {
    const q = toQuestion(raw);
    if (q && !seen.has(norm(q.prompt))) {
      seen.add(norm(q.prompt));
      questions.push(q);
    }
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
  const title = set.title?.trim();
  return { ok: true, questions, ...(title ? { title } : {}), usage: call.usage };
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

import { z } from 'zod';
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
import { checkBudget, costOf, recordUsage } from '../usage';
import {
  buildGenerationUserMessage,
  buildImproveUserMessage,
  buildVariantUserMessage,
  GENERATION_SYSTEM,
  IMPROVE_SYSTEM,
  VARIANT_SYSTEM,
} from './aiPrompts';
import { gatherGenerationContext, type GenerationContextRequest } from './contextProviders';

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

/** Generation returns an object: a short `title` (08 §16.4) + the questions array. */
const GeneratedSetSchema = z.object({
  title: z.string().optional(),
  questions: z.array(GeneratedQuestionSchema),
});

/** Pull the first JSON array out of a model reply (tolerates ```json fences / surrounding prose). */
export function extractJsonArray(text: string): unknown {
  const fenced = text.replace(/```json|```/gi, '');
  const start = fenced.indexOf('[');
  const end = fenced.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(fenced.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Pull the first JSON object out of a model reply (tolerates fences / surrounding prose). */
function extractJsonObject(text: string): unknown {
  const fenced = text.replace(/```json|```/gi, '');
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(fenced.slice(start, end + 1));
  } catch {
    return null;
  }
}

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
      { apiKey, model, system, messages: [{ role: 'user', content: userText }], maxTokens },
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
}

/** Generate questions from a brief and/or the configured structured context. */
export async function generateQuestions(
  deps: AiDeps,
  request: GenerateRequest,
): Promise<GenerateResult> {
  const context = await gatherGenerationContext(deps.fs, deps.key, request.context);
  const user = buildGenerationUserMessage({
    type: request.type,
    sensitivity: request.sensitivity,
    ...(request.brief !== undefined ? { brief: request.brief } : {}),
    context,
    existingPrompts: request.existingPrompts,
    count: request.count ?? 5,
  });

  const call = await runClaude(deps, GENERATION_SYSTEM, user, 'questionnaire.generate', 1500);
  if (!call.ok) return { ok: false, reason: call.reason, message: call.message };

  // Generation returns {title, questions}. Tolerate a legacy bare-array reply too, so an older model
  // response still yields questions (just no title).
  const validated = GeneratedSetSchema.safeParse(extractJsonObject(call.text));
  const legacyArray = validated.success
    ? null
    : z.array(GeneratedQuestionSchema).safeParse(extractJsonArray(call.text));
  const set = validated.success
    ? validated.data
    : legacyArray?.success
      ? { questions: legacyArray.data }
      : null;
  if (!set) {
    return {
      ok: false,
      reason: 'REFUSED',
      usage: call.usage,
      message: 'No usable questions came back. Try a clearer brief.',
    };
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
    return {
      ok: false,
      reason: 'REFUSED',
      usage: call.usage,
      message: 'No usable questions came back. Try a clearer brief.',
    };
  }
  const title = 'title' in set ? set.title?.trim() : undefined;
  return { ok: true, questions, ...(title ? { title } : {}), usage: call.usage };
}

/**
 * Generate one answerer's **personalized variant** of a compatibility questionnaire (08-questionnaires
 * §3.6/§13.5d): rewrite each canonical prompt warmly for the target person, keeping the SAME answer type +
 * `canonicalId` so the two variants stay aligned. Only prompts are personalized — the answer structure
 * (type/options/scale/branch) is preserved from the canonical question, and the question id is kept (so a
 * branch reference stays valid and the id doubles as the alignment key). The target context is limited to
 * **shareable** facts (the §13.3 privacy boundary — a `targetContext` with `includeAuthor: false`).
 */
export async function generateVariant(
  deps: AiDeps,
  input: { forName: string; questions: Question[]; targetContext: GenerationContextRequest },
): Promise<QuestionnaireGenerateResult> {
  const context = await gatherGenerationContext(deps.fs, deps.key, input.targetContext);
  const user = buildVariantUserMessage({
    forName: input.forName,
    ...(context.trim() ? { context } : {}),
    prompts: input.questions.map((q) => q.prompt),
  });
  const call = await runClaude(deps, VARIANT_SYSTEM, user, 'questionnaire.generate', 1200);
  if (!call.ok) return { ok: false, reason: call.reason, message: call.message };

  const validated = z.array(z.string()).safeParse(extractJsonArray(call.text));
  if (!validated.success || validated.data.length !== input.questions.length) {
    return {
      ok: false,
      reason: 'REFUSED',
      usage: call.usage,
      message: 'Couldn’t personalize this questionnaire. Please try again.',
    };
  }
  const questions: Question[] = input.questions.map((q, i) => {
    const personalized = validated.data[i]?.trim();
    return {
      ...q,
      canonicalId: q.canonicalId ?? q.id, // the alignment key (defaults to the canonical question id)
      ...(personalized ? { prompt: personalized } : {}),
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
    return {
      ok: false,
      reason: 'REFUSED',
      usage: call.usage,
      message: 'Couldn’t reword that one.',
    };
  }
  return { ok: true, prompt: text, usage: call.usage };
}

import { z } from 'zod';
import { classifyParseOutcome, extractJsonObject } from '../ai/jsonSalvage';
import type { CorrectableProfileField, Question } from '../schemas';
import { runClaude, type AiDeps } from './aiCall';
import { buildOwnSuppressionBlock } from '../tests/adaptive/steer';
import { SAFETY } from './aiPrompts';
import { sanitizeCorrectedQuestion } from './questionCorrection';

/**
 * Correct a question a recipient says is wrong (spec 08 §29, rewritten by §32).
 *
 * Two different objections arrive through the same affordance:
 * - a **wrong fact** — the question states something untrue about them ("you turned 39"); the claim is traced
 *   back to the record it came from so it can be fixed at source and stop recurring;
 * - **the answers don't fit** — nothing on file is disputed; the option set is simply wrong for the question.
 *
 * Either way the question is REWRITTEN FOR REAL — prompt, help, answer type, options and how many there are —
 * and the corrected question replaces the original in the send being answered. There is no display shim and no
 * mapping back to the sender's original wording: the person answers the corrected question, and that is what
 * gets recorded.
 *
 * Author-blind in the same sense as generation — the recipient's own facts are assembled host-side and never
 * returned to the sender.
 */

/** What the recipient is objecting to — only a `wrongFact` disputes a record on file (08 §32.7). */
export type CorrectionProblem = 'wrongFact' | 'answersDontFit' | 'other';

/** One on-record fact about the recipient, with the metadata the caller needs to correct it at source. */
export interface KnownFact {
  source: 'profile' | 'onboarding' | 'insight';
  /** A short human label of where it lives (e.g. "your birthday", "your Memory", "your onboarding"). */
  label: string;
  /** The fact text as the model should see it (e.g. "age: 39 (born 1987-05-14)"). */
  text: string;
  /** For an insight-sourced fact: the ids needed to flag it inaccurate. */
  insightId?: string;
  factId?: string;
  /** For a profile-sourced fact: which `Person` field it is, so the caller can offer an inline fix (§32.4). */
  field?: CorrectableProfileField;
  /** For a profile-sourced fact: the raw stored value, shown beside the proposed correction. */
  currentValue?: string;
}

export interface FactCorrectionResult {
  ok: boolean;
  /** What they objected to — only `wrongFact` disputes something on file (§32.7). */
  problem?: CorrectionProblem;
  /** The corrected question, ready to replace the original in the send (and the questionnaire). */
  question?: Question;
  /** The record the correction contradicts, when the model matched one confidently. */
  matched?: KnownFact;
  /**
   * The corrected value for a matched PROFILE field, in that field's own format, when the correction states
   * one plainly. Only ever a proposal — applying it is an explicit tap (§32.2), never a silent write.
   */
  proposedValue?: string;
  usage?: import('../schemas').UsageEvent;
  reason?: import('../schemas').AiFailureReason;
  message?: string;
}

const CorrectionSchema = z.object({
  // What the recipient is actually objecting to — only a `wrongFact` disputes an on-record claim (§32.7).
  // Defaults to 'other': an unsure or missing classification must NOT be read as "they disputed a fact on
  // file", because that is what drives source-tracing. Only an affirmative wrongFact does.
  problem: z.enum(['wrongFact', 'answersDontFit', 'other']).catch('other'),
  // The 1-based index of the matched fact in the numbered list, or 0 for "none clearly matches".
  matchedIndex: z.number().int().catch(0),
  // The corrected question, parsed loosely here and validated properly by `sanitizeCorrectedQuestion`
  // against the real `QuestionSchema` — so a malformed rewrite can never overwrite a working question.
  question: z.record(z.string(), z.unknown()).optional().catch(undefined),
  correctedValue: z.string().optional().catch(undefined),
});

const CORRECTION_SYSTEM = `${SAFETY}

The person answering a questionnaire has flagged that something about this question is wrong FOR THEM. You are given the question as JSON, their objection in their own words, and a NUMBERED list of facts currently on record about them.

FIRST, classify what they are objecting to:
- "wrongFact" — the question states or assumes a DETAIL ABOUT THEM that is untrue ("I'm 41, not 39", "I don't have kids").
- "answersDontFit" — the ANSWER OPTIONS are wrong for the question or leave them no honest choice ("none of these match", "these answers make no sense", "these have nothing to do with the question").
- "other" — anything else (confusing, badly worded, irrelevant).

THEN rewrite the question into one they can actually answer, and return the WHOLE corrected question as JSON:
1. Fix everything that is wrong — the prompt, the help line, and the answer options. You may change how many options there are, replace them entirely, reorder them, and change the answer "type" when a different kind of answer genuinely fits better. Give them a real, honest set of choices for THIS question, including a genuine "neither" / "it varies" where the honest answer isn't currently in the list.
2. Keep the question's INTENT — what it is trying to learn about them. Do not turn it into a different question.
3. Keep "id" exactly as given. Never invent facts about them.
4. The corrected question must be internally consistent: "singleChoice", "multiChoice", "thisOrThat" and "ranking" need an "options" array of at least two DISTINCT options; "rating" and "slider" need a "scale" with numeric min/max; "matrix" needs "matrix.rows"; "shortText", "longText", "yesNo" and "date" take no options.
5. Only for "wrongFact": decide which numbered record the objection contradicts and return its NUMBER, or 0 if none clearly matches. For "answersDontFit" and "other" ALWAYS return 0 — they are not disputing a record, so never guess one.
6. If the matched record is a profile field and their correction states the corrected value plainly, return it as "correctedValue" in that field's own format (a date as YYYY-MM-DD, otherwise their own wording). Omit it if they didn't say.
Return ONLY a JSON object: {"problem": "wrongFact" | "answersDontFit" | "other", "matchedIndex": number, "question": { ...the whole corrected question... }, "correctedValue"?: string}.`;

/** Classify + rewrite. One budget-gated, metered call; tolerant parse; honest failure (37). */
export async function resolveFactCorrection(
  deps: AiDeps,
  input: { question: Question; correction: string; knownFacts: KnownFact[] },
): Promise<FactCorrectionResult> {
  const facts = input.knownFacts;
  const numbered = facts.length
    ? facts.map((f, i) => `${i + 1}. [${f.source}] ${f.text}`).join('\n')
    : '(no facts on record)';
  const user = [
    `The question they're answering:\n${JSON.stringify(input.question, null, 2)}`,
    `What they say is wrong: "${input.correction}"`,
    `Facts on record about them:\n${numbered}`,
    `Return the JSON object.`,
  ].join('\n\n');

  // A whole-question rewrite is a larger reply than the §29 prompt-only one.
  // The rewrite REPLACES a question this person then answers, so it can introduce a term the original never
  // used. `deps.personId` is the objector — the recipient — which is exactly whose limits apply.
  const suppression = await buildOwnSuppressionBlock(deps.fs, deps.key, deps.personId);
  const call = await runClaude(
    deps,
    [CORRECTION_SYSTEM, suppression].filter(Boolean).join('\n\n'),
    user,
    'questionnaire.generate',
    2000,
  );
  if (!call.ok) return { ok: false, reason: call.reason, message: call.message };

  const parsed = CorrectionSchema.safeParse(extractJsonObject(call.text)).data;
  const question = sanitizeCorrectedQuestion(
    input.question,
    parsed?.question as Partial<Question> | undefined,
  );
  if (!question) {
    // A reply we can't turn into a VALID question is an honest failure — never overwrite a working question
    // with a broken one (a choice type with no options, a collapsed option set) just because JSON came back.
    const { reason, message } = classifyParseOutcome(call.text, 'correction');
    return { ok: false, reason, usage: call.usage, message };
  }
  // Only a wrong-FACT objection disputes a record. For "the answers don't fit" there is nothing on file to
  // trace, so a matched index is meaningless — ignore it rather than quoting an unrelated record at them.
  const problem = parsed?.problem ?? 'other';
  const idx = (parsed?.matchedIndex ?? 0) - 1;
  const matched =
    problem === 'wrongFact' && idx >= 0 && idx < facts.length ? facts[idx] : undefined;
  const proposedValue =
    matched?.source === 'profile' && matched.field && parsed?.correctedValue?.trim()
      ? parsed.correctedValue.trim()
      : undefined;
  return {
    ok: true,
    problem,
    question,
    ...(matched ? { matched } : {}),
    ...(proposedValue ? { proposedValue } : {}),
    usage: call.usage,
  };
}

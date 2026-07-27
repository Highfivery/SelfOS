import { z } from 'zod';
import { classifyParseOutcome, extractJsonObject } from '../ai/jsonSalvage';
import { runClaude, type AiDeps } from './aiCall';
import { SAFETY } from './aiPrompts';

/**
 * Correct a WRONG fact in a questionnaire question (spec 08 wrong-fact amendment). The recipient answering
 * has flagged that a detail the question states about them is wrong (e.g. "you turned 39" but they're 41).
 * This resolves WHERE the wrong fact came from (best-effort AI classification against their on-record facts)
 * AND rewrites the question so it no longer asserts the wrong detail — so they can answer the corrected one.
 *
 * The source fix (flagging a wrong insight / routing a profile or onboarding correction) is the caller's job;
 * this service only classifies + rewrites. Author-blind in the same sense as generation — the recipient's own
 * facts are assembled host-side and never returned to the sender.
 */

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
}

export interface FactCorrectionResult {
  ok: boolean;
  /** The question reworded to drop / fix the wrong assumption — applied to the recipient's local view. */
  rewrittenPrompt?: string;
  /** The record the correction contradicts, when the model matched one confidently. */
  matched?: KnownFact;
  usage?: import('../schemas').UsageEvent;
  reason?: import('../schemas').AiFailureReason;
  message?: string;
}

const CorrectionSchema = z.object({
  // The 1-based index of the matched fact in the numbered list, or 0 for "none clearly matches".
  matchedIndex: z.number().int().catch(0),
  rewrittenPrompt: z.string().min(1),
});

const CORRECTION_SYSTEM = `${SAFETY}

The person answering a questionnaire has flagged that a detail this question states ABOUT THEM is wrong. You are given the question, their correction in their own words, and a NUMBERED list of facts currently on record about them. Do two things:
1. Decide which numbered record (if any) the correction contradicts. Return its NUMBER, or 0 if none of them clearly matches.
2. Rewrite the question so it no longer states the wrong detail — use their corrected detail when it's clear, otherwise drop the wrong assumption entirely and ask the underlying question plainly. Keep the same intent and the same answer type. Do not invent new facts.
Return ONLY a JSON object: {"matchedIndex": number, "rewrittenPrompt": string}.`;

/** Classify + rewrite. One budget-gated, metered call; tolerant parse; honest failure (37). */
export async function resolveFactCorrection(
  deps: AiDeps,
  input: { questionPrompt: string; correction: string; knownFacts: KnownFact[] },
): Promise<FactCorrectionResult> {
  const facts = input.knownFacts;
  const numbered = facts.length
    ? facts.map((f, i) => `${i + 1}. [${f.source}] ${f.text}`).join('\n')
    : '(no facts on record)';
  const user = [
    `Question: "${input.questionPrompt}"`,
    `What they say is wrong: "${input.correction}"`,
    `Facts on record about them:\n${numbered}`,
    `Return the JSON object.`,
  ].join('\n\n');

  const call = await runClaude(deps, CORRECTION_SYSTEM, user, 'questionnaire.generate', 600);
  if (!call.ok) return { ok: false, reason: call.reason, message: call.message };

  const parsed = CorrectionSchema.safeParse(extractJsonObject(call.text)).data;
  if (!parsed?.rewrittenPrompt.trim()) {
    const { reason, message } = classifyParseOutcome(call.text, 'correction');
    return { ok: false, reason, usage: call.usage, message };
  }
  // Map the 1-based index → the KnownFact (0 or out-of-range → no confident match → the caller falls back to
  // letting the person pick the source).
  const idx = parsed.matchedIndex - 1;
  const matched = idx >= 0 && idx < facts.length ? facts[idx] : undefined;
  return {
    ok: true,
    rewrittenPrompt: parsed.rewrittenPrompt.trim(),
    ...(matched ? { matched } : {}),
    usage: call.usage,
  };
}

import { z } from 'zod';
import { classifyParseOutcome, extractJsonObject } from '../ai/jsonSalvage';
import type { CorrectableProfileField, Question } from '../schemas';
import { runClaude, type AiDeps } from './aiCall';
import { SAFETY } from './aiPrompts';
import {
  questionLabels,
  type ProposedRewrite,
  sanitizeRewrite,
  type QuestionLabels,
  type QuestionRewrite,
} from './questionLabels';

/**
 * Correct a WRONG fact in a questionnaire question (spec 08 §29, extended by §32). The recipient answering
 * has flagged that a detail the question states about them is wrong (e.g. "you turned 39" but they're 41).
 * This resolves WHERE the wrong fact came from (best-effort AI classification against their on-record facts)
 * AND rewrites the question so it no longer asserts the wrong detail.
 *
 * §32: the rewrite covers every VISIBLE label — prompt, help, option labels, scale anchors, matrix rows — not
 * just the prompt, because the wrong fact is often carried by the answers ("It's sharper at 39"). Structure is
 * never touched: `sanitizeRewrite` rejects any list whose length changed, so option count/order, matrix row
 * keys and branch triggers are frozen and the stored answer is still the sender's own option string.
 *
 * The source fix (flagging a wrong insight / applying a profile correction) is the caller's job; this service
 * only classifies + rewrites. Author-blind in the same sense as generation — the recipient's own facts are
 * assembled host-side and never returned to the sender.
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
  /** For a profile-sourced fact: which `Person` field it is, so the caller can offer an inline fix (§32.4). */
  field?: CorrectableProfileField;
  /** For a profile-sourced fact: the raw stored value, shown beside the proposed correction. */
  currentValue?: string;
}

export interface FactCorrectionResult {
  ok: boolean;
  /** The question's visible labels, reworded so none of them states the wrong detail (§32.3). */
  rewrite?: QuestionRewrite;
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
  // The 1-based index of the matched fact in the numbered list, or 0 for "none clearly matches".
  matchedIndex: z.number().int().catch(0),
  prompt: z.string().min(1),
  help: z.string().optional().catch(undefined),
  options: z.array(z.string()).optional().catch(undefined),
  scaleLabels: z
    .object({
      min: z.string().optional().catch(undefined),
      mid: z.string().optional().catch(undefined),
      max: z.string().optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
  matrixRows: z.array(z.string()).optional().catch(undefined),
  matrixPointLabels: z.array(z.string()).optional().catch(undefined),
  answersStillWrong: z.boolean().optional().catch(undefined),
  correctedValue: z.string().optional().catch(undefined),
});

const CORRECTION_SYSTEM = `${SAFETY}

The person answering a questionnaire has flagged that a detail this question states ABOUT THEM is wrong. You are given the question's visible text (its prompt and, where it has them, its answer options, help line, scale anchors and matrix rows), their correction in their own words, and a NUMBERED list of facts currently on record about them. Do all of the following:
1. Decide which numbered record (if any) the correction contradicts. Return its NUMBER, or 0 if none of them clearly matches.
2. Reword EVERY piece of visible text that states or depends on the wrong detail — the prompt AND the answer options, help line, scale anchors and matrix rows. A wrong fact is often carried by the answers ("It's sharper at 39"), and rewording only the prompt leaves the question unanswerable. Use their corrected detail when it's clear, otherwise drop the wrong assumption entirely and ask the underlying question plainly.
3. Return every list you were given with EXACTLY the same number of entries, in the same order — you are rewording labels, not changing the question. Never add, drop or reorder an option, matrix row or scale point. Never change the answer type. Do not invent new facts. Return a field unchanged if it was already fine.
4. If the answer options are not merely badly worded but structurally wrong for the question — the wrong kind of answer entirely, so no rewording could make them fit — set "answersStillWrong" to true.
5. If the matched record is a profile field and their correction states the corrected value plainly, return it as "correctedValue" in that field's own format (a date as YYYY-MM-DD, otherwise their own wording). Omit it if they didn't say.
Return ONLY a JSON object: {"matchedIndex": number, "prompt": string, "help"?: string, "options"?: string[], "scaleLabels"?: {"min"?: string, "mid"?: string, "max"?: string}, "matrixRows"?: string[], "matrixPointLabels"?: string[], "answersStillWrong"?: boolean, "correctedValue"?: string}.`;

/**
 * Render the question's visible text for the model — only the parts this question actually has.
 *
 * `applied` is any rewrite already showing on the recipient's screen, so a SECOND correction reasons about
 * what they can actually see rather than the original wording. Display text only; never a stored value.
 */
function describeQuestion(q: Question, applied?: AppliedLabels): string {
  const base = questionLabels(q);
  const l: QuestionLabels = { ...base };
  if (applied) {
    if (applied.prompt !== undefined) l.prompt = applied.prompt;
    if (applied.help !== undefined) l.help = applied.help;
    if (applied.options !== undefined) l.options = applied.options;
    if (applied.scaleLabels !== undefined) {
      const sc = applied.scaleLabels;
      l.scaleLabels = {
        ...(sc.min !== undefined ? { min: sc.min } : {}),
        ...(sc.mid !== undefined ? { mid: sc.mid } : {}),
        ...(sc.max !== undefined ? { max: sc.max } : {}),
      };
    }
    if (applied.matrixRows !== undefined) l.matrixRows = applied.matrixRows;
    if (applied.matrixPointLabels !== undefined) l.matrixPointLabels = applied.matrixPointLabels;
  }
  const lines = [`Prompt: "${l.prompt}"`, `Answer type: ${q.type}`];
  if (l.help) lines.push(`Help line: "${l.help}"`);
  if (l.options)
    lines.push(
      `Options (${l.options.length}):\n${l.options.map((o, i) => `  ${i + 1}. ${o}`).join('\n')}`,
    );
  if (l.scaleLabels) {
    const parts = [
      l.scaleLabels.min != null ? `min "${l.scaleLabels.min}"` : null,
      l.scaleLabels.mid != null ? `mid "${l.scaleLabels.mid}"` : null,
      l.scaleLabels.max != null ? `max "${l.scaleLabels.max}"` : null,
    ].filter(Boolean);
    lines.push(`Scale anchors: ${parts.join(', ')}`);
  }
  if (l.matrixRows)
    lines.push(
      `Matrix rows (${l.matrixRows.length}):\n${l.matrixRows.map((r, i) => `  ${i + 1}. ${r}`).join('\n')}`,
    );
  if (l.matrixPointLabels)
    lines.push(
      `Matrix point labels (${l.matrixPointLabels.length}): ${l.matrixPointLabels.join(' | ')}`,
    );
  return lines.join('\n');
}

/** The already-applied labels as they arrive over IPC — optional keys may be explicitly `undefined`. */
type AppliedLabels = Omit<ProposedRewrite, 'answersStillWrong'>;

/** Classify + rewrite. One budget-gated, metered call; tolerant parse; honest failure (37). */
export async function resolveFactCorrection(
  deps: AiDeps,
  input: {
    question: Question;
    correction: string;
    knownFacts: KnownFact[];
    /** A rewrite already applied to the recipient's view, when they're correcting it a second time. */
    applied?: AppliedLabels;
  },
): Promise<FactCorrectionResult> {
  const facts = input.knownFacts;
  const numbered = facts.length
    ? facts.map((f, i) => `${i + 1}. [${f.source}] ${f.text}`).join('\n')
    : '(no facts on record)';
  const user = [
    `The question they're answering:\n${describeQuestion(input.question, input.applied)}`,
    `What they say is wrong: "${input.correction}"`,
    `Facts on record about them:\n${numbered}`,
    `Return the JSON object.`,
  ].join('\n\n');

  // A full-question rewrite returns several lists, so it needs more room than the §29 prompt-only reply.
  const call = await runClaude(deps, CORRECTION_SYSTEM, user, 'questionnaire.generate', 1500);
  if (!call.ok) return { ok: false, reason: call.reason, message: call.message };

  const parsed = CorrectionSchema.safeParse(extractJsonObject(call.text)).data;
  if (!parsed?.prompt.trim()) {
    const { reason, message } = classifyParseOutcome(call.text, 'correction');
    return { ok: false, reason, usage: call.usage, message };
  }
  // Map the 1-based index → the KnownFact (0 or out-of-range → no confident match → the caller falls back to
  // letting the person pick the source).
  const idx = parsed.matchedIndex - 1;
  const matched = idx >= 0 && idx < facts.length ? facts[idx] : undefined;
  // A proposed value is only meaningful for a profile field the caller can actually write.
  const proposedValue =
    matched?.source === 'profile' && matched.field && parsed.correctedValue?.trim()
      ? parsed.correctedValue.trim()
      : undefined;
  return {
    ok: true,
    rewrite: sanitizeRewrite(input.question, parsed),
    ...(matched ? { matched } : {}),
    ...(proposedValue ? { proposedValue } : {}),
    usage: call.usage,
  };
}

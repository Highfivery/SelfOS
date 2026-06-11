import type { SensitivityTier } from '../schemas';

/**
 * Prompt builders for AI question generation + the gap-finder (08-questionnaires §3.1/§3.7/§5.1). The
 * **system** prefix is stable (so it can be prompt-cached); the per-request detail goes in the user
 * message. Safety/policy framing is embedded here (§8.1: original, evidence-informed, never clinical/
 * diagnostic; §8.3: sensitive tiers stay within Anthropic's usage policy) — there is no separate judge
 * call; output is schema-validated by the caller and the model refuses gracefully when it must.
 */

/** The answer-type catalog the model must choose from, with the fields each type needs. */
const ANSWER_TYPE_GUIDE = `Each question is an object with:
- "type": one of shortText, longText, singleChoice, multiChoice, rating, slider, ranking, thisOrThat, yesNo, date.
- "prompt": the question text (warm, clear, first- or second-person as fits).
- "required": boolean.
- "help": optional one-line clarifier.
- "options": string[] — REQUIRED for singleChoice, multiChoice, ranking, thisOrThat (>= 2 items).
- "scale": {"min":number,"max":number} — REQUIRED for rating and slider (e.g. 1..5).
Do NOT use matrix or allocation. Return ONLY a JSON array, no prose, no markdown fences.`;

const SAFETY = `You draft questions for SelfOS, a wellness / self-help tool — NOT medical, NOT diagnosis, NOT treatment. Write ORIGINAL, evidence-informed questions in a supportive voice. Never reproduce or imitate copyrighted or clinical/diagnostic instruments, never score diagnostically, never ask for medical/clinical self-assessment. Stay strictly within Anthropic's usage policy. If a request would require unsafe or out-of-policy content, return an empty array [].`;

export const GENERATION_SYSTEM = `${SAFETY}\n\nReturn a JSON array of questionnaire questions.\n${ANSWER_TYPE_GUIDE}`;

// `explicit` + `unfiltered` share generation framing on purpose: the tier distinction (age/DOB +
// consent gates) is enforced **recipient-side at send** (§8.3), not at generation time.
const SENSITIVITY_NOTE: Record<SensitivityTier, string> = {
  standard: '',
  intimacyGeneral:
    '\nThis is an intimacy questionnaire (general). Keep it respectful and consenting; nothing explicit.',
  explicit:
    '\nThis is a sensitive intimacy questionnaire. Adults only; keep it consenting, respectful, and within Anthropic policy.',
  unfiltered:
    '\nThis is a sensitive intimacy questionnaire. Adults only; keep it consenting, respectful, and within Anthropic policy.',
};

export function buildGenerationUserMessage(input: {
  type: string;
  sensitivity: SensitivityTier;
  brief?: string;
  context?: string;
  existingPrompts: string[];
  count: number;
}): string {
  const parts: string[] = [];
  parts.push(`Draft ${input.count} questions for a "${input.type}" questionnaire.`);
  parts.push(SENSITIVITY_NOTE[input.sensitivity]);
  if (input.brief?.trim()) parts.push(`\nWhat they want to explore: ${input.brief.trim()}`);
  if (input.context?.trim()) {
    parts.push(
      `\nUse this context about the people involved to tailor the questions:\n${input.context.trim()}`,
    );
  }
  if (input.existingPrompts.length > 0) {
    parts.push(
      `\nDo NOT duplicate or closely echo these already-present questions:\n${input.existingPrompts
        .map((p) => `- ${p}`)
        .join('\n')}`,
    );
  }
  return parts.filter((p) => p !== '').join('\n');
}

export function buildImproveUserMessage(input: {
  prompt: string;
  type: string;
  instruction: string;
}): string {
  return [
    `Rewrite this questionnaire question. Instruction: ${input.instruction}.`,
    `Answer type: ${input.type}. Original: "${input.prompt}"`,
    `Return ONLY the rewritten question text — no quotes, no prose, no options.`,
  ].join('\n');
}

export const GAP_FINDER_SYSTEM = `${SAFETY}\n\nYou suggest the NEXT questionnaires a person could send to people in their life to understand them better. Base suggestions only on the structured context provided (profiles, relationships, prior Insights) — never invent facts. Return a JSON array of up to 3 objects, each:
{"title": string, "type": string, "rationale": short string (why this, now), "questions": [{"type": string, "prompt": string, "required": boolean}] (2-4 sample questions)}.
Use the same answer types as generation. Return ONLY the JSON array.`;

export const ANALYSIS_SYSTEM = `${SAFETY}

Turn a person's questionnaire answers into a durable coaching Insight. Return ONLY a JSON object:
{"summary": string (2-4 sentences, what this means for supporting them), "facts": [{"text": string, "shareable": boolean}] (3-6 concise facts; "shareable" = safe to share with the person the fact is about), "confidence": "low" | "medium" | "high", "crisisFlag": boolean}.
Set "crisisFlag": true ONLY if the answers disclose risk of self-harm, abuse, or acute crisis. Never diagnose. Do not quote the raw answers back verbatim — synthesize.`;

export function buildAnalysisUserMessage(input: {
  title: string;
  qa: { prompt: string; answer: string }[];
}): string {
  const lines = input.qa.map((x) => `Q: ${x.prompt}\nA: ${x.answer}`).join('\n\n');
  return `Questionnaire: "${input.title}"\n\nAnswers:\n${lines}\n\nProduce the Insight JSON.`;
}

export function buildGapFinderUserMessage(context: string): string {
  return context.trim()
    ? `Here is the structured context about this person and their relationships:\n${context.trim()}\n\nSuggest up to 3 questionnaires that would help them learn something useful next.`
    : `There is little context yet. Suggest up to 3 broadly useful starter questionnaires (e.g. a check-in with a partner, friend feedback, a role review).`;
}

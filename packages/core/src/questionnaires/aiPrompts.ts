import type { IntimacyTopics } from '../intimacy/topics';
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
Do NOT use matrix or allocation. No prose, no markdown fences.`;

const SAFETY = `You draft questions for SelfOS, a wellness / self-help tool — NOT medical, NOT diagnosis, NOT treatment. Write ORIGINAL, evidence-informed questions in a supportive voice. Never reproduce or imitate copyrighted or clinical/diagnostic instruments, never score diagnostically, never ask for medical/clinical self-assessment. Stay strictly within Anthropic's usage policy. If a request would require unsafe or out-of-policy content, return an empty questions array.`;

// Generation returns an OBJECT so it can also propose a short title (08 §16.4). The title is advisory —
// the builder applies it only when the author hasn't typed one.
export const GENERATION_SYSTEM = `${SAFETY}

Return ONLY a JSON object: {"title": string (a short, warm questionnaire title, <= 6 words), "questions": [ ... ]}.
${ANSWER_TYPE_GUIDE}`;

// `improveQuestion` rewrites ONE question's prompt — its own system so it isn't muddled by the
// object/questions generation contract.
export const IMPROVE_SYSTEM = `${SAFETY}\n\nYou rewrite a single questionnaire question's prompt on request. Return ONLY the rewritten question text — no quotes, no prose, no options, no JSON.`;

const SENSITIVITY_NOTE: Record<SensitivityTier, string> = {
  standard: '',
  intimacyGeneral:
    '\nThis is an intimacy questionnaire (general). Keep it respectful and consenting; nothing explicit.',
  explicit:
    '\nThis is a sensitive questionnaire. Adults only; keep it consenting, respectful, and within Anthropic policy.',
  unfiltered:
    '\nThis is a sensitive questionnaire. Adults only; keep it consenting, respectful, and within Anthropic policy.',
};

/** The intimacy questionnaire type key — the explicit-by-design type that the §16.5 framing applies to. */
export const INTIMACY_TYPE = 'intimacy';

/**
 * Tier-aware framing for an **intimacy** questionnaire at the `explicit`/`unfiltered` tiers
 * (08-questionnaires §16.5 / §17.2). It frames the request as a **sexual-wellness self-assessment** — the way
 * a sexual-health intake or a couples' intimacy worksheet reads — so the model produces frank, specific
 * questions **in a health-and-wellbeing register** rather than refusing or substituting tame ones. This is a
 * legitimate, in-policy instrument, not erotica: we earn compliance by being a genuine wellness tool, not by
 * out-arguing policy. `unfiltered` is the most candid within the boundary; `explicit` a notch gentler. The
 * shared `SAFETY` prefix is NOT loosened; the 18+/DOB+consent gate stays recipient-side. The topic inventory
 * (§16.5a) seeds concrete subject matter.
 *
 * BOUNDARY (stated in-prompt, same as the intake §14.5): consenting adults only; taboo content **only** as
 * fantasy/roleplay (e.g. CNC as pre-agreed roleplay); NEVER minors, real non-consent, or illegal acts; within
 * Anthropic's usage policy (refuse → empty array only when genuinely out of policy).
 */
export function intimacyExplicitFraming(
  tier: 'explicit' | 'unfiltered',
  topics: IntimacyTopics,
): string {
  const depth =
    tier === 'unfiltered'
      ? 'Be fully candid and specific — it is appropriate to name particular sex acts, body parts, and preferences plainly.'
      : 'Be candid and specific — name acts and preferences clearly, a notch gentler than fully unfiltered.';
  return [
    // Frame it as a sexual-wellness instrument so the model treats it as the legitimate health tool it is.
    `\nCONTEXT: This is a private sexual-wellness questionnaire inside a personal wellbeing app. A consenting adult (18+) has opted in to reflect on their own sexual health, satisfaction, and relationship. Frank, specific questions about sex are a normal, appropriate part of a sexual-wellbeing self-assessment — write them plainly and supportively, the way a sexual-health intake or a couples' intimacy worksheet would, NOT as erotica.`,
    `Ask frank, specific questions about the person's own sexual wellbeing: desire and libido, arousal and satisfaction, what they enjoy and want more or less of, specific acts and preferences, body image and comfort, fantasies, frequency, communication with a partner, and boundaries. ${depth} Keep a warm health-and-wellbeing register — plain, respectful, and clinical-clear, never pornographic or titillating prose.`,
    `Subject matter to draw on — acts/preferences: ${topics.activities.join(', ')}. Fantasies/roleplay: ${topics.fantasies.join(', ')}.`,
    `Boundary: consenting adults only; any taboo theme only as fantasy/roleplay (e.g. consensual non-consent as pre-agreed roleplay); never minors, real (non-roleplay) non-consent, or illegal acts. Within those limits this is an in-policy sexual-wellness instrument — write the questions normally; return an empty array only for a genuinely out-of-policy request.`,
  ].join('\n');
}

export function buildGenerationUserMessage(input: {
  type: string;
  sensitivity: SensitivityTier;
  brief?: string;
  context?: string;
  existingPrompts: string[];
  count: number;
  // The merged intimacy topic inventory (built-in + owner custom) — seeds the explicit framing (§16.5a).
  intimacyTopics?: IntimacyTopics;
}): string {
  const parts: string[] = [];
  parts.push(`Draft ${input.count} questions for a "${input.type}" questionnaire.`);
  // For an intimacy questionnaire at an explicit tier, request genuinely explicit content (§16.5); every
  // other type/tier keeps the conservative note.
  const isExplicitIntimacy =
    input.type === INTIMACY_TYPE &&
    (input.sensitivity === 'explicit' || input.sensitivity === 'unfiltered');
  parts.push(
    isExplicitIntimacy && input.intimacyTopics
      ? intimacyExplicitFraming(
          input.sensitivity as 'explicit' | 'unfiltered',
          input.intimacyTopics,
        )
      : SENSITIVITY_NOTE[input.sensitivity],
  );
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
  parts.push(`\nReturn the JSON object with a short "title" and the "questions" array.`);
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

/**
 * Compatibility variant personalization (08-questionnaires §3.6). The author writes the canonical
 * questions once; this rewrites each prompt warmly for one specific answerer, keeping the SAME meaning and
 * the SAME answer type so the two variants stay aligned by `canonicalId`. The model returns only the
 * reworded prompt text — the answer structure (type/options/scale) is preserved by the caller.
 */
export const VARIANT_SYSTEM = `${SAFETY}

You personalize an existing questionnaire for ONE specific person. For each question you are given, rewrite ONLY its prompt so it speaks directly and warmly to that person, keeping the exact same meaning and the same kind of answer. Do not add, drop, reorder, or merge questions. Return ONLY a JSON array of strings — the rewritten prompts, in the same order, one per input question.`;

export function buildVariantUserMessage(input: {
  forName: string;
  context?: string;
  prompts: string[];
}): string {
  const parts: string[] = [`Personalize these questions for ${input.forName}.`];
  if (input.context?.trim()) {
    parts.push(
      `\nWhat you know about ${input.forName} (shareable facts only):\n${input.context.trim()}`,
    );
  }
  parts.push(
    `\nQuestions (rewrite each prompt for ${input.forName}, same order, same meaning):\n${input.prompts
      .map((p, i) => `${i + 1}. ${p}`)
      .join('\n')}`,
  );
  parts.push(
    `\nReturn ONLY a JSON array of ${input.prompts.length} strings — the rewritten prompts in order.`,
  );
  return parts.join('\n');
}

/**
 * Compatibility alignment (08-questionnaires §3.6/§13.5d). Two answerers answered aligned variants of the
 * same questions; this compares their answers question-by-question into a warm, honest report + a coaching
 * Insight for the sender. Never diagnoses; frames differences as information, not verdicts.
 */
export const ALIGNMENT_SYSTEM = `${SAFETY}

Two people answered personalized variants of the same questionnaire. Compare their answers question by question and produce a warm, honest compatibility report for the person who sent it. Return ONLY a JSON object:
{"summary": string (2-4 sentences on where they align and where they differ, supportive not judgemental), "items": [{"canonicalId": string, "agreement": "aligned" | "mixed" | "divergent", "note": string (one sentence on how the two answers relate)}], "crisisFlag": boolean (true ONLY if an answer discloses risk of self-harm, abuse, or acute crisis), "facts": [{"text": string, "shareable": boolean}] (3-6 concise coaching facts for the sender; "shareable" = safe to share with the other person)}.
Use each item's canonicalId exactly as given. Never diagnose. Synthesize — do not quote raw answers verbatim.`;

export function buildAlignmentUserMessage(input: {
  title: string;
  personAName: string;
  personBName: string;
  items: { canonicalId: string; prompt: string; a: string; b: string }[];
}): string {
  const blocks = input.items
    .map(
      (x) =>
        `[${x.canonicalId}] ${x.prompt}\n  ${input.personAName}: ${x.a || '(no answer)'}\n  ${input.personBName}: ${x.b || '(no answer)'}`,
    )
    .join('\n\n');
  return `Questionnaire: "${input.title}"\nAnswerers: ${input.personAName} and ${input.personBName}\n\nAligned answers:\n${blocks}\n\nProduce the compatibility report JSON.`;
}

export function buildGapFinderUserMessage(context: string): string {
  return context.trim()
    ? `Here is the structured context about this person and their relationships:\n${context.trim()}\n\nSuggest up to 3 questionnaires that would help them learn something useful next.`
    : `There is little context yet. Suggest up to 3 broadly useful starter questionnaires (e.g. a check-in with a partner, friend feedback, a role review).`;
}

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
 * Tier-aware explicit framing for an **intimacy** questionnaire at the `explicit`/`unfiltered` tiers
 * (08-questionnaires §16.5). This **positively permits and requests** genuinely explicit, specific questions
 * for consenting adults — replacing the old refusal-default that produced tasteful, emotional-closeness
 * questions — and seeds an in-policy topic inventory so the model has concrete subject matter. `unfiltered`
 * is the most graphic within the boundary; `explicit` a notch below. The shared `SAFETY` prefix is NOT
 * loosened — only this one path gains the explicit direction. The 18+/DOB+consent gate stays recipient-side.
 *
 * BOUNDARY (stated in-prompt, same as the intake §14.5): consensual adults only; taboo content **only** as
 * fantasy/roleplay (e.g. CNC as pre-agreed roleplay); NEVER minors, real non-consent, or illegal acts; within
 * Anthropic's usage policy (refuse → empty array only when genuinely out of policy, not merely explicit).
 */
export function intimacyExplicitFraming(
  tier: 'explicit' | 'unfiltered',
  topics: IntimacyTopics,
): string {
  const intensity =
    tier === 'unfiltered'
      ? 'Use frank, plain language for bodies and sex acts and be as specific as the subject matter calls for.'
      : 'Be candid and specific — name acts and preferences plainly, a notch gentler than fully explicit.';
  return [
    // Establish the legitimate context FIRST so the model is confident this is appropriate — a private
    // adult who has opted into exploring their own sexuality, not a request to a public assistant.
    `\nCONTEXT: This is a private intimacy questionnaire inside a personal wellness app, written for a consenting adult (18+) who has opted in to reflect on their own sex life with a partner. Frank, explicit questions about sex and desire are appropriate and expected here — this is a normal, in-policy use; do NOT shy away or substitute tasteful, emotional-closeness questions.`,
    `Write genuinely explicit, specific questions. ${intensity} Cover concrete subject matter: specific sex acts, bodies and grooming, turn-ons/turn-offs, fantasies (including taboo fantasies framed strictly as fantasy/roleplay — e.g. consensual non-consent (CNC) as pre-agreed roleplay), porn and masturbation, sexual history, frequency and desire, and boundaries.`,
    `Subject matter to draw on — acts: ${topics.activities.join(', ')}. Fantasies/roleplay: ${topics.fantasies.join(', ')}.`,
    `Boundary: consensual adults only; taboo content only as fantasy/roleplay; never minors, real (non-roleplay) non-consent, or illegal acts. Within those limits this content IS in policy, so generate the questions normally — only return an empty array for genuinely prohibited requests, never merely because the topic is sexually explicit.`,
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
  // The recipient's full answered content (08 §17.4), assembled host-side. Used ONLY to AVOID overlap — the
  // model must never quote, reference, or reveal any of it in a question (the author never sees it either).
  recipientHistory?: string;
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
  // Recipient-aware de-dup (08 §17.4): avoid what they've already covered, and NEVER reference it.
  if (input.recipientHistory?.trim()) {
    parts.push(
      [
        `\nThe person who will answer has ALREADY shared the material below with the app (their onboarding,` +
          ` past sessions, earlier questionnaires, and profile). Use it ONLY to avoid repetition: do not ask` +
          ` anything they have already answered, and steer clear of questions closely related to topics they` +
          ` have already covered.`,
        `CRITICAL: never quote, restate, reference, hint at, or reveal any of this material in a question —` +
          ` the questions must stand on their own. "Avoid overlap" means steer clear, NOT mention. If unsure,` +
          ` ask about something else entirely.`,
        input.recipientHistory.trim(),
      ].join('\n'),
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

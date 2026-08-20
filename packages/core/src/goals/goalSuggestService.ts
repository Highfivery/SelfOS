import {
  classifyParseOutcome,
  extractJsonArray,
  salvageJsonArray,
  tolerantArray,
} from '../ai/jsonSalvage';
import { SAFETY } from '../conversations/promptBuilder';
import { runClaude, type AiDeps } from '../questionnaires/aiCall';
import { buildOwnSuppressionBlock, buildPracticeGroundBlock } from '../tests/adaptive/steer';
import { profileReadBlock } from '../tests/adaptive/adaptiveService';
import { getGuidancePrefs } from '../conversations/guidanceService';
import { gatherGenerationContext, isThinContext } from '../questionnaires/contextProviders';
import {
  GoalSuggestionSchema,
  LIFE_AREAS,
  type GoalSuggestion,
  type GoalSuggestResult,
} from '../schemas';
import { listGoals } from './goalService';

/**
 * The Goals card "Suggest goals" tap (60-home-dashboard §3.1.3). A metered, budget-gated one-shot Claude call
 * (`goal.suggest`) that proposes 2-3 personal goals from the person's OWN structured context (profile,
 * relationships, prior Insights — never raw transcripts, the §13.3 boundary) and avoids goals they already
 * have. It NEVER auto-runs (explicit tap only, so no per-load spend) and PERSISTS NOTHING — the person accepts
 * one (→ `createGoal`), edits, or dismisses. Parsing is tolerant (37): a usable subset survives a truncated /
 * imperfect reply; a genuinely-empty result is classified honestly. Over budget / AI off → a calm state, no call.
 */
export const GOAL_SUGGEST_SYSTEM = `${SAFETY}

You propose personal GOALS a person could set for themselves, grounded ONLY in the structured context provided (their profile, relationships, and prior Insights) — never invent facts. A goal is a small, concrete, ACHIEVABLE commitment in the person's own life, phrased warmly in the second person ("Reach out to your sister this week", "Take one walk most days"). Prefer goals that build on what they already care about, or gently open a life-area they keep circling. Keep each specific and doable — not a vague aspiration.
Return ONLY a JSON array of up to 3 objects, each: {"text": string (the commitment, concrete + doable), "lifeArea": one of EXACTLY these values (or omit): ${LIFE_AREAS.join(
  ', ',
)}, "rationale": short string (why this, now)}. Do NOT restate a goal they already have. Return ONLY the JSON array.`;

export function buildGoalSuggestUserMessage(input: {
  context: string;
  existingGoals: string[];
}): string {
  const existing =
    input.existingGoals.length > 0
      ? `\n\nGoals they ALREADY have (never repeat these — suggest different ones):\n${input.existingGoals
          .map((g) => `- ${g}`)
          .join('\n')}`
      : '';
  return `What we know about this person:\n${input.context}${existing}\n\nPropose the goals JSON.`;
}

/** An empty-text suggestion catches to this sentinel and is dropped. */
const SUGGESTION_SENTINEL: GoalSuggestion = { text: '' };

/** Clamp a model-supplied life-area to the fixed taxonomy, or drop the field entirely. */
function withCleanLifeArea(s: GoalSuggestion): GoalSuggestion {
  const area = LIFE_AREAS.find((a) => a.toLowerCase() === (s.lifeArea ?? '').trim().toLowerCase());
  const out: GoalSuggestion = { text: s.text };
  if (s.rationale !== undefined) out.rationale = s.rationale;
  if (area) out.lifeArea = area;
  return out;
}

export async function suggestGoals(deps: AiDeps): Promise<GoalSuggestResult> {
  const context = await gatherGenerationContext(deps.fs, deps.key, {
    authorPersonId: deps.personId,
    includeAuthor: true,
    includeTarget: false,
    includeRelationship: false,
  });

  // Pre-call emptiness check (37 §11): with nothing to work from, say so WITHOUT spending — an empty state,
  // not an AI failure (no `reason`), so a post-call zero can be classified honestly.
  if (isThinContext(context)) {
    return { ok: false, message: 'Have a session or two first, and I’ll have goals to suggest.' };
  }

  const existingGoals = (await listGoals(deps.fs, deps.key, deps.personId))
    .filter((g) => g.status === 'open' || g.status === 'inProgress')
    .map((g) => g.text);

  // 74 §5.8 — the profile reaches the one feature it most obviously belongs in, and did not.
  //
  // `wantsToSay` IS a goal list the person never had to write: it is the hear/say gap, derived the moment
  // the bank is marked. Goals was proposing commitments from their profile and insights while the app held
  // an explicit, self-authored list of things they had said they wanted to work up to, and never looked.
  // Suppression rides along unconditionally, because a suggested goal is prose they read.
  /*
   * 74 §5.8a — suppression unconditional, the POSITIVE steer gated on the 18+ ack.
   *
   * `profileReadBlock` self-gates (its docstring explains why the gate lives in the helper). The practice
   * ground could not follow it there: `steer.ts` is imported BY `generationService`, which `guidanceService`
   * imports, so reading the prefs inside the helper would close a cycle. It has exactly one caller — this
   * one — so the gate sits here instead, and this comment is why it is not where its sibling's is.
   *
   * It matters because the block quotes their own explicit vocabulary verbatim; revoking the ack has to take
   * that away on the next call, the same as it takes away the profile read.
   */
  const adultAcked =
    (await getGuidancePrefs(deps.fs, deps.key, deps.personId)).adultAcknowledged === true;
  const [suppression, practice, read] = await Promise.all([
    buildOwnSuppressionBlock(deps.fs, deps.key, deps.personId),
    adultAcked ? buildPracticeGroundBlock(deps.fs, deps.key, deps.personId) : '',
    profileReadBlock(deps.fs, deps.key, deps.personId),
  ]);
  const call = await runClaude(
    deps,
    [GOAL_SUGGEST_SYSTEM, read, practice, suppression].filter(Boolean).join('\n\n'),
    buildGoalSuggestUserMessage({ context, existingGoals }),
    'goal.suggest',
    900,
  );
  if (!call.ok) return { ok: false, reason: call.reason, message: call.message };

  const whole = extractJsonArray(call.text);
  const raw = Array.isArray(whole) ? whole : salvageJsonArray(call.text);
  const parsed = tolerantArray(
    GoalSuggestionSchema,
    SUGGESTION_SENTINEL,
    (s) => s.text.trim() !== '',
  ).parse(raw);

  if (parsed.length === 0) {
    const { reason, message } = classifyParseOutcome(call.text, 'goal suggestions');
    return { ok: false, reason, usage: call.usage, message };
  }
  return { ok: true, suggestions: parsed.map(withCleanLifeArea), usage: call.usage };
}

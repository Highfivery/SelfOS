import { classifyParseOutcome, extractJsonObject } from '../ai/jsonSalvage';
import type { ClaudeClient, FileSystem } from '../host';
import { z } from 'zod';
import {
  ChallengeSuggestionSchema,
  type ChallengeSuggestion,
  type ChallengeSuggestionResult,
  type Insight,
  type ProactivityLevel,
  type UsageEvent,
} from '../schemas';
import { uuid } from '../id';
import { checkBudget, costOf, queryUsage, recordUsage } from '../usage';
import { PERSONA, SAFETY } from '../conversations/promptBuilder';
import { digestableInsights, feedableInsights, listInsightsForPerson } from '../insights';
import { summarizeOpenCommitments } from '../goals';
import { readEncryptedJson, writeEncryptedJson } from '../vault';
import { clampComfort, normalizeDomain, normalizeLifeArea } from './challengeService';

/**
 * The proactive challenge suggester (52-challenge-sessions §3.7/§5.3) — the ONE extra AI spend this spec
 * introduces (`challenge.suggest`). It reads a BOUNDED, STRUCTURED, TRANSCRIPT-FREE digest of the active
 * person's own recent insights (summaries + non-restricted/non-flagged facts — so a kink/test profile's
 * sexual facts are never in the digest, the gap-finder/40 boundary) + their open commitments, and produces
 * ONE grounded candidate challenge for the person to accept (→ starts a session), tweak, or dismiss. The
 * candidate is CACHED (view-only re-display costs nothing) and NOT promoted into the coach's grounding context.
 *
 * Privacy/safety (§8): per-person only; restricted + flagged facts are excluded from the digest, so hard-nos
 * and sensitive specifics never reach the model. Sexual/intimacy candidates are produced only when the 18+ ack
 * is present (`adultAllowed`); a candidate that comes back sexual without the ack is dropped. Budget-gated +
 * metered BEFORE parse; tolerant parse + honest reasons (spec 37). The API key stays in main.
 */

const SCHEMA_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The recency window the digest covers + how many insights it may name (bounded like the rest of context). */
const SUGGEST_WINDOW_DAYS = 60;
const MAX_INSIGHTS = 12;
/**
 * A cap on suggest passes in any rolling 7 days (§5.3) — the card appears at most per the cadence, but the
 * explicit-tap "Get a challenge idea" bypasses the throttle, so this stops a user spending it repeatedly. The
 * owner budget-override bypasses it (like a budget stop). Counted from the metered `challenge.suggest` events.
 */
const SUGGEST_WEEKLY_CAP = 7;

/** Cadence windows per proactivity level — how long after a fresh idea before the card re-prompts (§5.3). */
const CADENCE_WINDOW_DAYS: Record<Exclude<ProactivityLevel, 'off'>, number> = {
  gentle: 7,
  active: 3,
};

const suggestionPath = (personId: string): string => `people/${personId}/challenges/suggestion.enc`;

export async function getSuggestion(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<ChallengeSuggestion | null> {
  const raw = await readEncryptedJson(fs, suggestionPath(personId), key);
  if (!raw) return null;
  const parsed = ChallengeSuggestionSchema.safeParse(raw);
  return parsed.success && parsed.data.subjectPersonId === personId ? parsed.data : null;
}

/** Clear the cached suggestion (e.g. after the person accepts or dismisses it). No key needed. */
export async function clearSuggestion(fs: FileSystem, personId: string): Promise<void> {
  await fs.remove(suggestionPath(personId));
}

/**
 * Whether the "Get a challenge idea" card should appear (§5.3) — pure + unit-testable. Keyed on the proactivity
 * level (`off` ⇒ never), no active challenge (one experiment at a time), and a throttle so the card doesn't
 * re-prompt right after a fresh idea. The explicit-tap force-runs past this; the spend cap protects cost.
 */
export function shouldSuggestChallenge(
  state: { lastSuggestedAt?: string; hasActiveChallenge: boolean; level: ProactivityLevel },
  now: Date,
): boolean {
  if (state.level === 'off') return false;
  if (state.hasActiveChallenge) return false;
  if (state.lastSuggestedAt) {
    const last = new Date(state.lastSuggestedAt).getTime();
    if (Number.isFinite(last) && now.getTime() - last < CADENCE_WINDOW_DAYS[state.level] * DAY_MS) {
      return false; // already offered an idea recently
    }
  }
  return true;
}

/** The active person's own approved insights within the recency window (undated kept), bounded. */
function recentApprovedInsights(insights: Insight[], now: Date): Insight[] {
  const horizon = now.getTime() - SUGGEST_WINDOW_DAYS * DAY_MS;
  return insights
    .filter((i) => i.approved)
    .filter((i) => {
      const t = new Date(i.provenance.at).getTime();
      return !Number.isFinite(t) || t >= horizon;
    })
    .slice(0, MAX_INSIGHTS);
}

/**
 * Assemble the bounded, structured, transcript-free digest (§5.3). This pass emits each insight's SUMMARY and
 * carries no topic, so `digestableInsights` drops wholly-flagged AND restricted-fact insights ENTIRELY — a
 * sexual/intimacy challenge reflection (restricted, 52 §8.4) must not reach the suggester via its summary.
 */
function buildDigest(recent: Insight[], commitments: string): string {
  const lines = digestableInsights(recent).map((i) => {
    const facts = i.facts
      .filter((f) => !f.restricted && !f.flaggedInaccurate)
      .map((f) => f.text)
      .slice(0, 4)
      .join('; ');
    const area = i.categories[0] ? ` {${i.categories[0]}}` : '';
    return `- [${i.source}]${area} "${i.summary}"${facts ? ` — ${facts}` : ''}`;
  });
  return [
    'What this person has been reflecting on lately (most recent first):',
    lines.join('\n'),
    commitments,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function suggestGuidance(adultAllowed: boolean): string {
  const intimacy = adultAllowed
    ? `If — and only if — their own material clearly points to intimacy/sexual growth they want, a consensual-adult \
intimacy challenge is allowed (set "adult": true, "domain": "intimacy"); draw it only from their interests and \
curiosities, NEVER anything they'd treat as a hard no, and keep it gentle and consent-forward.`
    : `Do NOT suggest any sexual or intimate challenge.`;
  return `You are SelfOS's challenge coach, proposing ONE small "challenge" — a deliberately-stretching little \
experiment this person could try between now and a check-in, grounded in what they have actually been \
reflecting on. It is an INVITATION, never a verdict on them: small, specific, time-boxed, and \
achievable-but-stretching. Draw it from their own goals, avoided situations, stated values, or curiosities. \
Respect every boundary: never propose anything unsafe, coercive, clinical (a phobia/addiction/eating pattern \
→ that's for a professional, not a challenge), or anything they'd find shaming. ${intimacy} If there isn't \
enough to ground an honest, specific suggestion, say so rather than inventing one.

Respond with ONLY a JSON object: {"action": string (the suggested action, in warm second-person, the only \
required field), "why": string (one sentence on why it fits THEM, drawn from their material), "comfort": \
number (1 a gentle nudge … 5 a big leap), "lifeArea": string (optional, one life-area label), "domain": \
string (optional, one of: overcome, habit, horizons, novelty, intimacy), "adult": boolean (optional, true \
only for a consensual-adult intimacy challenge)}.`;
}

const DraftSchema = z.object({
  action: z.string().min(1),
  why: z.string().catch('').default(''),
  comfort: z.number().optional().catch(undefined),
  lifeArea: z.string().optional().catch(undefined),
  domain: z.string().optional().catch(undefined),
  adult: z.boolean().optional().catch(undefined),
});

function buildUsage(
  model: string,
  personId: string,
  at: string,
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheWriteTokens: number;
    cacheReadTokens: number;
  },
): UsageEvent {
  return {
    id: uuid(),
    schemaVersion: 1,
    type: 'challenge.suggest',
    personId,
    model,
    at,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    cacheReadTokens: usage.cacheReadTokens,
    costUsd: costOf(model, usage),
  };
}

export interface SuggestChallengeDeps {
  fs: FileSystem;
  key: Uint8Array;
  client: ClaudeClient;
  apiKey: string | null;
  model: string;
  personId: string;
  adultAllowed: boolean; // the per-person 18+ ack (§8.3) — gates sexual/intimacy candidates
  now: Date;
  override?: boolean;
}

/**
 * Run the suggester: budget-gated → bounded transcript-free digest → one Claude call → meter (`challenge.suggest`,
 * BEFORE parse) → tolerant parse (spec 37) → cache the candidate (overwrites the prior one). A sexual candidate
 * without the 18+ ack is dropped (safety net atop the prompt instruction). Does NOT decide cadence — the caller
 * gates that with `shouldSuggestChallenge`; this runs the pass when asked.
 */
export async function suggestChallenge(
  deps: SuggestChallengeDeps,
): Promise<ChallengeSuggestionResult> {
  const { fs, key, client, apiKey, model, personId, adultAllowed, now } = deps;
  if (!apiKey) return { ok: false, reason: 'NO_KEY', message: 'Add your Claude API key first.' };

  // Behind the context-feed boundary (a muted dream / restricted / flagged fact never feeds it), like synthesis.
  const insights = await feedableInsights(fs, key, await listInsightsForPerson(fs, key, personId));
  const recent = recentApprovedInsights(insights, now);
  const commitments = await summarizeOpenCommitments(fs, key, personId, now);
  if (recent.length === 0 && !commitments) {
    return {
      ok: false,
      reason: 'EMPTY',
      message: 'There isn’t enough yet to ground a challenge — have a session or two first.',
    };
  }

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

  if (!deps.override) {
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS).toISOString();
    const passes = await queryUsage(fs, key, {
      from: weekAgo,
      to: now.toISOString(),
      personId,
      type: 'challenge.suggest',
    });
    if (passes.length >= SUGGEST_WEEKLY_CAP) {
      return {
        ok: false,
        reason: 'CAPPED',
        message: 'You’ve had a few challenge ideas this week — check back in a few days.',
      };
    }
  }

  const digest = buildDigest(recent, commitments);
  const at = now.toISOString();

  let result;
  try {
    result = await client.stream(
      {
        apiKey,
        model,
        system: [PERSONA, SAFETY, suggestGuidance(adultAllowed)].join('\n\n'),
        messages: [{ role: 'user', content: digest }],
        maxTokens: 500,
        extendedThinking: false, // a bounded structured-JSON call — keep the whole budget for output
      },
      () => {},
    );
  } catch {
    return {
      ok: false,
      reason: 'ERROR',
      message: 'The idea couldn’t be written. Please try again.',
    };
  }

  // Meter BEFORE parse — a paid call whose JSON fails to parse is still billed (spec 06 / spec 37).
  await recordUsage(fs, key, buildUsage(model, personId, at, result.usage));

  const obj = extractJsonObject(result.text);
  const parsed = obj ? DraftSchema.safeParse(obj) : null;
  if (!parsed?.success) {
    const { reason, message } = classifyParseOutcome(result.text, 'challenge idea');
    return { ok: false, reason, message };
  }

  const lifeArea = normalizeLifeArea(parsed.data.lifeArea);
  const domain = normalizeDomain(parsed.data.domain);
  const adult = parsed.data.adult === true || domain === 'intimacy' || lifeArea === 'Intimacy';
  // Safety net: a sexual candidate without the 18+ ack is never surfaced (the prompt already forbids it).
  if (adult && !adultAllowed) {
    return {
      ok: false,
      reason: 'EMPTY',
      message: 'No challenge idea this time.',
    };
  }

  const suggestion: ChallengeSuggestion = {
    schemaVersion: SCHEMA_VERSION,
    subjectPersonId: personId,
    action: parsed.data.action.trim(),
    why: parsed.data.why.trim(),
    comfort: clampComfort(parsed.data.comfort),
    ...(lifeArea ? { lifeArea } : {}),
    ...(domain ? { domain } : {}),
    ...(adult ? { adult: true } : {}),
    computedAt: at,
  };
  await writeEncryptedJson(fs, suggestionPath(personId), suggestion, key);
  return { ok: true, suggestion };
}

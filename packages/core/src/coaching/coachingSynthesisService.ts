import { classifyParseOutcome, extractJsonObject } from '../ai/jsonSalvage';
import type { ClaudeClient, FileSystem } from '../host';
import { uuid } from '../id';
import { z } from 'zod';
import {
  CoachingSynthesisSchema,
  LIFE_AREAS,
  type CoachingSynthesis,
  type CoachingSynthesisResult,
  type Insight,
  type ProactivityLevel,
  type UsageEvent,
} from '../schemas';
import { checkBudget, costOf, queryUsage, recordUsage } from '../usage';
import { PERSONA, SAFETY } from '../conversations/promptBuilder';
import { digestableInsights, feedableInsights, listInsightsForPerson } from '../insights';
import { getPatternStats } from '../dreams';
import { readEncryptedJson, writeEncryptedJson } from '../vault';

/**
 * The cross-feature synthesis pass (40-proactive-coaching §3.3/§3.4) — the ONE extra AI spend this spec
 * introduces (`coaching.synthesize`). It reads a BOUNDED, STRUCTURED digest across the active person's recent
 * insights (sessions / dreams / questionnaires / intake — summaries + facts only, NEVER raw transcripts, the
 * gap-finder rule) + the deterministic dream pattern stats, and produces ONE gentle observation connecting a
 * theme across sources. Cached per-subject (view-only until acted on); NOT promoted into `summarizeForContext`.
 *
 * Privacy (§8): per-person only — the digest sees only the active person's OWN insights, and runs BEHIND the
 * shareable/restricted/flagged boundary (restricted + flagged facts never feed it). Budget-gated + metered
 * BEFORE parse (a paid call whose JSON fails is still billed). Tolerant parse + honest reasons (spec 37).
 */

const SCHEMA_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The recency window the digest covers, and how many insights it may name (bounded like the rest of context). */
const SYNTHESIS_WINDOW_DAYS = 30;
const MAX_INSIGHTS = 12;
/** Below this many in-window insights there isn't enough to say anything honest → EMPTY (no spend). */
const MIN_INSIGHTS = 2;
/**
 * A proactivity-specific cap on synthesis passes in any rolling 7 days (40 §3.4 / §11 Q4): the auto cadence
 * self-throttles (≤ once per 3–7 days), but the MANUAL "Look again" / "What are you noticing lately?" path
 * bypasses that throttle, so without this a user could spend it repeatedly. ~one/day is far above any genuine
 * use, so it only ever stops runaway spend. The owner budget-override bypasses it (like a budget stop).
 */
const SYNTHESIS_WEEKLY_CAP = 7;

/** Cadence windows + new-insight thresholds per proactivity level (40 §3.4 / §11 Q4). */
const CADENCE: Record<
  Exclude<ProactivityLevel, 'off'>,
  { windowDays: number; threshold: number }
> = {
  gentle: { windowDays: 7, threshold: 3 },
  active: { windowDays: 3, threshold: 2 },
};

const synthesisPath = (personId: string): string => `people/${personId}/coaching/synthesis.enc`;

export async function getSynthesis(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<CoachingSynthesis | null> {
  const raw = await readEncryptedJson(fs, synthesisPath(personId), key);
  if (!raw) return null;
  const parsed = CoachingSynthesisSchema.safeParse(raw);
  return parsed.success && parsed.data.subjectPersonId === personId ? parsed.data : null;
}

/** Clamp a model-supplied life-area to the fixed taxonomy (never trust it raw), or undefined. */
function normalizeLifeArea(area: string | undefined): string | undefined {
  if (!area) return undefined;
  return LIFE_AREAS.find((a) => a.toLowerCase() === area.trim().toLowerCase());
}

/**
 * The cadence/throttle decision (40 §3.4) — pure + unit-testable. Auto-synthesis runs at most once per the
 * level's window AND only once enough new insights have accrued since the last run. `off` never runs.
 */
export function shouldSynthesize(
  state: { lastSynthesizedAt?: string; newInsightCount: number; level: ProactivityLevel },
  now: Date,
): boolean {
  if (state.level === 'off') return false;
  const { windowDays, threshold } = CADENCE[state.level];
  if (state.lastSynthesizedAt) {
    const last = new Date(state.lastSynthesizedAt).getTime();
    if (Number.isFinite(last) && now.getTime() - last < windowDays * DAY_MS) return false; // throttled
  }
  return state.newInsightCount >= threshold;
}

/** How many of the person's OWN approved insights changed since `since` (or all, if no prior run). Pure. */
export function countNewInsights(insights: Insight[], since: string | undefined): number {
  return insights.filter((i) => i.approved && (!since || i.updatedAt > since)).length;
}

/** The active person's own approved insights within the recency window (undated kept), bounded. */
function recentApprovedInsights(insights: Insight[], now: Date): Insight[] {
  const horizon = now.getTime() - SYNTHESIS_WINDOW_DAYS * DAY_MS;
  return insights
    .filter((i) => i.approved)
    .filter((i) => {
      const t = new Date(i.provenance.at).getTime();
      return !Number.isFinite(t) || t >= horizon; // keep undated insights; drop clearly-old ones
    })
    .slice(0, MAX_INSIGHTS);
}

/**
 * Assemble the bounded, structured, transcript-free digest (§5.2). This pass emits each insight's SUMMARY and
 * carries no topic, so `digestableInsights` drops wholly-flagged AND restricted-fact insights ENTIRELY —
 * mirroring `summarizeForContext`'s boundary but without an on-topic exception (there's no topic here), so a
 * restricted reflection's summary (e.g. an intimacy challenge, 52 §8.4) can't re-assert via the synthesis pass.
 */
function buildDigest(recent: Insight[], dreamLines: string): string {
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
    'Recent reflections across this person’s life (most recent first):',
    lines.join('\n'),
    dreamLines,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** A short structured line of the recurring dream signal (top symbols/themes/emotions), or '' when none. */
function dreamPatternLine(stats: {
  symbols: { label: string; count: number }[];
  themes: { label: string; count: number }[];
  emotions: { label: string; count: number }[];
}): string {
  const top = (xs: { label: string; count: number }[]): string =>
    xs
      .filter((x) => x.count >= 2)
      .slice(0, 4)
      .map((x) => `${x.label}(×${x.count})`)
      .join(', ');
  const parts = [
    top(stats.themes) && `themes: ${top(stats.themes)}`,
    top(stats.symbols) && `symbols: ${top(stats.symbols)}`,
    top(stats.emotions) && `emotions: ${top(stats.emotions)}`,
  ].filter(Boolean);
  return parts.length ? `Recurring in their dreams — ${parts.join('; ')}.` : '';
}

const SYNTHESIS_GUIDANCE = `You are gently looking ACROSS this person's recent reflections — sessions, \
dreams, questionnaires, onboarding — for ONE honest, connecting thread worth wondering about together. This \
is a warm invitation to reflect, NOT a finding, diagnosis, or assessment. Offer at most one observation, in \
plain second-person language, naming where it shows up (e.g. "connection has come up across a couple of your \
recent dreams and last week's session — is that something you'd like to explore?"). If nothing genuinely \
recurs across more than one source, say so honestly rather than inventing a pattern. Never alarm; if anything \
suggests crisis, encourage reaching out to real support rather than offering an observation.

Respond with ONLY a JSON object: {"observation": string (the one gentle observation, 1–3 sentences), \
"sources": string[] (which surfaces it draws on, e.g. ["dreams","sessions"]), "lifeArea": string (optional, \
one life-area label if it clearly belongs to one)}.`;

const DraftSchema = z.object({
  observation: z.string().min(1),
  sources: z.array(z.string()).catch([]).default([]),
  lifeArea: z.string().optional().catch(undefined),
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
    type: 'coaching.synthesize',
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

export interface SynthesizeDeps {
  fs: FileSystem;
  key: Uint8Array;
  client: ClaudeClient;
  apiKey: string | null;
  model: string;
  personId: string;
  now: Date;
  override?: boolean;
}

/**
 * Run the cross-feature synthesis: budget-gated → bounded digest → one Claude call → meter (`coaching.synthesize`,
 * BEFORE parse) → tolerant parse (spec 37) → cache the `CoachingSynthesis` (overwrites the prior one). Does NOT
 * decide cadence — the caller gates that with `shouldSynthesize`; this just runs the pass when asked.
 */
export async function synthesize(deps: SynthesizeDeps): Promise<CoachingSynthesisResult> {
  const { fs, key, client, apiKey, model, personId, now } = deps;
  if (!apiKey) return { ok: false, reason: 'NO_KEY', message: 'Add your Claude API key first.' };

  // Run BEHIND the context-feed boundary (15-shareability §4.2): a dream the user muted to "private journal"
  // (`informsContext: false`) must NOT leak its insight into this AI pass — exactly the cross-feature link the
  // synthesis is most likely to surface. `feedableInsights` drops those (and missing/corrupt-dream cases
  // fail-closed), matching `summarizeForContext`.
  const insights = await feedableInsights(fs, key, await listInsightsForPerson(fs, key, personId));
  // Gate on RECENT (in-window) approved insights, not all-time — so an all-stale history can't bill an
  // empty digest (the digest itself only covers the same window).
  const recent = recentApprovedInsights(insights, now);
  if (recent.length < MIN_INSIGHTS) {
    return {
      ok: false,
      reason: 'EMPTY',
      message: 'There isn’t enough recent reflection to notice a pattern yet.',
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

  // Proactivity-specific cap (40 §3.4): count this person's synthesis passes in the trailing 7 days and stop
  // before spending a (cap+1)th — so the manual "Look again" path can't run away on cost. The owner override
  // bypasses it, like a budget stop. Counted from the SAME metered `coaching.synthesize` events.
  if (!deps.override) {
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS).toISOString();
    const passes = await queryUsage(fs, key, {
      from: weekAgo,
      to: now.toISOString(),
      personId,
      type: 'coaching.synthesize',
    });
    if (passes.length >= SYNTHESIS_WEEKLY_CAP) {
      return {
        ok: false,
        reason: 'CAPPED',
        message: 'You’ve reached this week’s reflections — check back in a few days.',
      };
    }
  }

  const stats = await getPatternStats(fs, key, personId, 'all', now);
  const digest = buildDigest(recent, dreamPatternLine(stats));
  const at = now.toISOString();

  let result;
  try {
    result = await client.stream(
      {
        apiKey,
        model,
        system: [PERSONA, SAFETY, SYNTHESIS_GUIDANCE].join('\n\n'),
        messages: [{ role: 'user', content: digest }],
        maxTokens: 600,
        extendedThinking: false, // a bounded structured-JSON call — keep the whole budget for output
      },
      () => {},
    );
  } catch {
    return {
      ok: false,
      reason: 'ERROR',
      message: 'The reflection couldn’t be written. Please try again.',
    };
  }

  // Meter BEFORE parse — a paid call whose JSON fails to parse is still billed (spec 06 / spec 37).
  await recordUsage(fs, key, buildUsage(model, personId, at, result.usage));

  const obj = extractJsonObject(result.text);
  const parsed = obj ? DraftSchema.safeParse(obj) : null;
  if (!parsed?.success) {
    const { reason, message } = classifyParseOutcome(result.text, 'observation');
    return { ok: false, reason, message };
  }

  const synthesis: CoachingSynthesis = {
    schemaVersion: SCHEMA_VERSION,
    subjectPersonId: personId,
    observation: parsed.data.observation.trim(),
    sources: parsed.data.sources,
    ...(normalizeLifeArea(parsed.data.lifeArea)
      ? { lifeArea: normalizeLifeArea(parsed.data.lifeArea) }
      : {}),
    computedAt: at,
    windowFrom: new Date(now.getTime() - SYNTHESIS_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10),
    windowTo: at.slice(0, 10),
  };
  await writeEncryptedJson(fs, synthesisPath(personId), synthesis, key);
  return { ok: true, synthesis };
}

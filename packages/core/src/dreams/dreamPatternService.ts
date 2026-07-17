import type { ClaudeClient, FileSystem } from '../host';
import { uuid } from '../id';
import type {
  Dream,
  DreamAnalysis,
  DreamApproveResult,
  DreamNarrativeResult,
  DreamPatternCount,
  DreamPatternStats,
  DreamPatternWindow,
  Insight,
  UsageEvent,
} from '../schemas';
import { checkBudget, costOf, recordUsage } from '../usage';
import { PERSONA, SAFETY } from '../conversations/promptBuilder';
import { deleteInsight, producedFactShare, saveInsight } from '../insights';
import { getAnalysis, getPatternSummary, listDreams, savePatternSummary } from './dreamService';

/**
 * Cross-dream patterns (12-dreams §3.5/§5.1). Two halves:
 *
 * 1. **Deterministic stats** — a pure, cheap aggregation over each dream's metadata + its analysis's
 *    structured tags (recurring symbols/themes/people/emotions, lucid/nightmare counts, mood/vividness
 *    trends), plus the **recurring-nightmare nudge** signal (12 §8.2). No Claude, fully testable.
 * 2. **The AI narrative** — a budget-gated `dream.patterns` pass over a digest of recent dreams, cached as
 *    a `DreamPatternSummary`, view-only until the dreamer approves it into context as a cross-dream
 *    Insight (`source: 'dream'`, NO `dreamId`).
 *
 * Patterns are dreamer-only; the API key never leaves the host.
 */

/** The recurring-nightmare deterministic backstop (12 §8.2): N nightmares within a recent window. */
export const NIGHTMARE_NUDGE_COUNT = 3;
export const NIGHTMARE_NUDGE_WINDOW_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;
const TOP_N = 8; // how many ranked entries each frequency list keeps
const NARRATIVE_WINDOW_DAYS = 90; // recency horizon fed to the AI narrative
const NARRATIVE_MAX_DREAMS = 25; // cap the digest so the prompt stays bounded

/** A dream paired with its analysis (absent until synthesized) — the unit the stats aggregate over. */
export interface PatternEntry {
  dream: Dream;
  analysis: DreamAnalysis | null;
}

/** The date the dream occurred (or, failing that, when it was logged) — YYYY-MM-DD. */
function occurredDate(dream: Dream): string {
  return (dream.dreamDate ?? dream.createdAt).slice(0, 10);
}

function windowStart(window: DreamPatternWindow, now: Date): number | null {
  if (window === 'all') return null;
  const days = window === '30d' ? 30 : 90;
  return now.getTime() - days * DAY_MS;
}

/** Rank a `key → {count,label,personId}` tally most-frequent first (ties broken alphabetically). */
function rank(
  tally: Map<string, { count: number; label: string; personId?: string }>,
): DreamPatternCount[] {
  return [...tally.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, TOP_N)
    .map((entry) => ({
      label: entry.label,
      count: entry.count,
      ...(entry.personId !== undefined ? { personId: entry.personId } : {}),
    }));
}

/** Tally simple string tags (emotions/symbols/themes) by a lowercased key, keeping first-seen casing. */
function tallyTags(
  entries: PatternEntry[],
  pick: (a: DreamAnalysis) => string[],
): DreamPatternCount[] {
  const tally = new Map<string, { count: number; label: string }>();
  for (const { analysis } of entries) {
    if (!analysis) continue;
    for (const raw of pick(analysis)) {
      const label = raw.trim();
      if (!label) continue;
      const key = label.toLowerCase();
      const existing = tally.get(key);
      if (existing) existing.count += 1;
      else tally.set(key, { count: 1, label });
    }
  }
  return rank(tally);
}

/** People frequency: merge dream `people` refs (name or People-graph id) with analysis `tags.people`. */
function tallyPeople(entries: PatternEntry[]): DreamPatternCount[] {
  const tally = new Map<string, { count: number; label: string; personId?: string }>();
  const bump = (key: string, label: string, personId?: string): void => {
    const existing = tally.get(key);
    if (existing) {
      existing.count += 1;
      if (personId !== undefined && existing.personId === undefined) existing.personId = personId;
    } else {
      tally.set(key, { count: 1, label, ...(personId !== undefined ? { personId } : {}) });
    }
  };
  for (const { dream, analysis } of entries) {
    for (const ref of dream.people) {
      const name = ref.name?.trim();
      if (name) bump(name.toLowerCase(), name, ref.personId);
      else if (ref.personId) bump(`id:${ref.personId}`, 'Someone', ref.personId);
    }
    for (const raw of analysis?.tags.people ?? []) {
      const name = raw.trim();
      if (name) bump(name.toLowerCase(), name);
    }
  }
  return rank(tally);
}

/** A sorted (ascending by date) trend series from a chosen numeric dream field. */
function trend(
  entries: PatternEntry[],
  pick: (d: Dream) => number | undefined,
): { date: string; value: number }[] {
  return entries
    .map(({ dream }) => ({ date: occurredDate(dream), value: pick(dream) }))
    .filter((point): point is { date: string; value: number } => point.value !== undefined)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Compute deterministic cross-dream stats over ALL of a person's dreams. The frequency lists + trends use
 * the chosen `window`; the recurring-nightmare nudge always uses a fixed recent window (12 §8.2) computed
 * over the full set, so a longer view window never dilutes the safety signal.
 */
export function computePatternStats(
  allEntries: PatternEntry[],
  window: DreamPatternWindow,
  now: Date,
): DreamPatternStats {
  const start = windowStart(window, now);
  const windowed =
    start === null
      ? allEntries
      : allEntries.filter(({ dream }) => new Date(occurredDate(dream)).getTime() >= start);

  const nudgeStart = now.getTime() - NIGHTMARE_NUDGE_WINDOW_DAYS * DAY_MS;
  const recent = allEntries.filter(
    ({ dream }) => new Date(occurredDate(dream)).getTime() >= nudgeStart,
  );
  const recentNightmares = recent.filter(({ dream }) => dream.nightmare).length;
  const recentDistress = recent.some(({ analysis }) => analysis?.distressSignal === true);
  const nightmareNudge = recentNightmares >= NIGHTMARE_NUDGE_COUNT || recentDistress;

  return {
    window,
    dreamCount: windowed.length,
    analyzedCount: windowed.filter(({ analysis }) => analysis !== null).length,
    symbols: tallyTags(windowed, (a) => a.tags.symbols),
    themes: tallyTags(windowed, (a) => a.tags.themes),
    people: tallyPeople(windowed),
    emotions: tallyTags(windowed, (a) => a.tags.emotions),
    lucidCount: windowed.filter(({ dream }) => dream.lucid).length,
    nightmareCount: windowed.filter(({ dream }) => dream.nightmare).length,
    moodTrend: trend(windowed, (d) => d.mood),
    vividnessTrend: trend(windowed, (d) => d.vividness),
    nightmareNudge,
  };
}

/** Load a person's dreams + analyses and compute the windowed stats. */
export async function getPatternStats(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  window: DreamPatternWindow,
  now: Date,
): Promise<DreamPatternStats> {
  const dreams = await listDreams(fs, key, personId);
  const entries = await Promise.all(
    dreams.map(async (dream) => ({
      dream,
      analysis: await getAnalysis(fs, key, personId, dream.id),
    })),
  );
  return computePatternStats(entries, window, now);
}

const PATTERNS_GUIDANCE = `The person has been keeping a dream journal. Below is a digest of their recent \
dreams. Reflect gently on what you notice ACROSS them — recurring images, emotional threads, or shifts \
over time — in a warm, brief paragraph or two. Offer it as something to wonder about, never as a fixed \
reading or diagnosis. If recurring distress or nightmares stand out, note it kindly and suggest that \
persistent distressing dreams can be worth talking through with a professional. Write only the reflection, \
no preamble.`;

/** A compact, bounded digest of recent dreams for the narrative prompt (structured, not raw transcripts). */
function buildDigest(entries: PatternEntry[]): string {
  const lines = entries
    .slice(0, NARRATIVE_MAX_DREAMS)
    .map(({ dream, analysis }) => {
      const flags = [dream.lucid ? 'lucid' : '', dream.nightmare ? 'nightmare' : '']
        .filter(Boolean)
        .join(',');
      const mood = dream.mood !== undefined ? ` mood:${dream.mood}` : '';
      const head = `- ${occurredDate(dream)}${flags ? ` [${flags}]` : ''}${mood}`;
      if (!analysis) return `${head} — (not analyzed) "${dream.narrative.slice(0, 120)}"`;
      const tags = [
        analysis.tags.emotions.length ? `emotions[${analysis.tags.emotions.join(', ')}]` : '',
        analysis.tags.symbols.length ? `symbols[${analysis.tags.symbols.join(', ')}]` : '',
        analysis.tags.themes.length ? `themes[${analysis.tags.themes.join(', ')}]` : '',
      ]
        .filter(Boolean)
        .join(' ');
      return `${head} — "${analysis.summary}" ${tags}`;
    })
    .join('\n');
  return `Recent dreams (most recent first):\n${lines}`;
}

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
    type: 'dream.patterns',
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

async function overBudget(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  now: Date,
  override: boolean | undefined,
): Promise<boolean> {
  const person = await checkBudget(fs, key, { scope: 'person', personId, now, override });
  const app = await checkBudget(fs, key, { scope: 'app', now, override });
  return person.state === 'over' || app.state === 'over';
}

export interface DreamNarrativeDeps {
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
 * Generate the cross-dream AI narrative over recent dreams, meter it (`dream.patterns`), and cache it as a
 * `DreamPatternSummary` (view-only until approved). Re-generating drops any prior approved Insight — the
 * fresh narrative must be re-approved (mirrors the analysis re-synth, 12 §3.6).
 */
export async function generatePatternNarrative(
  deps: DreamNarrativeDeps,
): Promise<DreamNarrativeResult> {
  const { fs, key, client, apiKey, model, personId, now } = deps;
  if (!apiKey) return { ok: false, reason: 'NO_KEY', message: 'Add your Claude API key first.' };

  const dreams = await listDreams(fs, key, personId);
  const horizon = now.getTime() - NARRATIVE_WINDOW_DAYS * DAY_MS;
  const recent = dreams.filter((dream) => new Date(occurredDate(dream)).getTime() >= horizon);
  if (recent.length === 0) {
    return { ok: false, reason: 'EMPTY', message: 'Log a few dreams first to see patterns.' };
  }

  if (await overBudget(fs, key, personId, now, deps.override)) {
    return { ok: false, reason: 'BUDGET', message: 'AI budget reached for this period.' };
  }

  const entries: PatternEntry[] = await Promise.all(
    recent.map(async (dream) => ({
      dream,
      analysis: await getAnalysis(fs, key, personId, dream.id),
    })),
  );
  const ordered = [...entries].sort((a, b) =>
    occurredDate(a.dream) < occurredDate(b.dream) ? 1 : -1,
  );
  // Only the newest N dreams are actually fed to the model — derive the cached window from THAT slice so
  // windowFrom/To never claim a wider range than the narrative was written from.
  const digested = ordered.slice(0, NARRATIVE_MAX_DREAMS);

  const at = now.toISOString();
  let result;
  try {
    result = await client.stream(
      {
        apiKey,
        model,
        system: [PERSONA, SAFETY, PATTERNS_GUIDANCE].join('\n\n'),
        messages: [{ role: 'user', content: buildDigest(digested) }],
        // Bounded narrative: disable adaptive thinking so it keeps the whole budget for the prose
        // (left on, thinking shares `maxTokens` and can starve the narrative to empty).
        maxTokens: 800,
        extendedThinking: false,
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

  const usage = buildUsage(model, personId, at, result.usage);
  await recordUsage(fs, key, usage);

  // Re-generation drops the prior narrative's Insight so a stale reading can't keep feeding the coach.
  const prior = await getPatternSummary(fs, key, personId);
  if (prior?.insightId) await deleteInsight(fs, personId, prior.insightId);

  const dates = digested.map((entry) => occurredDate(entry.dream)).sort();
  const summary = {
    schemaVersion: 1,
    personId,
    narrative: result.text.trim(),
    windowFrom: dates[0] ?? at.slice(0, 10),
    windowTo: dates[dates.length - 1] ?? at.slice(0, 10),
    computedAt: at,
  };
  await savePatternSummary(fs, key, summary);
  return { ok: true, summary, usage };
}

/**
 * Approve the cached narrative into the coach's memory as a cross-dream Insight (`source: 'dream'`, no
 * `dreamId`). Gated by `dreams.memoryEnabled` (passed in by the host).
 */
export async function approvePatternNarrative(deps: {
  fs: FileSystem;
  key: Uint8Array;
  personId: string;
  memoryEnabled: boolean;
  now: Date;
}): Promise<DreamApproveResult> {
  const { fs, key, personId, memoryEnabled, now } = deps;
  if (!memoryEnabled) {
    return {
      ok: false,
      reason: 'MEMORY_DISABLED',
      message: 'Dream memory is turned off in settings.',
    };
  }
  const summary = await getPatternSummary(fs, key, personId);
  if (!summary) {
    return {
      ok: false,
      reason: 'NOT_FOUND',
      message: 'There’s no pattern reflection to approve yet.',
    };
  }

  const at = now.toISOString();
  const insightId = summary.insightId ?? uuid();
  const insight: Insight = {
    id: insightId,
    schemaVersion: 1,
    source: 'dream',
    subjectPersonId: personId,
    summary: 'What I’m noticing across recent dreams',
    facts: [{ id: uuid(), text: summary.narrative, ...producedFactShare() }],
    confidence: 'medium',
    categories: ['Emotions & patterns'], // cross-dream patterns map to the emotion/pattern area (20-memory §3.1)
    approved: true,
    provenance: { at }, // cross-dream: no single dreamId
    createdAt: at,
    updatedAt: at,
  };
  await saveInsight(fs, key, insight);
  await savePatternSummary(fs, key, { ...summary, insightId });
  return { ok: true, insightId };
}

/** Remove the narrative from context: delete its Insight + unlink (the cached narrative stays). */
export async function removePatternNarrativeFromContext(deps: {
  fs: FileSystem;
  key: Uint8Array;
  personId: string;
}): Promise<void> {
  const { fs, key, personId } = deps;
  const summary = await getPatternSummary(fs, key, personId);
  if (!summary?.insightId) return;
  await deleteInsight(fs, personId, summary.insightId);
  const cleared = { ...summary };
  delete cleared.insightId;
  await savePatternSummary(fs, key, cleared);
}

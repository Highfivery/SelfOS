import type { Insight, InsightSource } from '@shared/schemas';

/**
 * Pure stat derivations for the Memory overview (44 → 57). Computed locally from the already-loaded,
 * already-scoped own-insight list — no extra IPC, no AI. Feeds the "N things learned" count + the "how well
 * it knows you" read (see overview.ts). Tested in stats.test.ts.
 */

export interface OverviewStat {
  /** Live (non-flagged) facts SelfOS knows about the person — the honest "N things." */
  total: number;
  /** Per-source live-fact counts, only sources with > 0, in a stable order. */
  bySource: { source: InsightSource; count: number }[];
  /** Most recent `updatedAt` across the person's approved insights, or undefined when none. */
  lastUpdated: string | undefined;
}

export interface ConfidenceStat {
  high: number;
  medium: number;
  low: number;
  /** Number of approved insights the distribution is over. */
  total: number;
}

const SOURCE_ORDER: InsightSource[] = ['intake', 'session', 'dream', 'questionnaire', 'test'];

/** "What SelfOS knows" — live-fact counts by source + when it last changed (§3.2). */
export function overviewStats(ownApproved: Insight[]): OverviewStat {
  const counts = new Map<InsightSource, number>();
  let lastUpdated: string | undefined;
  for (const insight of ownApproved) {
    const live = insight.facts.filter((f) => !f.flaggedInaccurate).length;
    counts.set(insight.source, (counts.get(insight.source) ?? 0) + live);
    if (lastUpdated === undefined || insight.updatedAt > lastUpdated)
      lastUpdated = insight.updatedAt;
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const bySource = SOURCE_ORDER.filter((s) => (counts.get(s) ?? 0) > 0).map((source) => ({
    source,
    count: counts.get(source) ?? 0,
  }));
  return { total, bySource, lastUpdated };
}

/** "How well SelfOS feels it knows you" — the confidence distribution over approved insights (§3.2). */
export function confidenceStats(ownApproved: Insight[]): ConfidenceStat {
  let high = 0;
  let medium = 0;
  let low = 0;
  for (const insight of ownApproved) {
    if (insight.confidence === 'high') high += 1;
    else if (insight.confidence === 'medium') medium += 1;
    else low += 1;
  }
  return { high, medium, low, total: ownApproved.length };
}

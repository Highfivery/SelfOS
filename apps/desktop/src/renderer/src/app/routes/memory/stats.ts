import type { Insight, InsightSource, OutboundSharing, RelationshipType } from '@shared/schemas';
import { RELATIONSHIP_TYPE_ORDER } from '@selfos/core/sharing';

/**
 * Pure stat derivations for the Memory dashboard's summary header (44-memory-dashboard §3.2). All computed
 * locally from the already-loaded, already-scoped lists — no extra IPC, no AI. Tested in stats.test.ts.
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

export interface SharingStat {
  /** Total items the person currently shares (facts + intake answers). */
  sharedCount: number;
  /** Per-relationship-type item counts, only types with > 0, in `RELATIONSHIP_TYPE_ORDER`. */
  byType: { type: RelationshipType; count: number }[];
  /** Legacy broadcast items (shared with everyone) — surfaced distinctly so the picture stays honest. */
  broadcastCount: number;
}

const SOURCE_ORDER: InsightSource[] = ['intake', 'session', 'dream', 'questionnaire', 'test'];

export const SOURCE_LABEL: Record<InsightSource, string> = {
  intake: 'Onboarding',
  session: 'Sessions',
  dream: 'Dreams',
  questionnaire: 'Questionnaires',
  test: 'Self-assessments',
};

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

/** "What you share & with whom" — item totals + a per-type breakdown from `listOutboundSharing` (§3.2). */
export function sharingStats(outbound: OutboundSharing): SharingStat {
  const byType = new Map<RelationshipType, number>();
  let broadcastCount = 0;
  for (const item of outbound.items) {
    if (item.broadcast) broadcastCount += 1;
    for (const type of item.types) byType.set(type, (byType.get(type) ?? 0) + 1);
  }
  return {
    sharedCount: outbound.items.length,
    byType: RELATIONSHIP_TYPE_ORDER.filter((t) => (byType.get(t) ?? 0) > 0).map((type) => ({
      type,
      count: byType.get(type) ?? 0,
    })),
    broadcastCount,
  };
}

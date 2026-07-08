import type { Insight } from '@shared/schemas';
import { LIFE_AREAS } from '@shared/schemas';
import type { ConfidenceStat } from './stats';

/**
 * Pure derivations for the Memory overview (57-memory-overview-redesign §3.1). All computed locally from the
 * already-loaded, already-scoped own-insight list — no AI, no extra IPC (§4). Tested in overview.test.ts.
 */

export type ConfidenceLevel = 1 | 2 | 3;

/** The overview's "how well it knows you" read — a calm qualitative label + a 0–3 segmented meter (§3.1, no
 * number/percentage). Derived from the confidence distribution + volume: it takes both a decent amount of
 * corroborated insight AND enough of it to read as "knows you well." */
export interface KnowsYouRead {
  label: string;
  /** Filled meter segments, 0–3 (also the confidence "dots" level for tiles). */
  level: 0 | ConfidenceLevel;
}

export function knowsYouRead(confidence: ConfidenceStat): KnowsYouRead {
  const { high, medium, low, total } = confidence;
  if (total === 0) return { label: 'Just getting started', level: 0 };
  // Weighted confidence share, 0..1 (high fully counts, medium/low partially).
  const score = (high * 1 + medium * 0.6 + low * 0.3) / total;
  if (total >= 12 && score >= 0.6) return { label: 'Knows you well', level: 3 };
  if (total >= 5 && score >= 0.45) return { label: 'Getting there', level: 2 };
  return { label: 'Getting to know you', level: 1 };
}

const CONFIDENCE_RANK: Record<Insight['confidence'], ConfidenceLevel> = {
  low: 1,
  medium: 2,
  high: 3,
};

/** One life-area's roll-up for the overview tile map (§3.1): its insights (for the detail view), a live-fact
 * count, a deterministic one-line gist, and a confidence read for the dots. */
export interface AreaSummary {
  area: string;
  insights: Insight[];
  /** Live (non-flagged) facts across the area's insights — the tile count. */
  factCount: number;
  /** A one-line gist (the most salient insight's summary, or its first live fact). */
  gist: string;
  /** The area's confidence read for the dots — the best (highest) insight's confidence. */
  confidenceLevel: ConfidenceLevel;
}

/** The most salient insight in a set: highest confidence, then most-recently updated. */
function salientInsight(insights: Insight[]): Insight | undefined {
  return [...insights].sort((a, b) => {
    const rank = CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence];
    if (rank !== 0) return rank;
    return b.updatedAt.localeCompare(a.updatedAt);
  })[0];
}

/** A one-line gist for a life-area tile: the salient insight's summary, else its first live fact's text. */
export function areaGist(insights: Insight[]): string {
  const top = salientInsight(insights);
  if (!top) return '';
  if (top.summary.trim()) return top.summary.trim();
  const fact = top.facts.find((f) => !f.flaggedInaccurate);
  return fact?.text.trim() ?? '';
}

/**
 * Group approved own insights into per-life-area summaries for the tile map, in `LIFE_AREAS` order. Groups by
 * `categories[0]` ('Other' when untagged); skips areas with no insights. Each summary carries the insights
 * (for the drill-down), a live-fact count, a gist, and a confidence read.
 */
export function summarizeAreas(approved: Insight[]): AreaSummary[] {
  const byArea = new Map<string, Insight[]>();
  for (const insight of approved) {
    const area = insight.categories[0] ?? 'Other';
    byArea.set(area, [...(byArea.get(area) ?? []), insight]);
  }
  const order: string[] = [...LIFE_AREAS.filter((a) => byArea.has(a))];
  // Any non-taxonomy area (defensive) trails, in insertion order.
  for (const area of byArea.keys()) {
    if (!(LIFE_AREAS as readonly string[]).includes(area)) order.push(area);
  }
  return order.map((area) => {
    const insights = byArea.get(area) ?? [];
    const factCount = insights.reduce(
      (n, i) => n + i.facts.filter((f) => !f.flaggedInaccurate).length,
      0,
    );
    const top = salientInsight(insights);
    return {
      area,
      insights,
      factCount,
      gist: areaGist(insights),
      confidenceLevel: top ? CONFIDENCE_RANK[top.confidence] : 1,
    };
  });
}

/** The qualitative label for a per-area/tile confidence level (matches the overview's vocabulary). */
export function confidenceLabel(level: ConfidenceLevel): string {
  return level === 3 ? 'Knows you well' : level === 2 ? 'Getting there' : 'Early days';
}

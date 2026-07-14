import type { Insight } from '@shared/schemas';
import { summarizeAreas, type AreaSummary } from './overview';

/**
 * One life-area section for the flattened Memory page (62 §3.2) — an `AreaSummary` plus whether it's
 * SENSITIVE (the Intimacy area, or any insight carrying a `restricted` fact). Sensitive sections always
 * start collapsed so trauma/intimacy isn't on screen at a glance (§3.2/§8).
 */
export interface MemorySection extends AreaSummary {
  sensitive: boolean;
}

/** Life areas that are always treated as sensitive (start collapsed, carry the lock marker). */
const SENSITIVE_AREAS = new Set<string>(['Intimacy']);

/** Group approved own insights into ordered life-area sections (reuses `summarizeAreas`) + a sensitivity flag. */
export function memorySections(approved: Insight[]): MemorySection[] {
  return summarizeAreas(approved).map(
    (summary: AreaSummary): MemorySection => ({
      ...summary,
      sensitive:
        SENSITIVE_AREAS.has(summary.area) ||
        summary.insights.some((i) => i.facts.some((f) => f.restricted)),
    }),
  );
}

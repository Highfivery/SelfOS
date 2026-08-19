import type { AdaptiveNameEntryView, AdaptiveNameRegisterView } from '@shared/schemas';
import type { BankMark } from '../../../stores/adaptiveTestStore';

/**
 * 74 §3.6.8 — everything a register card shows, derived from the marks the renderer already holds.
 *
 * This is the fix for the owner-reported bug as much as it is the source of the counts. The register's
 * `marked` number used to be computed server-side and fetched ONCE at mount, so a register marked in this
 * sitting still read "Not opened" until the whole take was reloaded — while a register marked in an EARLIER
 * sitting showed a count, because that one was already baked into the fetch. Two sources of truth for one
 * fact, and the stale one was on screen.
 *
 * `store.nameMarks` is seeded from the server view on load AND updated on every tap, so it is complete: it
 * carries earlier sittings and this one. Deriving from it is exact, instant, and leaves nothing to drift.
 */
export interface RegisterStats {
  /** Names answered in at least one direction (74 §3.6.8 — either side counts, the owner's call). */
  marked: number;
  /** Mutually exclusive, so they always sum to `marked` — see the precedence note below. */
  love: number;
  okay: number;
  never: number;
}

export const EMPTY_STATS: RegisterStats = { marked: 0, love: 0, okay: 0, never: 0 };

/**
 * A name carries two marks, so one name can be loved to hear and ruled out to say. The buckets are counts of
 * NAMES rather than marks, so they reconcile with "N of M names marked" sitting directly above them — which
 * means a mixed name has to land in exactly one. Precedence is **never > love > okay**: a no is the most
 * decision-relevant thing on the card, and the one you would want to spot without reading numbers.
 */
function bucketOf(mark: { hear?: BankMark; say?: BankMark }): keyof RegisterStats | null {
  const sides = [mark.hear, mark.say];
  if (sides.every((side) => side === undefined)) return null;
  if (sides.includes('never')) return 'never';
  if (sides.includes('love')) return 'love';
  return 'okay';
}

export function registerStats(
  entries: readonly AdaptiveNameEntryView[],
  nameMarks: Readonly<Record<string, { hear?: BankMark; say?: BankMark }>>,
): Record<string, RegisterStats> {
  const out: Record<string, RegisterStats> = {};
  for (const entry of entries) {
    const stats = (out[entry.family] ??= { ...EMPTY_STATS });
    const mark = nameMarks[entry.key];
    if (!mark) continue;
    const bucket = bucketOf(mark);
    if (!bucket) continue;
    stats.marked += 1;
    stats[bucket] += 1;
  }
  return out;
}

/** How far a register goes, said in words rather than a meter nobody should have to learn. */
export type Intensity = 'gentle' | 'warm' | 'strong' | 'intense';

export function intensityOf(tier: number): Intensity {
  return tier <= 2 ? 'gentle' : tier === 3 ? 'warm' : tier === 4 ? 'strong' : 'intense';
}

/**
 * The register's span, in plain English: "gentle", "gentle to strong", "intense". It replaced a five-segment
 * meter whose lit span meant "tiers 4-5" and read as "2 out of 5" — two encodings of overlapping facts, with
 * nothing on the card saying how they related (owner-reported twice, 2026-08-19).
 */
export function intensityRange(minTier: number, maxTier: number): string {
  const lo = intensityOf(minTier);
  const hi = intensityOf(maxTier);
  return lo === hi ? hi : `${lo} to ${hi}`;
}

export type RegisterSort = 'state' | 'warm' | 'hot' | 'marked' | 'az';

export const REGISTER_SORTS: { value: RegisterSort; label: string }[] = [
  { value: 'state', label: 'In progress first' },
  { value: 'warm', label: 'Warmest first' },
  { value: 'hot', label: 'Most intense first' },
  { value: 'marked', label: 'Most marked' },
  { value: 'az', label: 'A – Z' },
];

/**
 * One grid, sorted — never grouped sections. A group holding a single register would stretch that card to the
 * full row in an `auto-fill` grid, which is the defect the Tests landing hit (#530).
 */
export function sortRegisters(
  registers: readonly AdaptiveNameRegisterView[],
  stats: Record<string, RegisterStats>,
  sort: RegisterSort,
): AdaptiveNameRegisterView[] {
  const order = new Map(registers.map((register, index) => [register.id, index]));
  // The catalog order is warmest → furthest, so it is both the "warm" sort and the tiebreak everywhere else.
  const curated = (a: AdaptiveNameRegisterView, b: AdaptiveNameRegisterView): number =>
    (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
  const of = (register: AdaptiveNameRegisterView): RegisterStats =>
    stats[register.id] ?? EMPTY_STATS;
  const list = [...registers];
  switch (sort) {
    case 'warm':
      return list.sort(curated);
    case 'hot':
      return list.sort((a, b) => b.maxTier - a.maxTier || b.minTier - a.minTier || curated(a, b));
    case 'marked':
      return list.sort((a, b) => of(b).marked - of(a).marked || curated(a, b));
    case 'az':
      return list.sort((a, b) => a.label.localeCompare(b.label));
    default: {
      // In progress, then untouched, then all-marked: a finished register needs nothing from you.
      const rank = (register: AdaptiveNameRegisterView): number => {
        const { marked } = of(register);
        if (marked === 0) return 1;
        return marked >= register.count ? 2 : 0;
      };
      return list.sort((a, b) => rank(a) - rank(b) || curated(a, b));
    }
  }
}

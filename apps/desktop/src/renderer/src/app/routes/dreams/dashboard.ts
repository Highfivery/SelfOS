import type { Dream } from '@shared/channels';
import type { DreamTrendPoint } from '@shared/schemas';

/** The dashboard quick-filter (12 §16.2 decision 5). */
export type DreamFilter = 'all' | 'analyzed' | 'lucid' | 'nightmares';

/** Human label for each filter, for the empty-state copy. */
export const DREAM_FILTER_LABELS: Record<DreamFilter, string> = {
  all: 'All',
  analyzed: 'Analyzed',
  lucid: 'Lucid',
  nightmares: 'Nightmares',
};

/** Does a dream belong in the current filter? (`all` matches everything.) */
export function matchesFilter(dream: Dream, filter: DreamFilter): boolean {
  switch (filter) {
    case 'analyzed':
      return dream.status === 'analyzed';
    case 'lucid':
      return dream.lucid;
    case 'nightmares':
      return dream.nightmare;
    case 'all':
    default:
      return true;
  }
}

/** The date a dream is grouped/sorted by — when it occurred, falling back to when it was logged. */
function dreamDate(dream: Dream): string {
  return dream.dreamDate ?? dream.createdAt;
}

export type RecencyKey = 'week' | 'month' | 'earlier';
export interface RecencyGroup {
  key: RecencyKey;
  label: string;
  dreams: Dream[];
}

const GROUP_LABELS: Record<RecencyKey, string> = {
  week: 'This week',
  month: 'This month',
  earlier: 'Earlier',
};

/** Whole days between two instants (positive when `then` is before `now`). */
function daysAgo(iso: string, now: number): number {
  return Math.floor((now - new Date(iso).getTime()) / 86_400_000);
}

/**
 * Group dreams into "This week / This month / Earlier" buckets (12 §16.2 decision 5), newest first within
 * each. A future-dated dream (ahead of `now`) still lands in "This week". Empty buckets are omitted, so the
 * result is only the non-empty groups in recency order. Pure — `now` is injected for deterministic tests.
 */
export function groupDreamsByRecency(dreams: Dream[], now: number): RecencyGroup[] {
  const buckets: Record<RecencyKey, Dream[]> = { week: [], month: [], earlier: [] };
  const sorted = [...dreams].sort((a, b) => dreamDate(b).localeCompare(dreamDate(a)));
  for (const dream of sorted) {
    const age = daysAgo(dreamDate(dream), now);
    const key: RecencyKey = age <= 7 ? 'week' : age <= 31 ? 'month' : 'earlier';
    buckets[key].push(dream);
  }
  return (['week', 'month', 'earlier'] as const)
    .filter((key) => buckets[key].length > 0)
    .map((key) => ({ key, label: GROUP_LABELS[key], dreams: buckets[key] }));
}

/**
 * A gentle, deterministic waking-mood cue for the insight strip (12 §16.2) — compares the earlier half of the
 * mood trend to the later half. Returns `null` when there aren't enough points to say anything. Never a
 * clinical readout; a soft "lately" observation only.
 */
export function moodCue(moodTrend: DreamTrendPoint[]): string | null {
  // Need at least three readings — a two-point diff dressed as a "trend" is too thin to claim "lately".
  if (moodTrend.length < 3) return null;
  const mid = Math.floor(moodTrend.length / 2);
  const early = moodTrend.slice(0, mid);
  const late = moodTrend.slice(mid);
  const mean = (points: DreamTrendPoint[]): number =>
    points.reduce((sum, p) => sum + p.value, 0) / points.length;
  const shift = mean(late) - mean(early);
  if (shift > 0.15) return 'Your dreams have felt brighter lately';
  if (shift < -0.15) return 'Your dreams have felt heavier lately';
  return 'Your dream mood has been fairly steady lately';
}

import type { Insight, TestResult } from '@shared/schemas';

/** One analyzed-session mood reading (09 §14): normalized valence + energy, on the session's date. */
export interface MoodPoint {
  at: string;
  valence: number;
  energy: number;
}

/**
 * The active person's analyzed-session mood points, oldest→newest. Drawn from approved **session**
 * Insights that carry a `moodValence` metric (09 §14.2). Scoped to the subject so one person's trend
 * never shows another's (the per-person isolation rule).
 */
export function sessionMoodPoints(insights: Insight[], personId: string): MoodPoint[] {
  return insights
    .filter(
      (insight) =>
        insight.source === 'session' &&
        insight.subjectPersonId === personId &&
        insight.approved &&
        insight.metrics?.moodValence !== undefined,
    )
    .map((insight) => ({
      at: insight.provenance.at,
      valence: insight.metrics?.moodValence ?? 0,
      energy: insight.metrics?.moodEnergy ?? 0,
    }))
    .sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * The active person's deliberate MOOD check-in points (51 §5.3), oldest→newest — a SIBLING series to the
 * inferred session mood, so a deliberate check-in reads distinctly from an AI-inferred reading. Drawn from the
 * dated PHQ-9 mood-check-in RESULTS (every take is its own trend point; the single derived Insight only keeps
 * the latest). The instrument's normalized score is severity (0 low … 1 high), so it's mapped to a valence-like
 * value (+1 = mood felt okay, −1 = heavy) to sit on the same −1..1 axis as session mood. `energy` is unused.
 */
export function checkInMoodPoints(moodResults: TestResult[]): MoodPoint[] {
  return moodResults
    .filter((result) => result.testId === 'phq9' && result.scores[0]?.normalized !== undefined)
    .map((result) => ({
      at: result.takenAt,
      valence: 1 - 2 * (result.scores[0]?.normalized ?? 0),
      energy: 0,
    }))
    .sort((a, b) => a.at.localeCompare(b.at));
}

/** Mood/anxiety check-ins are gently invited to re-take after a while (51 §3.4 — a soft prompt, never a schedule). */
export const RECHECK_AFTER_DAYS = 14;
/** The instruments that get the gentle "check in again" invitation (mood + anxiety). */
export const RECHECKABLE_INSTRUMENTS = new Set(['phq9', 'gad7']);

/** Whole days between an ISO timestamp and `now` (0 on an unparseable value). */
export function daysSince(iso: string, now: number): number {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.floor((now - then) / (24 * 60 * 60 * 1000));
}

/**
 * Whether a gentle mood/anxiety check-in is due (53 §5.1 / 51 §3.4): the person HAS checked in before but
 * their most recent recheckable check-in (PHQ-9 / GAD-7) is ≥14 days old. A soft invitation — it never fires
 * for someone who has never checked in (that's the You hub's catalog), and never escalates (§8). Returns the
 * last check-in date as the dismissal signature, so a fresh check-in re-surfaces a FUTURE overdue without
 * re-nagging the same one. `resultsByTest` values are newest-first (the testStore contract).
 */
export function wellbeingCheckin(
  resultsByTest: Record<string, TestResult[]>,
  now: number,
): { due: boolean; lastAt?: string } {
  let lastAt: string | undefined;
  for (const id of RECHECKABLE_INSTRUMENTS) {
    const latest = resultsByTest[id]?.[0]?.takenAt;
    if (latest && (lastAt === undefined || latest > lastAt)) lastAt = latest;
  }
  if (lastAt === undefined) return { due: false };
  return { due: daysSince(lastAt, now) >= RECHECK_AFTER_DAYS, lastAt };
}

/**
 * A gentle, non-clinical one-line read of the recent mood direction (§7). Never a score, diagnosis, or
 * alarming framing — it's a reflection aid. Compares the most recent half of the points to the earlier
 * half. Empty string when there isn't enough to say anything honest (<2 points).
 */
export function wellbeingRead(points: MoodPoint[]): string {
  if (points.length < 2) return '';
  const half = Math.max(1, Math.floor(points.length / 2));
  const recent = points.slice(points.length - half);
  const earlier = points.slice(0, points.length - half);
  const meanValence = (xs: MoodPoint[]): number =>
    xs.reduce((sum, point) => sum + point.valence, 0) / xs.length;
  const recentMean = meanValence(recent);
  const delta = recentMean - (earlier.length > 0 ? meanValence(earlier) : recentMean);
  if (delta > 0.15) return 'Your mood has been lifting lately.';
  if (delta < -0.15) return 'Things have felt a bit heavier lately — be gentle with yourself.';
  return 'Your mood has been fairly steady lately.';
}

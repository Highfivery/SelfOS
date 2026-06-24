import type { Insight } from '@shared/schemas';

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

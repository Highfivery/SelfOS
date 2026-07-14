import type { Insight } from '@shared/schemas';
import type { LineChartSeries } from '../../../design-system/components';

/**
 * Build the Memory "Trends" series for the active person (20-memory-dashboard §3.4): mood valence + energy
 * over time from their approved **session** insights, plus any other named `metrics` signal that appears on
 * ≥2 of their approved insights (e.g. future questionnaire metrics). Charts only — never prose. `x` is the
 * point index (oldest→newest); a series needs ≥2 points to be meaningful (the LineChart no-ops below that).
 */
export function buildTrendSeries(
  insights: Insight[],
  personId: string,
  windowDays?: number,
): LineChartSeries[] {
  const since = windowDays && windowDays > 0 ? Date.now() - windowDays * 24 * 60 * 60 * 1000 : null;
  const own = insights
    .filter((i) => i.subjectPersonId === personId && i.approved && i.metrics)
    .filter((i) => since === null || (Date.parse(i.provenance.at) || 0) >= since)
    .sort((a, b) => a.provenance.at.localeCompare(b.provenance.at));

  // Collect every metric key present, then keep those with ≥2 readings (a line needs two points).
  const byKey = new Map<string, number[]>();
  for (const insight of own) {
    for (const [key, value] of Object.entries(insight.metrics ?? {})) {
      byKey.set(key, [...(byKey.get(key) ?? []), value]);
    }
  }

  const LABELS: Record<string, string> = { moodValence: 'Mood', moodEnergy: 'Energy' };
  const series: LineChartSeries[] = [];
  // Mood + energy first (the reliable session signals), then any other metric.
  const order = ['moodValence', 'moodEnergy', ...byKey.keys()].filter(
    (k, i, arr) => arr.indexOf(k) === i,
  );
  for (const key of order) {
    const values = byKey.get(key);
    if (!values || values.length < 2) continue;
    series.push({
      label: LABELS[key] ?? key,
      points: values.map((y, x) => ({ x, y })),
    });
  }
  return series;
}

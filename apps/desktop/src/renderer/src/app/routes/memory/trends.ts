import type { Insight } from '@shared/schemas';
import type { LineChartPoint } from '../../../design-system/components';

/** A trend series with its stable metric `key` (for the series picker) + a humanized `label` (65 §3.5). */
export interface TrendSeries {
  key: string;
  label: string;
  points: LineChartPoint[];
}

/**
 * Known metric keys → human labels: the reliable session signals (mood/energy), plus the dream, intimacy, and
 * Together metrics that also land in `Insight.metrics`. Any key NOT here is prettified from camelCase by
 * `prettifyMetricKey`, so the legend never shows a raw "machine name" (65 §3.5).
 */
const METRIC_LABELS: Record<string, string> = {
  moodValence: 'Mood',
  moodEnergy: 'Energy',
  emotionalIntensity: 'Emotional intensity',
  valence: 'Emotional tone',
  connection: 'Connection',
  desire: 'Desire',
  satisfaction: 'Satisfaction',
};

/** The metric keys the chart shows by default — the reliable session signals; the rest are opt-in via the picker. */
export const DEFAULT_TREND_KEYS = ['moodValence', 'moodEnergy'];

/**
 * Humanize a metric key for the legend. Known keys map via `METRIC_LABELS`; any other key (e.g. an
 * author-defined questionnaire `metricKey`) is prettified from camelCase / snake_case / kebab-case into a
 * readable label — so `emotionalIntensity` reads "Emotional intensity", never the raw key (65 §3.5). Pure.
 * (An all-caps acronym key like `HRV` degrades to "Hrv" — acceptable for machine-name avoidance; every known
 * signal is covered by `METRIC_LABELS`, and add there for a preferred label.)
 */
export function prettifyMetricKey(key: string): string {
  if (METRIC_LABELS[key]) return METRIC_LABELS[key];
  const spaced = key
    .replace(/[_-]+/g, ' ') // snake / kebab → spaces
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camelCase → spaced
    .replace(/\s+/g, ' ')
    .trim();
  if (!spaced) return key;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/**
 * Build the Memory "Trends" series for the active person (20 §3.4 / 65 §3.5): mood valence + energy over time
 * from their approved insights, plus any other named `metrics` signal that appears on ≥2 of their approved
 * insights (dream / intimacy / Together / author-defined questionnaire metrics). Charts only — never prose.
 * `x` is the point index (oldest→newest); a series needs ≥2 points to be meaningful (the LineChart no-ops
 * below that). Each series carries its stable `key` so the card can default to Mood + Energy and offer the
 * rest via a picker.
 */
export function buildTrendSeries(
  insights: Insight[],
  personId: string,
  windowDays?: number,
): TrendSeries[] {
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

  const series: TrendSeries[] = [];
  // Mood + energy first (the reliable session signals), then any other metric.
  const order = ['moodValence', 'moodEnergy', ...byKey.keys()].filter(
    (k, i, arr) => arr.indexOf(k) === i,
  );
  for (const key of order) {
    const values = byKey.get(key);
    if (!values || values.length < 2) continue;
    series.push({
      key,
      label: prettifyMetricKey(key),
      points: values.map((y, x) => ({ x, y })),
    });
  }
  return series;
}

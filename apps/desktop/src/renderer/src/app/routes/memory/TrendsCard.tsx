import { useMemo, useState } from 'react';
import { LineChart as LineChartIcon } from 'lucide-react';
import type { Insight } from '@shared/schemas';
import {
  Card,
  LineChart,
  SegmentedControl,
  Text,
  type LineChartSeries,
} from '../../../design-system/components';
import { buildTrendSeries, DEFAULT_TREND_KEYS, type TrendSeries } from './trends';
import styles from './Memory.module.css';

type Window = '30d' | '90d' | 'all';
const WINDOW_OPTIONS = [
  { value: '30d' as const, label: '30d' },
  { value: '90d' as const, label: '90d' },
  { value: 'all' as const, label: 'All' },
];
const WINDOW_DAYS: Record<Window, number | undefined> = { '30d': 30, '90d': 90, all: undefined };

/** A plain-language direction for a series (§9 text equivalent) from its first vs last point. */
function direction(series: TrendSeries): string {
  const first = series.points[0]?.y;
  const last = series.points[series.points.length - 1]?.y;
  if (first === undefined || last === undefined) return 'steady';
  const delta = last - first;
  if (delta > 0.08) return 'rising';
  if (delta < -0.08) return 'dipping';
  return 'steady';
}

/**
 * "How you've been" (62 §3.5 / 65 §3.5) — the viewer's mood/energy (+ any other tracked metric) over a chosen
 * window. A deterministic read (no AI): a 30d/90d/All toggle, the `LineChart` (area fill + emphasized latest
 * point), and a **text read** of each shown series' direction (never colour alone — §9). Legend labels are
 * humanized (no camelCase machine names). The chart **defaults to Mood + Energy**; a picker toggles the rest on
 * so it stays calm/readable instead of overlaying many unrelated series. A gentle reflection, not a measure.
 */
export function TrendsCard({
  insights,
  personId,
}: {
  insights: Insight[];
  personId: string;
}): JSX.Element {
  const [window, setWindow] = useState<Window>('30d');
  // All-time series drive which keys exist + the default selection; the window series drive what's charted.
  const allSeries = useMemo(() => buildTrendSeries(insights, personId), [insights, personId]);
  const defaultKeys = useMemo(() => {
    const mood = allSeries.filter((s) => DEFAULT_TREND_KEYS.includes(s.key)).map((s) => s.key);
    return mood.length > 0 ? mood : allSeries.slice(0, 2).map((s) => s.key);
  }, [allSeries]);

  // `null` = untouched (use the default, which adapts as data loads); a Set = the user's explicit choice.
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const selected = picked ?? new Set(defaultKeys);

  const windowSeries = useMemo(
    () => buildTrendSeries(insights, personId, WINDOW_DAYS[window]),
    [insights, personId, window],
  );
  const shown = windowSeries.filter((s) => selected.has(s.key));
  const chartSeries: LineChartSeries[] = shown.map((s) => ({ label: s.label, points: s.points }));

  const toggle = (key: string): void =>
    setPicked((prev) => {
      const next = new Set(prev ?? defaultKeys);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <Card className={styles.panel}>
      <div className={styles.panelHead}>
        <span className={styles.panelName}>
          <LineChartIcon size={16} aria-hidden="true" /> How you’ve been
        </span>
        <SegmentedControl
          options={WINDOW_OPTIONS}
          value={window}
          onChange={setWindow}
          aria-label="Trend window"
        />
      </div>
      {windowSeries.length > 0 ? (
        <>
          {/* Show the picker whenever there's a choice to make OR nothing is charted (so the "pick a series"
              fallback below always has a picker above it to act on). */}
          {windowSeries.length > 1 || chartSeries.length === 0 ? (
            <div
              className={styles.seriesPicker}
              role="group"
              aria-label="Choose which series to chart"
            >
              {windowSeries.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  className={styles.seriesChip}
                  aria-pressed={selected.has(s.key)}
                  onClick={() => toggle(s.key)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          ) : null}
          {chartSeries.length > 0 ? (
            <>
              <LineChart
                series={chartSeries}
                ariaLabel={`Your ${shown.map((s) => s.label).join(', ')} over time`}
                yMin={-1}
                yMax={1}
                fill
                emphasizeLast
              />
              <Text size="xs" tone="secondary">
                {shown.map((s) => `${s.label} ${direction(s)}`).join(' · ')}
              </Text>
            </>
          ) : (
            <Text size="sm" tone="tertiary">
              Pick a series above to chart it.
            </Text>
          )}
        </>
      ) : (
        <Text size="sm" tone="tertiary">
          {window === 'all'
            ? 'Not enough tracked yet to chart.'
            : 'Not enough in this window yet — try a longer one.'}
        </Text>
      )}
    </Card>
  );
}

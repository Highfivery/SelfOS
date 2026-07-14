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
import { buildTrendSeries } from './trends';
import styles from './Memory.module.css';

type Window = '30d' | '90d' | 'all';
const WINDOW_OPTIONS = [
  { value: '30d' as const, label: '30d' },
  { value: '90d' as const, label: '90d' },
  { value: 'all' as const, label: 'All' },
];
const WINDOW_DAYS: Record<Window, number | undefined> = { '30d': 30, '90d': 90, all: undefined };

/** A plain-language direction for a series (§9 text equivalent) from its first vs last point. */
function direction(series: LineChartSeries): string {
  const first = series.points[0]?.y;
  const last = series.points[series.points.length - 1]?.y;
  if (first === undefined || last === undefined) return 'steady';
  const delta = last - first;
  if (delta > 0.08) return 'rising';
  if (delta < -0.08) return 'dipping';
  return 'steady';
}

/**
 * "How you've been" (62 §3.5) — the viewer's mood/energy over a chosen window, from analyzed sessions. A
 * deterministic read (no AI): a 30d/90d/All toggle, the `LineChart`, and a **text read** of each series'
 * direction (never colour alone — §9). A gentle reflection, not a measure. The parent only renders this when
 * there's ≥2 all-time points; a narrow window that thins to <2 points shows a calm "not enough yet" note.
 */
export function TrendsCard({
  insights,
  personId,
}: {
  insights: Insight[];
  personId: string;
}): JSX.Element {
  const [window, setWindow] = useState<Window>('30d');
  const series = useMemo(
    () => buildTrendSeries(insights, personId, WINDOW_DAYS[window]),
    [insights, personId, window],
  );

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
      {series.length > 0 ? (
        <>
          <LineChart
            series={series}
            ariaLabel="Your mood and energy across analyzed sessions over time"
            yMin={-1}
            yMax={1}
          />
          <Text size="xs" tone="secondary">
            {series.map((s) => `${s.label} ${direction(s)}`).join(' · ')}
          </Text>
        </>
      ) : (
        <Text size="sm" tone="tertiary">
          Not enough in this window yet — try a longer one.
        </Text>
      )}
    </Card>
  );
}

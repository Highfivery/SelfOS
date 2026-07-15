import { useId } from 'react';
import styles from './LineChart.module.css';

export interface LineChartPoint {
  x: number;
  y: number;
}

export interface LineChartSeries {
  label: string;
  points: LineChartPoint[];
}

interface LineChartProps {
  series: LineChartSeries[];
  /** Accessible description of what the chart shows (required — the SVG is `role="img"`). */
  ariaLabel: string;
  /** Optional fixed y-range; otherwise derived from the data (padded). */
  yMin?: number;
  yMax?: number;
  /** Optional y-axis end labels (e.g. "Low"/"High") rendered as a slim rail left of the plot. */
  yLowLabel?: string;
  yHighLabel?: string;
}

const PALETTE = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
];

const VIEW_W = 320;
const VIEW_H = 140;
const PAD = 8;

/**
 * A minimal multi-series line chart (design-system primitive) — token-driven, theme-aware, and
 * accessible (the SVG is `role="img"` with a descriptive label; a legend names each series). Used by the
 * questionnaire trends, and any future small time-series. Renders nothing meaningful for <2 points.
 */
export function LineChart({
  series,
  ariaLabel,
  yMin,
  yMax,
  yLowLabel,
  yHighLabel,
}: LineChartProps): JSX.Element {
  const titleId = useId();
  const xs = series.flatMap((s) => s.points.map((p) => p.x));
  const ys = series.flatMap((s) => s.points.map((p) => p.y));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const lo = yMin ?? Math.min(...ys);
  const hi = yMax ?? Math.max(...ys);
  // Pad a flat range so a constant series still draws a visible mid-line.
  const spanY = hi - lo || 1;
  const spanX = maxX - minX || 1;

  const px = (x: number): number => PAD + ((x - minX) / spanX) * (VIEW_W - 2 * PAD);
  const py = (y: number): number => VIEW_H - PAD - ((y - lo) / spanY) * (VIEW_H - 2 * PAD);

  const hasAxis = yHighLabel !== undefined || yLowLabel !== undefined;

  return (
    <div className={styles.chart}>
      <div className={styles.plot}>
        {hasAxis ? (
          <div className={styles.yAxis} aria-hidden="true">
            <span>{yHighLabel}</span>
            <span>{yLowLabel}</span>
          </div>
        ) : null}
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className={styles.svg}
          role="img"
          aria-labelledby={titleId}
        >
          <title id={titleId}>{ariaLabel}</title>
          {series.map((s, i) => {
            const color = PALETTE[i % PALETTE.length];
            const d = s.points.map((p) => `${px(p.x)},${py(p.y)}`).join(' ');
            return (
              <g key={s.label}>
                <polyline
                  points={d}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                  className={styles.line}
                />
                {s.points.map((p, j) => (
                  <circle key={j} cx={px(p.x)} cy={py(p.y)} r={2.5} fill={color} />
                ))}
              </g>
            );
          })}
        </svg>
      </div>
      <ul className={styles.legend}>
        {series.map((s, i) => (
          <li key={s.label} className={styles.legendItem}>
            <span
              className={styles.swatch}
              style={{ background: PALETTE[i % PALETTE.length] }}
              aria-hidden="true"
            />
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

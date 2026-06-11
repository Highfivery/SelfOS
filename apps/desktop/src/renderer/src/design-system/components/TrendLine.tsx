import styles from './TrendLine.module.css';

export interface TrendPoint {
  date: string;
  value: number;
}

interface TrendLineProps {
  points: TrendPoint[];
  /** The value-axis bounds (e.g. mood −1..1, vividness 1..5). */
  min: number;
  max: number;
  'aria-label': string;
  emptyLabel?: string;
}

const W = 100;
const H = 32;
const PAD = 3;

/**
 * A small SVG trend line with a soft area fill (design-system primitive). Scales to its container width at
 * a fixed height. Carries a text `aria-label` (and a visually-hidden range note) so it's not colour-only
 * (01 §9). Used for mood/vividness over time (12 §3.5).
 */
export function TrendLine({
  points,
  min,
  max,
  emptyLabel = 'Not enough data yet.',
  ...aria
}: TrendLineProps): JSX.Element {
  if (points.length === 0) {
    return <p className={styles.empty}>{emptyLabel}</p>;
  }

  const range = max - min || 1;
  const yOf = (value: number): number => {
    const norm = Math.min(1, Math.max(0, (value - min) / range));
    return PAD + (1 - norm) * (H - 2 * PAD);
  };
  const xOf = (index: number): number =>
    points.length === 1 ? W / 2 : PAD + (index / (points.length - 1)) * (W - 2 * PAD);

  const ys = points.map((point) => yOf(point.value));
  const firstY = ys[0] ?? PAD; // points is non-empty here; the fallback only satisfies the type
  const coords = points.map(
    (_, index) => `${xOf(index).toFixed(2)},${(ys[index] ?? PAD).toFixed(2)}`,
  );
  // A single point draws a flat segment so there's always a visible line.
  const linePoints = points.length === 1 ? [`${PAD},${firstY}`, `${W - PAD},${firstY}`] : coords;
  const areaPath = `M ${linePoints[0]} L ${linePoints.slice(1).join(' L ')} L ${W - PAD},${H - PAD} L ${PAD},${H - PAD} Z`;

  // A text equivalent that conveys direction, not just bounds (01 §9).
  const firstValue = points[0]?.value ?? 0;
  const lastValue = points[points.length - 1]?.value ?? 0;
  const direction =
    points.length < 2 || lastValue === firstValue
      ? 'steady'
      : lastValue > firstValue
        ? 'rising'
        : 'falling';
  const label = aria['aria-label'];
  return (
    <div className={styles.wrap}>
      <svg
        className={styles.svg}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label}: ${direction} across ${points.length} dream${points.length === 1 ? '' : 's'}`}
      >
        <path className={styles.area} d={areaPath} />
        <polyline
          className={styles.line}
          points={linePoints.join(' ')}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

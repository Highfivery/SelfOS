import type { ReactNode } from 'react';
import styles from './Home.module.css';

/**
 * A small SVG progress ring (60-home-dashboard §3.1.6) — a visible track plus a rounded progress arc, with
 * arbitrary center content (a %, a level word, an icon). Crisper + higher-contrast than a conic-gradient on
 * the cream ground (which read as blank), and `muted` draws only the soft track (no arc) for the crisis-
 * softened state so a ring never looks empty/broken. Presentational only — the caller supplies the accessible
 * text (the visible center + label), so meaning is never colour-only (§9).
 */
export function Ring({
  fill,
  color,
  muted = false,
  size = 60,
  stroke = 6,
  children,
}: {
  fill: number;
  color: string;
  muted?: boolean;
  size?: number;
  stroke?: number;
  children?: ReactNode;
}): JSX.Element {
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.min(1, Math.max(0, Number.isFinite(fill) ? fill : 0));
  const dash = clamped * circumference;
  const c = size / 2;
  return (
    <span className={styles.ringWrap} style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
        className={styles.ringSvg}
      >
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke="var(--color-border-strong)"
          strokeWidth={stroke}
        />
        {!muted ? (
          <circle
            cx={c}
            cy={c}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
            transform={`rotate(-90 ${c} ${c})`}
          />
        ) : null}
      </svg>
      <span className={styles.ringCenter}>{children}</span>
    </span>
  );
}

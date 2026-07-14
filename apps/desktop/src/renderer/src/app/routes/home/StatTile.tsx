import { TrendingUp } from 'lucide-react';
import styles from './Home.module.css';

export interface StatTileProps {
  label: string;
  value: string;
  /** A positive change to celebrate (e.g. "2" → "▲ 2"). Only ever an increase — never a "down" scold (§8). */
  delta?: number;
  /** A small sub-line under the value (e.g. "2 need review"). */
  sub?: string;
  onClick?: () => void;
}

/**
 * A compact dashboard stat tile (60 §3.1.5) — label, a big value, an optional positive delta chip, and an
 * optional sub-line. Deltas are increase-only by design (there is no "you're down" framing, §8). Clickable
 * when `onClick` is given (routes into the owning surface). `tabular-nums` keeps values aligned.
 */
export function StatTile({ label, value, delta, sub, onClick }: StatTileProps): JSX.Element {
  const body = (
    <>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statRow}>
        <span className={styles.statValue}>{value}</span>
        {delta !== undefined && delta > 0 ? (
          <span className={styles.statDelta}>
            <TrendingUp size={13} aria-hidden="true" /> {delta}
          </span>
        ) : null}
      </span>
      {sub ? <span className={styles.statSub}>{sub}</span> : null}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        className={`${styles.statTile} ${styles.statTileButton}`}
        onClick={onClick}
      >
        {body}
      </button>
    );
  }
  return <div className={styles.statTile}>{body}</div>;
}

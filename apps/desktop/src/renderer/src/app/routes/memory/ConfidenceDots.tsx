import type { ConfidenceLevel } from './overview';
import styles from './Memory.module.css';

/**
 * A 3-dot confidence read (57 §3.1). Decorative (`aria-hidden`) — it always sits beside a text label, so the
 * signal is never colour-only (§9). `level` fills 1–3 dots.
 */
export function ConfidenceDots({ level }: { level: ConfidenceLevel }): JSX.Element {
  return (
    <span className={styles.dots} aria-hidden="true">
      {[1, 2, 3].map((i) => (
        <i key={i} className={i <= level ? styles.dotOn : styles.dot} />
      ))}
    </span>
  );
}

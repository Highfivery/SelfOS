import styles from './ConfidenceChip.module.css';

export type ConfidenceLevel = 'low' | 'medium' | 'high';

const LABEL: Record<ConfidenceLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};
const FILLED: Record<ConfidenceLevel, number> = { low: 1, medium: 2, high: 3 };

/**
 * A compact confidence indicator (20-memory-dashboard §3.2): Low / Medium / High shown as **text** plus a
 * non-colour-only 3-dot fill (accessibility §9 — never colour alone). An optional `rationale` is exposed as
 * a tooltip + folded into the accessible label ("Medium confidence — corroborated by 3 sessions").
 */
export function ConfidenceChip({
  level,
  rationale,
}: {
  level: ConfidenceLevel;
  rationale?: string;
}): JSX.Element {
  const filled = FILLED[level];
  const label = `${LABEL[level]} confidence${rationale ? ` — ${rationale}` : ''}`;
  return (
    <span
      className={styles.chip}
      data-level={level}
      title={rationale ?? `${LABEL[level]} confidence`}
      aria-label={label}
    >
      <span className={styles.dots} aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className={i < filled ? styles.dotOn : styles.dotOff} />
        ))}
      </span>
      <span className={styles.text}>{LABEL[level]}</span>
    </span>
  );
}

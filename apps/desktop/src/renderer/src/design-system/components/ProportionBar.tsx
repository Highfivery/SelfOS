import styles from './ProportionBar.module.css';

interface ProportionBarProps {
  label: string;
  value: number;
  total: number;
  /** Bar colour — defaults to the accent; `warning` suits nightmare/distress proportions. */
  tone?: 'accent' | 'warning' | 'danger';
}

/**
 * A single proportion bar (design-system primitive): "value of total" with a filled track. The figures
 * are rendered as text (never colour-only, 01 §9). Used for lucid/nightmare rates (12 §3.5).
 */
export function ProportionBar({
  label,
  value,
  total,
  tone = 'accent',
}: ProportionBarProps): JSX.Element {
  const ratio = total > 0 ? value / total : 0;
  const pct = Math.round(ratio * 100);
  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <span className={styles.label}>{label}</span>
        <span className={styles.figure}>
          {value} of {total} · {pct}%
        </span>
      </div>
      <span className={styles.track} aria-hidden="true">
        <span
          className={`${styles.fill} ${styles[tone]}`}
          style={{ width: `${Math.max(ratio * 100, value > 0 ? 3 : 0)}%` }}
        />
      </span>
    </div>
  );
}

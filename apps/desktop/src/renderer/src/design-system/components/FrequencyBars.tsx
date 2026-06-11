import styles from './FrequencyBars.module.css';

export interface FrequencyItem {
  label: string;
  value: number;
}

interface FrequencyBarsProps {
  items: FrequencyItem[];
  /** Shown when there's nothing to chart yet. */
  emptyLabel?: string;
}

/**
 * A ranked horizontal frequency chart (design-system primitive). Each row pairs a label with a bar and
 * its count — the count is always rendered as text, so the chart never relies on colour or width alone
 * (01 §9). Used for recurring dream symbols/themes/people/emotions (12 §3.5).
 */
export function FrequencyBars({
  items,
  emptyLabel = 'Nothing to show yet.',
}: FrequencyBarsProps): JSX.Element {
  if (items.length === 0) {
    return <p className={styles.empty}>{emptyLabel}</p>;
  }
  const max = Math.max(...items.map((item) => item.value), 1);
  return (
    <ul className={styles.bars}>
      {items.map((item) => (
        <li key={item.label} className={styles.row}>
          <span className={styles.label} title={item.label}>
            {item.label}
          </span>
          <span className={styles.track} aria-hidden="true">
            <span className={styles.fill} style={{ width: `${(item.value / max) * 100}%` }} />
          </span>
          <span className={styles.count}>{item.value}</span>
        </li>
      ))}
    </ul>
  );
}

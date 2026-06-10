import { useEffect } from 'react';
import { useBudgetStore } from '../stores/budgetStore';
import { Text } from '../design-system/components';
import styles from './UsageHeader.module.css';

/**
 * Global header showing the active person's AI usage as a percentage of their budget for the period
 * (06-ai-usage-and-budgets). No dollar amounts — cost is admin-only.
 */
export function UsageHeader(): JSX.Element | null {
  const status = useBudgetStore((s) => s.status);
  const refresh = useBudgetStore((s) => s.refresh);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const person = status?.person;
  if (!person || person.limitUsd === null) return null;

  const ratio = person.limitUsd > 0 ? Math.min(1, person.spentUsd / person.limitUsd) : 0;
  const pct = Math.round(ratio * 100);
  const periodLabel = person.period === 'week' ? 'This week' : 'This month';
  const fillClass =
    person.state === 'over'
      ? `${styles.fill} ${styles.over}`
      : person.state === 'warn'
        ? `${styles.fill} ${styles.warn}`
        : styles.fill;

  return (
    <div className={styles.header}>
      <Text size="xs" tone="secondary">
        {periodLabel} AI usage
      </Text>
      <div
        className={styles.track}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${periodLabel} AI usage`}
      >
        <div className={fillClass} style={{ width: `${pct}%` }} />
      </div>
      <Text size="xs" tone="secondary">
        {pct}%
      </Text>
    </div>
  );
}

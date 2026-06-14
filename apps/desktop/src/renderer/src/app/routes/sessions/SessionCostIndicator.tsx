import type { SessionCost } from '@shared/channels';
import { AdminOnlyBadge, Text } from '../../../design-system/components';
import { formatUsd } from '../usage/format';
import styles from './sessionLifecycle.module.css';

/**
 * Per-session AI cost indicator (09 §14.3). Admins (`budgets.manage`) see the dollar figure with the
 * standard AdminOnlyBadge; everyone else sees a budget-relative bar (the session's share of the person's
 * period allowance) with no dollar amount — keeping the established no-$-for-users rule intact.
 */
export function SessionCostIndicator({
  cost,
  isAdmin,
}: {
  cost: SessionCost | undefined;
  isAdmin: boolean;
}): JSX.Element {
  // Admin view: the dollar figure (always shown, even $0.00 for a zero-turn session), marked admin-only.
  if (isAdmin) {
    return (
      <span className={styles.cost}>
        <Text as="span" size="sm" tone="secondary">
          {formatUsd(cost?.costUsd ?? 0)}
        </Text>
        <AdminOnlyBadge />
      </span>
    );
  }

  // Member view: a small bar from `budgetRatio` — a felt sense of weight, no dollars.
  const ratio = Math.max(0, Math.min(1, cost?.budgetRatio ?? 0));
  const pct = Math.round(ratio * 100);
  return (
    <span
      className={styles.bar}
      role="img"
      aria-label={`This session used about ${pct}% of your period allowance`}
      title={`~${pct}% of your period allowance`}
    >
      <span className={styles.barTrack}>
        <span className={styles.barFill} style={{ width: `${Math.max(2, pct)}%` }} />
      </span>
    </span>
  );
}

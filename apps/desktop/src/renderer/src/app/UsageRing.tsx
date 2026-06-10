import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBudgetStore } from '../stores/budgetStore';
import { useSessionStore } from '../stores/sessionStore';
import { Stack, Text } from '../design-system/components';
import { formatUsd } from './routes/usage/format';
import styles from './UsageRing.module.css';

/**
 * Compact circular AI-usage indicator for the top bar (06). Fills with usage % of the active
 * person's budget and recolors at warn/over; click opens a popover with quick stats + a link to the
 * Usage page. No dollar amounts for non-admins.
 */
export function UsageRing(): JSX.Element | null {
  const status = useBudgetStore((s) => s.status);
  const refresh = useBudgetStore((s) => s.refresh);
  const canCost = useSessionStore((s) => s.can('budgets.manage'));
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<number | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const person = status?.person;
  const limit = person?.limitUsd ?? null;
  const period = person?.period ?? 'week';

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const summary = await window.selfos?.usageSummary({ scope: 'person', period });
      setSessions(summary?.sessionCount ?? 0);
    })();
  }, [open, period]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!person || limit === null) return null;

  const ratio = limit > 0 ? Math.min(1, person.spentUsd / limit) : 0;
  const pct = Math.round(ratio * 100);
  const periodLabel = period === 'week' ? 'this week' : 'this month';
  const arcClass =
    person.state === 'over'
      ? `${styles.arc} ${styles.over}`
      : person.state === 'warn'
        ? `${styles.arc} ${styles.warn}`
        : `${styles.arc} ${styles.ok}`;

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.ringButton}
        aria-expanded={open}
        aria-label={`AI usage: ${pct}% used ${periodLabel}`}
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 36 36" className={styles.ring} aria-hidden="true">
          <circle className={styles.track} cx="18" cy="18" r="15.9155" />
          <circle className={arcClass} cx="18" cy="18" r="15.9155" strokeDasharray={`${pct} 100`} />
        </svg>
        <span>{pct}%</span>
      </button>
      {open ? (
        <>
          <button
            type="button"
            className={styles.backdrop}
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setOpen(false)}
          />
          <div className={styles.popover} role="dialog" aria-label="AI usage">
            <Stack gap={2}>
              <Text size="xs" tone="tertiary">
                AI usage {periodLabel}
              </Text>
              <Text weight={600}>{pct}% of your allowance</Text>
              {canCost ? (
                <Text size="sm" tone="secondary">
                  {formatUsd(person.spentUsd)} of {formatUsd(limit)}
                </Text>
              ) : null}
              {sessions !== null ? (
                <Text size="sm" tone="secondary">
                  {sessions} session{sessions === 1 ? '' : 's'} {periodLabel}
                </Text>
              ) : null}
              <button
                type="button"
                className={styles.link}
                onClick={() => {
                  setOpen(false);
                  navigate('/usage');
                }}
              >
                View usage details →
              </button>
            </Stack>
          </div>
        </>
      ) : null}
    </div>
  );
}

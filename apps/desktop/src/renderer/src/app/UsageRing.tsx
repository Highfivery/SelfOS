import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usageTypeLabel } from '@shared/usageTypes';
import type { UsageSummary } from '@shared/schemas';
import { useBudgetStore } from '../stores/budgetStore';
import { useSessionStore } from '../stores/sessionStore';
import { AdminOnlyBadge, Stack, Text, TitlebarControl } from '../design-system/components';
import { formatUsd } from './routes/usage/format';
import styles from './UsageRing.module.css';

/** The 1–2 highest-count usage types this period, e.g. "Sessions · Dream images". */
function topTypes(byType: UsageSummary['byType']): string {
  return Object.entries(byType)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 2)
    .map(([type]) => usageTypeLabel(type))
    .join(' · ');
}

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
  const [summary, setSummary] = useState<UsageSummary | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const person = status?.person;
  const period = person?.period ?? 'week';

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const next = await window.selfos?.usageSummary({ scope: 'person', period });
      setSummary(next ?? null);
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

  // The ring shows whenever there's a budget (everyone has the default), driven by `budgetRatio` — a
  // non-$ signal present for every caller. The dollar figures are admin-only (redacted otherwise).
  if (!person || person.state === 'none') return null;

  const pct = Math.round(person.budgetRatio * 100);
  const periodLabel = period === 'week' ? 'this week' : 'this month';
  const arcClass =
    person.state === 'over'
      ? `${styles.arc} ${styles.over}`
      : person.state === 'warn'
        ? `${styles.arc} ${styles.warn}`
        : `${styles.arc} ${styles.ok}`;

  const sessions = summary?.sessionCount ?? null;
  const types = summary ? topTypes(summary.byType) : '';

  return (
    <div className={styles.wrap}>
      <TitlebarControl
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`AI usage: ${pct}% used ${periodLabel}`}
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 36 36" className={styles.ring} aria-hidden="true">
          <circle className={styles.track} cx="18" cy="18" r="15.9155" />
          <circle className={arcClass} cx="18" cy="18" r="15.9155" strokeDasharray={`${pct} 100`} />
        </svg>
        <span>{pct}%</span>
      </TitlebarControl>
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
              {canCost && person.limitUsd != null ? (
                <span className={styles.adminRow}>
                  <Text size="sm" tone="secondary">
                    {formatUsd(person.spentUsd ?? 0)} of {formatUsd(person.limitUsd)}
                  </Text>
                  <AdminOnlyBadge />
                </span>
              ) : null}
              {sessions !== null ? (
                <Text size="sm" tone="secondary">
                  {sessions} session{sessions === 1 ? '' : 's'} {periodLabel}
                </Text>
              ) : null}
              {types ? (
                <Text size="sm" tone="secondary">
                  Top usage: {types}
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

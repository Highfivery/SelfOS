import type { ResultsSummary } from './resultsSummary';
import { Text } from '../../../design-system/components';
import styles from './Questionnaires.module.css';

/** A small response-rate ring — the percentage is shown as text too (never colour-only, §9). */
function ResponseRing({ rate }: { rate: number }): JSX.Element {
  const pct = Math.round(rate * 100);
  const r = 18;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - rate);
  return (
    <span className={styles.summaryRing}>
      <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
        <circle cx="22" cy="22" r={r} className={styles.ringTrack} strokeWidth="5" fill="none" />
        <circle
          cx="22"
          cy="22"
          r={r}
          className={styles.ringValue}
          strokeWidth="5"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 22 22)"
        />
      </svg>
      <span className={styles.summaryRingText}>
        <span className={styles.summaryStatNum}>{pct}%</span>
        <span className={styles.summaryStatLabel}>answered</span>
      </span>
    </span>
  );
}

/**
 * The Results summary band (08-questionnaires §20.6): who a questionnaire went to + how many have answered,
 * with a response-rate ring. Derived from the already-loaded sends; carries no raw answers.
 */
export function ResultsSummaryBand({ summary }: { summary: ResultsSummary }): JSX.Element {
  const { total, answered, awaiting, inProgress, declined } = summary;
  // Tiles mirror the card groups (§20.6) so a count reads the same in the band and under its heading.
  const extras: { n: number; label: string }[] = [
    { n: awaiting, label: 'awaiting' },
    { n: inProgress, label: 'in progress' },
    { n: declined, label: 'declined' },
  ].filter((s) => s.n > 0);
  return (
    <div className={styles.summaryBand}>
      <div className={styles.summaryStats}>
        <div className={styles.summaryStat}>
          <span className={styles.summaryStatNum}>{total}</span>
          <span className={styles.summaryStatLabel}>
            {total === 1 ? 'recipient' : 'recipients'}
          </span>
        </div>
        <div className={styles.summaryStat}>
          <span className={styles.summaryStatNum}>{answered}</span>
          <span className={styles.summaryStatLabel}>answered</span>
        </div>
        {extras.map((s) => (
          <div className={styles.summaryStat} key={s.label}>
            <span className={styles.summaryStatNum}>{s.n}</span>
            <span className={styles.summaryStatLabel}>{s.label}</span>
          </div>
        ))}
      </div>
      {total > 0 ? <ResponseRing rate={summary.responseRate} /> : null}
    </div>
  );
}

/** A status group heading + count for the per-recipient card sections (§20.6). */
export function ResultGroupHead({ label, count }: { label: string; count: number }): JSX.Element {
  return (
    <div className={styles.resultGroupHead}>
      <Text size="sm" weight={500}>
        {label}
      </Text>
      <span className={styles.resultGroupCount}>{count}</span>
    </div>
  );
}

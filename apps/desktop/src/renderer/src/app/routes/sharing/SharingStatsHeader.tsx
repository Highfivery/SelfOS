import { Lock } from 'lucide-react';
import { Text } from '../../../design-system/components';
import type { SharingStats } from './sharingDashboard';
import styles from './SharingDashboard.module.css';

/** Initials for a small avatar tile (first letter of the display name). */
function initials(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '·';
}

/**
 * The stats header (68 §3.1): three tiles — things-you-share (with a by-type split), people-reached
 * (per-recipient avatar chips), and kept-private (the reassurance count of `restricted` facts never shared).
 * Every count + split is text, never colour-only (§9). Stacks to one column below `--bp-sm`.
 */
export function SharingStatsHeader({ stats }: { stats: SharingStats }): JSX.Element {
  const topTypes = stats.byType.slice(0, 4);
  const topPeople = stats.peopleReached.slice(0, 5);

  return (
    <div className={styles.statStrip}>
      <div className={styles.statTile}>
        <div className={styles.statBig}>{stats.total}</div>
        <div className={styles.statLabel}>
          {stats.total === 1 ? 'Thing you share' : 'Things you share'}
        </div>
        {topTypes.length > 0 ? (
          <div className={styles.statChips}>
            {topTypes.map((t) => (
              <span key={t.type} className={styles.statChip}>
                {t.label} <span className={styles.statChipCount}>{t.count}</span>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className={styles.statTile}>
        <div className={styles.statBig}>{stats.peopleReached.length}</div>
        <div className={styles.statLabel}>
          {stats.peopleReached.length === 1 ? 'Person reached' : 'People reached'}
        </div>
        {topPeople.length > 0 ? (
          <div className={styles.statChips}>
            {topPeople.map((p) => (
              <span key={p.id} className={styles.statChip}>
                <span className={styles.avatar} aria-hidden="true">
                  {initials(p.name)}
                </span>
                {p.name} <span className={styles.statChipCount}>{p.count}</span>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className={styles.statTile}>
        <div className={styles.statBig}>{stats.keptPrivateCount}</div>
        <div className={styles.statLabel}>Kept private</div>
        <div className={styles.statChips}>
          <span className={`${styles.statChip} ${styles.statChipLock}`}>
            <Lock size={12} aria-hidden="true" /> Sensitive · never shared
          </span>
        </div>
        <Text size="xs" tone="tertiary" className={styles.statNote}>
          Intimacy &amp; hard topics stay yours unless you deliberately share them.
        </Text>
      </div>
    </div>
  );
}

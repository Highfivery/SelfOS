import { Flame } from 'lucide-react';
import type { StreakInfo } from '@selfos/core/home';
import styles from './Home.module.css';

/**
 * The gentle "rhythm" pill (60 §3.1.1) — "N-day rhythm" when there's a live run of ≥2 consecutive active
 * days. Positive-only: it shows nothing when the run is short, broken, or suppressed during a crisis (§8) —
 * there is never a "you broke your streak" state. A single-day run isn't shown (too thin to celebrate).
 */
export function RhythmStreak({ streak }: { streak: StreakInfo }): JSX.Element | null {
  if (streak.suppressed || streak.days < 2) return null;
  return (
    <span className={styles.streakPill} title={`${streak.days} days in a row with SelfOS`}>
      <Flame size={14} aria-hidden="true" />
      {streak.days}-day rhythm
    </span>
  );
}

import type { MomentumReflection } from '@selfos/core/recommendations';
import styles from './Home.module.css';

/**
 * The gentle momentum reflection (53 §3.3) — a single warm line in the header reflecting what positively
 * happened ("you've shown up 3 times this week"). Pure TEXT (never a color bar / streak / target, §9). When
 * there's nothing notable (a quiet week) it renders nothing, leaving just the greeting — never a scold.
 */
export function MomentumLine({
  reflection,
}: {
  reflection: MomentumReflection;
}): JSX.Element | null {
  if (!reflection.line) return null;
  return <p className={styles.status}>{reflection.line}</p>;
}

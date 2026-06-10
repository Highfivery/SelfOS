import type { ReactNode } from 'react';
import styles from './TopBar.module.css';

/**
 * The global top bar — a slot-based header. `left` holds leading controls (the mobile nav hamburger);
 * `children` are the right-aligned global items (appearance toggle, usage ring, account menu; more
 * later). Keeping it slot-based means new items drop in without reworking the shell.
 */
export function TopBar({ left, children }: { left?: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <header className={styles.bar}>
      <div className={styles.left}>{left}</div>
      <div className={styles.items}>{children}</div>
    </header>
  );
}

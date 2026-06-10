import type { ReactNode } from 'react';
import styles from './TopBar.module.css';

/**
 * The global top bar — a slot for right-aligned status items (the usage ring today; notifications,
 * search, etc. later). Keeping it a registry-style slot means new items drop in without rework.
 */
export function TopBar({ children }: { children: ReactNode }): JSX.Element {
  return (
    <header className={styles.bar}>
      <div className={styles.items}>{children}</div>
    </header>
  );
}

import type { ReactNode } from 'react';
import styles from './BootLayout.module.css';

/** Centered, full-window layout for the pre-shell phases (splash, onboarding, vault error). */
export function BootLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className={styles.screen}>
      <div className={styles.inner}>{children}</div>
    </div>
  );
}

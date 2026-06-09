import { Outlet } from 'react-router-dom';
import { House } from 'lucide-react';
import { AppearanceToggle } from './AppearanceToggle';
import { useBootState } from './useBootState';
import styles from './AppShell.module.css';

export function AppShell(): JSX.Element {
  const boot = useBootState();

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <header className={styles.brand}>
          <span className={styles.mark}>SelfOS</span>
        </header>

        <nav className={styles.nav} aria-label="Primary">
          <button
            type="button"
            className={`${styles.navItem} ${styles.navItemActive}`}
            aria-current="page"
          >
            <House size={18} aria-hidden="true" />
            <span>Home</span>
          </button>
        </nav>

        <div className={styles.spacer} />

        <footer className={styles.footer}>
          <AppearanceToggle />
          {boot ? (
            <p className={styles.status} data-testid="boot-status">
              <span className={styles.statusDot} aria-hidden="true" />
              {boot.phase === 'ready' ? 'Ready' : boot.phase}
            </p>
          ) : null}
        </footer>
      </aside>

      <main className={styles.content}>
        <Outlet />
      </main>
    </div>
  );
}

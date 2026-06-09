import { NavLink, Outlet } from 'react-router-dom';
import { House, Shapes } from 'lucide-react';
import { AppearanceToggle } from './AppearanceToggle';
import { useBootState } from './useBootState';
import styles from './AppShell.module.css';

function navClass({ isActive }: { isActive: boolean }): string {
  return isActive ? `${styles.navItem} ${styles.navItemActive}` : (styles.navItem ?? '');
}

export function AppShell(): JSX.Element {
  const boot = useBootState();

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <header className={styles.brand}>
          <span className={styles.mark}>SelfOS</span>
        </header>

        <nav className={styles.nav} aria-label="Primary">
          <NavLink to="/" end className={navClass}>
            <House size={18} aria-hidden="true" />
            <span>Home</span>
          </NavLink>
          {import.meta.env.DEV ? (
            <NavLink to="/gallery" className={navClass}>
              <Shapes size={18} aria-hidden="true" />
              <span>Gallery</span>
            </NavLink>
          ) : null}
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

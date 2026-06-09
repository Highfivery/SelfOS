import { NavLink, Outlet } from 'react-router-dom';
import { House, Shapes } from 'lucide-react';
import { AppearanceToggle } from './AppearanceToggle';
import styles from './AppShell.module.css';

function navClass({ isActive }: { isActive: boolean }): string {
  return isActive ? `${styles.navItem} ${styles.navItemActive}` : (styles.navItem ?? '');
}

export function AppShell(): JSX.Element {
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
        </footer>
      </aside>

      <main className={styles.content}>
        <Outlet />
      </main>
    </div>
  );
}

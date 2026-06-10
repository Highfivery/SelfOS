import { NavLink, Outlet } from 'react-router-dom';
import { House, Settings, Shapes } from 'lucide-react';
import { AppearanceToggle } from './AppearanceToggle';
import { useVaultConflicts } from './useVaultConflicts';
import { Banner } from '../design-system/components';
import styles from './AppShell.module.css';

function navClass({ isActive }: { isActive: boolean }): string {
  return isActive ? `${styles.navItem} ${styles.navItemActive}` : (styles.navItem ?? '');
}

export function AppShell(): JSX.Element {
  const conflicts = useVaultConflicts();

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
          <NavLink to="/settings" className={navClass}>
            <Settings size={18} aria-hidden="true" />
            <span>Settings</span>
          </NavLink>
          <AppearanceToggle />
        </footer>
      </aside>

      <main className={styles.content}>
        {conflicts.length > 0 ? (
          <div className={styles.banner}>
            <Banner tone="warning">
              {conflicts.length === 1
                ? 'A sync conflict copy was found in your vault.'
                : `${conflicts.length} sync conflict copies were found in your vault.`}{' '}
              Open the vault folder to resolve them — SelfOS won’t touch them.
            </Banner>
          </div>
        ) : null}
        <Outlet />
      </main>
    </div>
  );
}

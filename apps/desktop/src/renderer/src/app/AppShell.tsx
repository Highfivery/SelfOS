import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  BarChart3,
  House,
  MessageCircle,
  Settings,
  Shapes,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { AppearanceToggle } from './AppearanceToggle';
import { useVaultConflicts } from './useVaultConflicts';
import { useSessionStore } from '../stores/sessionStore';
import { Switcher } from './Switcher';
import { SuperAdminUnlock } from './SuperAdminUnlock';
import { TopBar } from './TopBar';
import { UsageRing } from './UsageRing';
import { Banner } from '../design-system/components';
import styles from './AppShell.module.css';

function navClass({ isActive }: { isActive: boolean }): string {
  return isActive ? `${styles.navItem} ${styles.navItemActive}` : (styles.navItem ?? '');
}

export function AppShell(): JSX.Element {
  const conflicts = useVaultConflicts();
  const activePerson = useSessionStore((s) => s.activePerson);
  const canManagePeople = useSessionStore((s) => s.can('people.manage'));
  const canManageRoles = useSessionStore((s) => s.can('roles.manage'));
  const hasSessions = useSessionStore((s) => s.can('sessions.own'));
  const superAdmin = useSessionStore((s) => s.superAdmin);
  const unlockPromptOpen = useSessionStore((s) => s.unlockPromptOpen);
  const lockSuperAdmin = useSessionStore((s) => s.lockSuperAdmin);
  const [switching, setSwitching] = useState(false);

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
          {hasSessions ? (
            <NavLink to="/sessions" className={navClass}>
              <MessageCircle size={18} aria-hidden="true" />
              <span>Sessions</span>
            </NavLink>
          ) : null}
          {canManagePeople ? (
            <NavLink to="/people" className={navClass}>
              <Users size={18} aria-hidden="true" />
              <span>People</span>
            </NavLink>
          ) : null}
          {canManageRoles ? (
            <NavLink to="/roles" className={navClass}>
              <ShieldCheck size={18} aria-hidden="true" />
              <span>Roles</span>
            </NavLink>
          ) : null}
          {hasSessions ? (
            <NavLink to="/usage" className={navClass}>
              <BarChart3 size={18} aria-hidden="true" />
              <span>Usage</span>
            </NavLink>
          ) : null}
          {import.meta.env.DEV ? (
            <NavLink to="/gallery" className={navClass}>
              <Shapes size={18} aria-hidden="true" />
              <span>Gallery</span>
            </NavLink>
          ) : null}
        </nav>

        <div className={styles.spacer} />

        <footer className={styles.footer}>
          {superAdmin ? (
            <button type="button" className={styles.superAdminBadge} onClick={lockSuperAdmin}>
              Super-admin · Lock
            </button>
          ) : null}
          {activePerson ? (
            <button
              type="button"
              className={styles.switchButton}
              onClick={() => setSwitching(true)}
            >
              Signed in as {activePerson.displayName}
            </button>
          ) : null}
          <NavLink to="/settings" className={navClass}>
            <Settings size={18} aria-hidden="true" />
            <span>Settings</span>
          </NavLink>
          <AppearanceToggle />
        </footer>
      </aside>

      <main className={styles.content}>
        <TopBar>
          <UsageRing />
        </TopBar>
        <div className={styles.contentInner}>
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
        </div>
      </main>

      {switching ? <Switcher onClose={() => setSwitching(false)} /> : null}
      {unlockPromptOpen ? <SuperAdminUnlock /> : null}
    </div>
  );
}

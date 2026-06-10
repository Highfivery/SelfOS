import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  BarChart3,
  House,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Shapes,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { AppearanceToggle } from './AppearanceToggle';
import { Brand } from './Brand';
import { useVaultConflicts } from './useVaultConflicts';
import { useNavStore } from '../stores/navStore';
import { useSessionStore } from '../stores/sessionStore';
import { AccountMenu } from './AccountMenu';
import { Switcher } from './Switcher';
import { LockScreen } from './LockScreen';
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
  const canManagePeople = useSessionStore((s) => s.can('people.manage'));
  const canManageRoles = useSessionStore((s) => s.can('roles.manage'));
  const hasSessions = useSessionStore((s) => s.can('sessions.own'));
  const locked = useSessionStore((s) => s.locked);
  const unlockPromptOpen = useSessionStore((s) => s.unlockPromptOpen);
  const collapsed = useNavStore((s) => s.collapsed);
  const toggleSidebar = useNavStore((s) => s.toggle);
  const [switching, setSwitching] = useState(false);

  const tip = (label: string): string | undefined => (collapsed ? label : undefined);

  // Logout: the lock gate fully replaces the app so sensitive content unmounts (not just hidden) —
  // nothing behind it stays focusable or in the assistive-tech tree (02-app-shell §3.6).
  if (locked) return <LockScreen />;

  return (
    <div className={styles.shell}>
      <aside className={collapsed ? `${styles.sidebar} ${styles.collapsed}` : styles.sidebar}>
        <header className={styles.brand}>
          <Brand collapsed={collapsed} />
        </header>

        <nav className={styles.nav} aria-label="Primary">
          <NavLink to="/" end className={navClass} aria-label="Home" title={tip('Home')}>
            <House size={18} aria-hidden="true" />
            <span className={styles.label}>Home</span>
          </NavLink>
          {hasSessions ? (
            <NavLink
              to="/sessions"
              className={navClass}
              aria-label="Sessions"
              title={tip('Sessions')}
            >
              <MessageCircle size={18} aria-hidden="true" />
              <span className={styles.label}>Sessions</span>
            </NavLink>
          ) : null}
          {canManagePeople ? (
            <NavLink to="/people" className={navClass} aria-label="People" title={tip('People')}>
              <Users size={18} aria-hidden="true" />
              <span className={styles.label}>People</span>
            </NavLink>
          ) : null}
          {canManageRoles ? (
            <NavLink to="/roles" className={navClass} aria-label="Roles" title={tip('Roles')}>
              <ShieldCheck size={18} aria-hidden="true" />
              <span className={styles.label}>Roles</span>
            </NavLink>
          ) : null}
          {hasSessions ? (
            <NavLink to="/usage" className={navClass} aria-label="Usage" title={tip('Usage')}>
              <BarChart3 size={18} aria-hidden="true" />
              <span className={styles.label}>Usage</span>
            </NavLink>
          ) : null}
          {import.meta.env.DEV ? (
            <NavLink to="/gallery" className={navClass} aria-label="Gallery" title={tip('Gallery')}>
              <Shapes size={18} aria-hidden="true" />
              <span className={styles.label}>Gallery</span>
            </NavLink>
          ) : null}
        </nav>

        <div className={styles.spacer} />

        <footer className={styles.footer}>
          <NavLink
            to="/settings"
            className={navClass}
            aria-label="Settings"
            title={tip('Settings')}
          >
            <Settings size={18} aria-hidden="true" />
            <span className={styles.label}>Settings</span>
          </NavLink>
          <button
            type="button"
            className={styles.collapseToggle}
            onClick={toggleSidebar}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-pressed={collapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? (
              <PanelLeftOpen size={18} aria-hidden="true" />
            ) : (
              <PanelLeftClose size={18} aria-hidden="true" />
            )}
            <span className={styles.label}>Collapse</span>
          </button>
        </footer>
      </aside>

      <main className={styles.content}>
        <TopBar>
          <AppearanceToggle />
          <UsageRing />
          <AccountMenu onSwitch={() => setSwitching(true)} />
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

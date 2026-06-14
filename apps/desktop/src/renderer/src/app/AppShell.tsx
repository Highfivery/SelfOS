import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  BarChart3,
  Brain,
  ClipboardList,
  House,
  Inbox,
  Menu,
  MessageCircle,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Shapes,
  ShieldAlert,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { AppearanceMenu } from './AppearanceMenu';
import { Brand } from './Brand';
import { useVaultConflicts } from './useVaultConflicts';
import { useNavStore } from '../stores/navStore';
import { useSessionStore } from '../stores/sessionStore';
import { useConversationStore } from '../stores/conversationStore';
import { useBudgetStore } from '../stores/budgetStore';
import { useUsageStore } from '../stores/usageStore';
import { unansweredCount, useInboxStore } from '../stores/inboxStore';
import { useDreamStore } from '../stores/dreamStore';
import { useDreamAnalysisStore } from '../stores/dreamAnalysisStore';
import { useDreamPatternStore } from '../stores/dreamPatternStore';
import { useResultsStore } from '../stores/resultsStore';
import { AccountMenu } from './AccountMenu';
import { Switcher } from './Switcher';
import { LockScreen } from './LockScreen';
import { SuperAdminUnlock } from './SuperAdminUnlock';
import { TopBar } from './TopBar';
import { UsageRing } from './UsageRing';
import { Banner } from '../design-system/components';
import styles from './AppShell.module.css';

const MOBILE_BREAKPOINT = 768; // --bp-md: below this the sidebar is an off-canvas drawer

function navClass({ isActive }: { isActive: boolean }): string {
  return isActive ? `${styles.navItem} ${styles.navItemActive}` : (styles.navItem ?? '');
}

export function AppShell(): JSX.Element {
  const conflicts = useVaultConflicts();
  const canManagePeople = useSessionStore((s) => s.can('people.manage'));
  const canManageRoles = useSessionStore((s) => s.can('roles.manage'));
  const hasSessions = useSessionStore((s) => s.can('sessions.own'));
  const canCreateQuestionnaires = useSessionStore((s) => s.can('questionnaires.create'));
  const canAnswerQuestionnaires = useSessionStore((s) => s.can('questionnaires.answer'));
  const canViewInsights = useSessionStore((s) => s.can('questionnaires.viewResults'));
  const inboxItems = useInboxStore((s) => s.items);
  const inboxCount = unansweredCount(inboxItems);
  const canOwnDreams = useSessionStore((s) => s.can('dreams.own'));
  const isSuperAdmin = useSessionStore((s) => s.superAdmin);
  const locked = useSessionStore((s) => s.locked);
  const unlockPromptOpen = useSessionStore((s) => s.unlockPromptOpen);
  const activePersonId = useSessionStore((s) => s.activePerson?.id ?? null);
  const collapsed = useNavStore((s) => s.collapsed);
  const toggleSidebar = useNavStore((s) => s.toggle);
  const [switching, setSwitching] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < MOBILE_BREAKPOINT);
  const drawerRef = useRef<HTMLElement>(null);
  const hamburgerRef = useRef<HTMLButtonElement>(null);

  const closeDrawer = (): void => setDrawerOpen(false);

  // When the signed-in person changes, drop the previous account's per-person data and load this
  // person's — sessions/usage/budget are per-user, so nothing from the prior login may linger
  // (the usage ring + Sessions list update immediately; the Usage screen reloads on next view).
  useEffect(() => {
    useConversationStore.getState().reset();
    useBudgetStore.getState().reset();
    useUsageStore.getState().reset();
    useInboxStore.getState().reset();
    useDreamStore.getState().reset();
    useDreamAnalysisStore.getState().reset();
    useDreamPatternStore.getState().reset();
    useResultsStore.getState().reset(); // sender-scoped Results/trends — per-person, must reset too
    void useConversationStore.getState().load();
    void useBudgetStore.getState().refresh();
    void useInboxStore.getState().load();
    void useDreamStore.getState().load();
  }, [activePersonId]);

  // Track the mobile breakpoint; collapse any open drawer when the viewport grows back to desktop.
  useEffect(() => {
    const onResize = (): void => {
      const mobile = window.innerWidth < MOBILE_BREAKPOINT;
      setIsMobile(mobile);
      if (!mobile) setDrawerOpen(false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // While the drawer is open: move focus into it, close on Escape, and restore focus to the
  // hamburger on close (standard overlay-menu a11y; 02-app-shell §9).
  useEffect(() => {
    if (!drawerOpen) return undefined;
    drawerRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      hamburgerRef.current?.focus();
    };
  }, [drawerOpen]);

  const tip = (label: string): string | undefined => (collapsed ? label : undefined);

  // Logout: the lock gate fully replaces the app so sensitive content unmounts (not just hidden) —
  // nothing behind it stays focusable or in the assistive-tech tree (02-app-shell §3.6).
  if (locked) return <LockScreen />;

  const sidebarClass = [
    styles.sidebar,
    collapsed ? styles.collapsed : '',
    drawerOpen ? styles.drawerOpen : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={styles.shell}>
      {drawerOpen ? (
        <button
          type="button"
          className={styles.scrim}
          aria-label="Close navigation"
          tabIndex={-1}
          onClick={closeDrawer}
        />
      ) : null}

      <aside ref={drawerRef} className={sidebarClass} tabIndex={-1}>
        <header className={styles.brand}>
          <Brand collapsed={collapsed && !isMobile} />
        </header>

        <nav className={styles.nav} aria-label="Primary">
          <NavLink
            to="/"
            end
            className={navClass}
            aria-label="Home"
            title={tip('Home')}
            onClick={closeDrawer}
          >
            <House size={18} aria-hidden="true" />
            <span className={styles.label}>Home</span>
          </NavLink>
          {hasSessions ? (
            <NavLink
              to="/sessions"
              className={navClass}
              aria-label="Sessions"
              title={tip('Sessions')}
              onClick={closeDrawer}
            >
              <MessageCircle size={18} aria-hidden="true" />
              <span className={styles.label}>Sessions</span>
            </NavLink>
          ) : null}
          {canAnswerQuestionnaires ? (
            <NavLink
              to="/inbox"
              className={navClass}
              aria-label={inboxCount > 0 ? `Inbox, ${inboxCount} to answer` : 'Inbox'}
              title={tip('Inbox')}
              onClick={closeDrawer}
            >
              <Inbox size={18} aria-hidden="true" />
              <span className={styles.label}>Inbox</span>
              {inboxCount > 0 ? (
                <span className={styles.navBadge} aria-hidden="true">
                  {inboxCount}
                </span>
              ) : null}
            </NavLink>
          ) : null}
          {canCreateQuestionnaires ? (
            <NavLink
              to="/questionnaires"
              className={navClass}
              aria-label="Questionnaires"
              title={tip('Questionnaires')}
              onClick={closeDrawer}
            >
              <ClipboardList size={18} aria-hidden="true" />
              <span className={styles.label}>Questionnaires</span>
            </NavLink>
          ) : null}
          {canViewInsights ? (
            <NavLink
              to="/memory"
              className={navClass}
              aria-label="Memory"
              title={tip('Memory')}
              onClick={closeDrawer}
            >
              <Brain size={18} aria-hidden="true" />
              <span className={styles.label}>Memory</span>
            </NavLink>
          ) : null}
          {canOwnDreams ? (
            <NavLink
              to="/dreams"
              className={navClass}
              aria-label="Dreams"
              title={tip('Dreams')}
              onClick={closeDrawer}
            >
              <Moon size={18} aria-hidden="true" />
              <span className={styles.label}>Dreams</span>
            </NavLink>
          ) : null}
          {canManagePeople ? (
            <NavLink
              to="/people"
              className={navClass}
              aria-label="People"
              title={tip('People')}
              onClick={closeDrawer}
            >
              <Users size={18} aria-hidden="true" />
              <span className={styles.label}>People</span>
            </NavLink>
          ) : null}
          {canManageRoles ? (
            <NavLink
              to="/roles"
              className={navClass}
              aria-label="Roles"
              title={tip('Roles')}
              onClick={closeDrawer}
            >
              <ShieldCheck size={18} aria-hidden="true" />
              <span className={styles.label}>Roles</span>
            </NavLink>
          ) : null}
          {hasSessions ? (
            <NavLink
              to="/usage"
              className={navClass}
              aria-label="Usage"
              title={tip('Usage')}
              onClick={closeDrawer}
            >
              <BarChart3 size={18} aria-hidden="true" />
              <span className={styles.label}>Usage</span>
            </NavLink>
          ) : null}
          {isSuperAdmin ? (
            <NavLink
              to="/audit"
              className={navClass}
              aria-label="Raw-access audit"
              title={tip('Audit')}
              onClick={closeDrawer}
            >
              <ShieldAlert size={18} aria-hidden="true" />
              <span className={styles.label}>Audit</span>
            </NavLink>
          ) : null}
          {import.meta.env.DEV ? (
            <NavLink
              to="/gallery"
              className={navClass}
              aria-label="Gallery"
              title={tip('Gallery')}
              onClick={closeDrawer}
            >
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
            onClick={closeDrawer}
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
        <TopBar
          left={
            <button
              ref={hamburgerRef}
              type="button"
              className={styles.hamburger}
              aria-label="Open navigation"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
            >
              <Menu size={20} aria-hidden="true" />
            </button>
          }
        >
          <AppearanceMenu />
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

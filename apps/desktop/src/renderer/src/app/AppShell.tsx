import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { OWNER_ROLE_ID } from '@shared/capabilities';
import {
  BarChart3,
  Brain,
  ClipboardList,
  House,
  Inbox,
  MessageCircle,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Shapes,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
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
import { useGuidanceStore } from '../stores/guidanceStore';
import { useIntakeStore } from '../stores/intakeStore';
import { Onboarding } from './routes/onboarding/Onboarding';
import { AppHeader } from './AppHeader';
import { Switcher } from './Switcher';
import { LockScreen } from './LockScreen';
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
  const canDoIntake = useSessionStore((s) => s.can('intake.own'));
  const intakeLoaded = useIntakeStore((s) => s.loaded);
  const intakeState = useIntakeStore((s) => s.state);
  const intakeIncomplete =
    canDoIntake && intakeState !== null && intakeState.session.status !== 'complete';
  // The active person's role is the Owner (the household setter-upper) — the onboarding gate exempts them
  // (decision 2026-06-15: onboarding is a hard requirement for Members only, never the Owner).
  const isOwner = useSessionStore((s) => {
    if (!s.activePerson || !s.access) return false;
    const account = s.access.accounts.find((a) => a.personId === s.activePerson?.id);
    return account?.roleId === OWNER_ROLE_ID;
  });
  const locked = useSessionStore((s) => s.locked);
  const activePersonId = useSessionStore((s) => s.activePerson?.id ?? null);
  const collapsed = useNavStore((s) => s.collapsed);
  const toggleSidebar = useNavStore((s) => s.toggle);
  const [switching, setSwitching] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
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
    useGuidanceStore.getState().reset(); // guided suggestions + 18+ ack are per-person (16 §4.3/§8.3)
    useIntakeStore.getState().reset(); // the intake is per-person (18-personal-onboarding §7)
    void useConversationStore.getState().load();
    void useBudgetStore.getState().refresh();
    void useInboxStore.getState().load();
    void useDreamStore.getState().load();
    void useGuidanceStore.getState().load();
    void useIntakeStore.getState().load();
  }, [activePersonId]);

  // Collapse any open drawer when the viewport grows back to desktop (where the sidebar is permanent).
  useEffect(() => {
    const onResize = (): void => {
      if (window.innerWidth >= MOBILE_BREAKPOINT) setDrawerOpen(false);
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

  // Onboarding is a hard requirement for Members (18-personal-onboarding §3.1, decision 2026-06-15): a
  // Member who hasn't finished onboarding is taken straight into a full-screen takeover (no sidebar / other
  // screens) until their portrait is generated (`status === 'complete'`). The Owner is exempt (they set up
  // AI, which the intake requires). The header stays so they can still switch person / lock (members can't
  // reach AI settings — when AI is off they see the calm "ask your owner" state). We gate until we KNOW it's
  // complete (treating not-yet-loaded as incomplete) to avoid flashing the app first.
  const mustOnboard = canDoIntake && !isOwner;
  const intakeGated = mustOnboard && (!intakeLoaded || intakeState?.session.status !== 'complete');
  if (intakeGated) {
    return (
      <div className={styles.shell}>
        <AppHeader
          conflicts={conflicts}
          onSwitchPerson={() => setSwitching(true)}
          onOpenNav={() => undefined}
          navOpen={false}
          hamburgerRef={hamburgerRef}
          hideNav
        />
        <div className={styles.body}>
          <main className={styles.content}>
            <div className={styles.contentInner}>
              <Onboarding />
            </div>
          </main>
        </div>
        {switching ? <Switcher onClose={() => setSwitching(false)} /> : null}
      </div>
    );
  }

  const sidebarClass = [
    styles.sidebar,
    collapsed ? styles.collapsed : '',
    drawerOpen ? styles.drawerOpen : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={styles.shell}>
      <AppHeader
        conflicts={conflicts}
        onSwitchPerson={() => setSwitching(true)}
        onOpenNav={() => setDrawerOpen(true)}
        navOpen={drawerOpen}
        hamburgerRef={hamburgerRef}
      />

      <div className={styles.body}>
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
            {canDoIntake ? (
              <NavLink
                to="/onboarding"
                className={navClass}
                aria-label={intakeIncomplete ? 'Onboarding, not finished' : 'Onboarding'}
                title={tip('Onboarding')}
                onClick={closeDrawer}
              >
                <Sparkles size={18} aria-hidden="true" />
                <span className={styles.label}>Onboarding</span>
                {intakeIncomplete ? <span className={styles.navDot} aria-hidden="true" /> : null}
              </NavLink>
            ) : null}
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
      </div>

      {switching ? <Switcher onClose={() => setSwitching(false)} /> : null}
    </div>
  );
}

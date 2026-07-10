import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { OWNER_ROLE_ID } from '@shared/capabilities';
import {
  BarChart3,
  Brain,
  ClipboardList,
  Compass,
  Flag,
  House,
  Inbox,
  MessageCircle,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Heart,
  Settings,
  Shapes,
  Share2,
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
import { useInsightStore } from '../stores/insightStore';
import { useGoalStore } from '../stores/goalStore';
import { useChallengeStore } from '../stores/challengeStore';
import { useTestStore } from '../stores/testStore';
import { useDreamAnalysisStore } from '../stores/dreamAnalysisStore';
import { useDreamPatternStore } from '../stores/dreamPatternStore';
import { useResultsStore } from '../stores/resultsStore';
import { useGuidanceStore } from '../stores/guidanceStore';
import { useIntakeStore } from '../stores/intakeStore';
import { useSynthesisStore } from '../stores/synthesisStore';
import { useNotificationStore } from '../stores/notificationStore';
import { useDiscoveryStore } from '../stores/discoveryStore';
import { togetherWaitingCount, useTogetherStore } from '../stores/togetherStore';
import { useNotificationSources } from './notifications/useNotificationSources';
import { useUpdateChecks } from './notifications/useUpdateChecks';
import { useMemoryReconcile } from './notifications/useMemoryReconcile';
import { useCoachingSynthesis } from './notifications/useCoachingSynthesis';
import { ToastViewport } from './notifications/ToastViewport';
import { Onboarding } from './routes/onboarding/Onboarding';
import { attentionFromIntakeState } from './routes/onboarding/progress';
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
  const canViewMemory = useSessionStore((s) => s.can('memory.own'));
  const inboxItems = useInboxStore((s) => s.items);
  const inboxCount = unansweredCount(inboxItems);
  const canOwnDreams = useSessionStore((s) => s.can('dreams.own'));
  const canTakeTests = useSessionStore((s) => s.can('tests.own'));
  // Together (58 §3.1): the nav shows only with `together.own` AND a live partner edge; the badge counts
  // sessions waiting on you (invitations + your-turn), derived over your projection.
  const canTogether = useSessionStore((s) => s.can('together.own'));
  const togetherHasPartner = useTogetherStore((s) => s.hasPartner);
  const togetherWaiting = useTogetherStore((s) => togetherWaitingCount(s.sessions));
  const canDoIntake = useSessionStore((s) => s.can('intake.own'));
  const intakeLoaded = useIntakeStore((s) => s.loaded);
  const intakeState = useIntakeStore((s) => s.state);
  const intakeIncomplete =
    canDoIntake && intakeState !== null && intakeState.session.status !== 'complete';
  // A completed onboarding with new/unanswered questions (55 §3.1) — the nav dot also draws attention here,
  // so the sidebar signals "there's more to answer" without re-gating the person into full-screen onboarding.
  const intakeHasAttention =
    canDoIntake &&
    intakeState !== null &&
    intakeState.session.status === 'complete' &&
    attentionFromIntakeState(intakeState).total > 0;
  const intakeNeedsAttention = intakeIncomplete || intakeHasAttention;
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

  // Feed the notification center from live state (conflicts + suggestions + responses + the update check).
  // Called unconditionally so it runs through the onboarding gate too (35 §3.6).
  useNotificationSources(conflicts);
  // Drive the update-check cadence (launch + 6h + focus, gated by the auto toggle); 36-update-awareness §3.1.
  useUpdateChecks();
  // Drive the automatic memory-reconcile cadence (launch + focus, gated + throttled); 39-living-memory §3.3.
  useMemoryReconcile();
  // Drive the automatic cross-feature synthesis cadence (launch + focus, gated in the bridge); 40 §3.4.
  useCoachingSynthesis();

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
    useInsightStore.getState().reset(); // Memory is per-person — own + relationships only (20 §5.1)
    useGoalStore.getState().reset(); // tracked goals are per-person (39-living-memory §5.4)
    useChallengeStore.getState().reset(); // challenges + cached suggestion are per-person (52 §5.5)
    useTestStore.getState().reset(); // self-assessments are per-person (50 §5.6)
    useSynthesisStore.getState().reset(); // the cached cross-feature synthesis is per-person (40 §5.3)
    useNotificationStore.getState().reset(); // notifications are per-person, device-local (35 §4)
    useDiscoveryStore.getState().reset(); // orientation/tip dismissals are per-person, device-local (41 §4)
    useTogetherStore.getState().reset(); // Together sessions are per-person (58 §5.3)
    void useNotificationStore.getState().load();
    void useDiscoveryStore.getState().load();
    void useConversationStore.getState().load();
    void useBudgetStore.getState().refresh();
    void useInboxStore.getState().load();
    void useDreamStore.getState().load();
    void useGuidanceStore.getState().load();
    void useIntakeStore.getState().load();
    void useInsightStore.getState().load();
    void useGoalStore.getState().load();
    void useChallengeStore.getState().load();
    if (canTogether) void useTogetherStore.getState().load(); // drives the nav visibility + badge (58 §3.1)
  }, [activePersonId, canTogether]);

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
                aria-label={
                  intakeIncomplete
                    ? 'Onboarding, not finished'
                    : intakeHasAttention
                      ? 'Onboarding, questions to answer'
                      : 'Onboarding'
                }
                title={tip('Onboarding')}
                onClick={closeDrawer}
              >
                <Sparkles size={18} aria-hidden="true" />
                <span className={styles.label}>Onboarding</span>
                {intakeNeedsAttention ? (
                  <span className={styles.navDot} aria-hidden="true" />
                ) : null}
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
            {canViewMemory ? (
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
            {canViewMemory ? (
              <NavLink
                to="/goals"
                className={navClass}
                aria-label="Goals"
                title={tip('Goals')}
                onClick={closeDrawer}
              >
                <Flag size={18} aria-hidden="true" />
                <span className={styles.label}>Goals</span>
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
            {canTakeTests ? (
              <NavLink
                to="/you"
                className={navClass}
                aria-label="You"
                title={tip('You')}
                onClick={closeDrawer}
              >
                <Compass size={18} aria-hidden="true" />
                <span className={styles.label}>You</span>
              </NavLink>
            ) : null}
            {canTogether && togetherHasPartner ? (
              <NavLink
                to="/together"
                className={navClass}
                aria-label={
                  togetherWaiting > 0 ? `Together, ${togetherWaiting} waiting on you` : 'Together'
                }
                title={tip('Together')}
                onClick={closeDrawer}
              >
                <Heart size={18} aria-hidden="true" />
                <span className={styles.label}>Together</span>
                {togetherWaiting > 0 ? (
                  <span className={styles.navBadge} aria-hidden="true">
                    {togetherWaiting}
                  </span>
                ) : null}
              </NavLink>
            ) : null}
            {canViewMemory ? (
              <NavLink
                to="/sharing"
                className={navClass}
                aria-label="Sharing & relationships"
                title={tip('Sharing & relationships')}
                onClick={closeDrawer}
              >
                <Share2 size={18} aria-hidden="true" />
                <span className={styles.label}>Sharing</span>
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
            {import.meta.env.DEV && isOwner ? (
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
      <ToastViewport />
    </div>
  );
}

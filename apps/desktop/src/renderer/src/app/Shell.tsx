import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';
import { Home } from './routes/home/Home';
import { Sessions } from './routes/sessions/Sessions';
import { Questionnaires } from './routes/questionnaires/Questionnaires';
import { Inbox } from './routes/inbox/Inbox';
import { Memory } from './routes/memory/Memory';
import { MemoryReview } from './routes/memory/MemoryReview';
import { Goals } from './routes/goals/Goals';
import { SharingAndRelationships } from './routes/sharing/SharingAndRelationships';
import { Dreams } from './routes/dreams/Dreams';
import { DreamPatterns } from './routes/dreams/DreamPatterns';
import { You } from './routes/you/You';
import { TestTake } from './routes/you/TestTake';
import { TestResultScreen } from './routes/you/TestResultScreen';
import { Onboarding } from './routes/onboarding/Onboarding';
import { People } from './routes/people/People';
import { Roles } from './routes/roles/Roles';
import { Usage } from './routes/usage/Usage';
import { Together } from './routes/together/Together';
import { TogetherSession } from './routes/together/TogetherSession';
import { Story } from './routes/books/Story';
import { ContributeRoute } from './routes/books/ContributeRoute';
import { SettingsScreen } from '../settings/SettingsScreen';
import { RequireCapability } from './RequireCapability';
import { useSettingsStore } from '../settings/settingsStore';
import { useNavStore } from '../stores/navStore';
import type { CapabilityKey } from '@shared/capabilities';

/**
 * Capability-gated routes: each is guarded by the SAME capability as its sidebar nav link
 * (AppShell.tsx), so a person who lacks it can never reach the screen — whether by switching the active
 * person while sitting on it or by typing a `#/…` hash. `/` (Home) and `/settings` are intentionally
 * absent (always reachable; Settings filters its own admin-only sections). The map is verified against
 * the nav gating in AppShell.tsx.
 */
const GUARDED_ROUTES: { path: string; capability: CapabilityKey; element: JSX.Element }[] = [
  { path: 'onboarding', capability: 'intake.own', element: <Onboarding /> },
  { path: 'sessions', capability: 'sessions.own', element: <Sessions /> },
  { path: 'questionnaires', capability: 'questionnaires.create', element: <Questionnaires /> },
  { path: 'inbox', capability: 'questionnaires.answer', element: <Inbox /> },
  { path: 'memory', capability: 'memory.own', element: <Memory /> },
  // The dedicated one-at-a-time review screen (65 §3.3) — its own focused route, not inline on Memory.
  { path: 'memory/review', capability: 'memory.own', element: <MemoryReview /> },
  { path: 'goals', capability: 'memory.own', element: <Goals /> },
  // A splat so the dashboard's tabs deep-link (`/sharing/by-category`, …) + survive reload (68 §3.2).
  { path: 'sharing/*', capability: 'memory.own', element: <SharingAndRelationships /> },
  { path: 'dreams', capability: 'dreams.own', element: <Dreams /> },
  { path: 'dreams/patterns', capability: 'dreams.own', element: <DreamPatterns /> },
  { path: 'you', capability: 'tests.own', element: <You /> },
  { path: 'you/:testId/take', capability: 'tests.own', element: <TestTake /> },
  { path: 'you/:testId', capability: 'tests.own', element: <TestResultScreen /> },
  { path: 'people', capability: 'people.manage', element: <People /> },
  { path: 'roles', capability: 'roles.manage', element: <Roles /> },
  // Together (58 §5.3): gated by `together.own`; the finer live-partner-edge gating is enforced in the
  // screen + the bridge (the surface self-hides without a partner, and a direct route shows a calm state).
  // A splat so the home's tabs deep-link (`/together/practices`, …) + survive reload (58 §3.2a). The
  // `together/session/:id` sibling ranks higher (static + dynamic beats a splat), so it still wins.
  { path: 'together/*', capability: 'together.own', element: <Together /> },
  { path: 'together/session/:id', capability: 'together.own', element: <TogetherSession /> },
  // A splat so the Studio's tabs deep-link (`/story/photos`, …) without remounting on tab change (64 §13.2).
  { path: 'books/*', capability: 'story.own', element: <Story /> },
  // Every link minted before the section was renamed — notifications, Home cards, a deep link
  // someone kept — still points at /story, so it redirects rather than 404s (72 §3.1).
  { path: 'story/*', capability: 'story.own', element: <Navigate to="/books" replace /> },
  // Adding to someone ELSE's book (73 §3.2) — its own small surface, deliberately outside the Books
  // chrome: this person isn't writing a book, and a Studio around them would imply an authorship they
  // don't have. Gated `story.own` like the rest; the bridge re-checks the invitation and the edge.
  { path: 'contribute/:invitationId', capability: 'story.own', element: <ContributeRoute /> },
  // Usage is reachable with `sessions.own`; it filters cost/the Everyone scope internally via
  // `budgets.manage` (02-app-shell §13.4) — that finer gating stays in the screen, not here.
  { path: 'usage', capability: 'sessions.own', element: <Usage /> },
];

/** The main app (rendered once the vault is ready): router + sidebar layout. */
export function Shell(): JSX.Element {
  useEffect(() => {
    void useSettingsStore.getState().load();
    void useNavStore.getState().load();
  }, []);

  return (
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Home />} />
          {GUARDED_ROUTES.map(({ path, capability, element }) => (
            <Route
              key={path}
              path={path}
              element={<RequireCapability capability={capability}>{element}</RequireCapability>}
            />
          ))}
          {/* The sharing surface moved to its own "Sharing & relationships" page (57 §3.8); keep the old
              in-Memory path working for any lingering link. */}
          <Route path="memory/sharing" element={<Navigate to="/sharing" replace />} />
          <Route path="settings" element={<SettingsScreen />} />
          {/* Any unknown hash (a typo, or a route the user can't reach) lands on Home rather than a
              blank content area. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

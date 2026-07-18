import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';
import { Home } from './routes/home/Home';
import { Gallery } from './routes/Gallery';
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
import { Story } from './routes/story/Story';
import { SettingsScreen } from '../settings/SettingsScreen';
import { RequireCapability } from './RequireCapability';
import { useSettingsStore } from '../settings/settingsStore';
import { useNavStore } from '../stores/navStore';
import { useSessionStore } from '../stores/sessionStore';
import type { CapabilityKey } from '@shared/capabilities';

/**
 * Capability-gated routes: each is guarded by the SAME capability as its sidebar nav link
 * (AppShell.tsx), so a person who lacks it can never reach the screen — whether by switching the active
 * person while sitting on it or by typing a `#/…` hash. `/` (Home) and `/settings` are intentionally
 * absent (always reachable; Settings filters its own admin-only sections). `/gallery` is guarded
 * separately below (dev + Owner — the route is omitted entirely otherwise). The map is verified against
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
  { path: 'sharing', capability: 'memory.own', element: <SharingAndRelationships /> },
  { path: 'dreams', capability: 'dreams.own', element: <Dreams /> },
  { path: 'dreams/patterns', capability: 'dreams.own', element: <DreamPatterns /> },
  { path: 'you', capability: 'tests.own', element: <You /> },
  { path: 'you/:testId/take', capability: 'tests.own', element: <TestTake /> },
  { path: 'you/:testId', capability: 'tests.own', element: <TestResultScreen /> },
  { path: 'people', capability: 'people.manage', element: <People /> },
  { path: 'roles', capability: 'roles.manage', element: <Roles /> },
  // Together (58 §5.3): gated by `together.own`; the finer live-partner-edge gating is enforced in the
  // screen + the bridge (the surface self-hides without a partner, and a direct route shows a calm state).
  { path: 'together', capability: 'together.own', element: <Together /> },
  { path: 'together/session/:id', capability: 'together.own', element: <TogetherSession /> },
  // A splat so the Studio's tabs deep-link (`/story/photos`, …) without remounting on tab change (64 §13.2).
  { path: 'story/*', capability: 'story.own', element: <Story /> },
  // Usage is reachable with `sessions.own`; it filters cost/the Everyone scope internally via
  // `budgets.manage` (02-app-shell §13.4) — that finer gating stays in the screen, not here.
  { path: 'usage', capability: 'sessions.own', element: <Usage /> },
];

/** The main app (rendered once the vault is ready): router + sidebar layout. */
export function Shell(): JSX.Element {
  // The dev-only design gallery is owner-only (the route is omitted entirely otherwise, so even a typed
  // URL can't reach it).
  const isOwner = useSessionStore((s) => s.isOwner());
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
          {import.meta.env.DEV && isOwner ? <Route path="gallery" element={<Gallery />} /> : null}
          {/* Any unknown hash (a typo, or a route the user can't reach — e.g. a non-owner typing
              #/gallery) lands on Home rather than a blank content area. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

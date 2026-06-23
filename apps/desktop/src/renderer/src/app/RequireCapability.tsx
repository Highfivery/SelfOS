import { Navigate } from 'react-router-dom';
import type { CapabilityKey } from '@shared/capabilities';
import { useSessionStore } from '../stores/sessionStore';

/**
 * Route guard: render the protected screen only if the active person's role grants `capability`;
 * otherwise silently redirect to Home (02-app-shell §3.4, 04-people-roles §4.3). This is defense in
 * depth alongside the nav-link gating — a capability-gated route must be unreachable however the user
 * got there (a person switch while sitting on the route, OR a typed `#/…` hash), not just hidden from
 * the sidebar.
 *
 * `can` is read through the reactive `useSessionStore` selector, so when the active person changes
 * (the switcher reloads `access`/`activePerson`) this re-renders and the redirect fires. The redirect
 * uses `replace` so the disallowed hash never lingers in history.
 */
export function RequireCapability({
  capability,
  children,
}: {
  capability: CapabilityKey;
  children: JSX.Element;
}): JSX.Element {
  const allowed = useSessionStore((s) => s.can(capability));
  if (!allowed) return <Navigate to="/" replace />;
  return children;
}

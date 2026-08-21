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
  /**
   * The gate. `'owner'` guards on the ROLE rather than a grantable capability — for a screen whose
   * justification is the Owner's existing full access (76 §8.1), where a capability would be one
   * Roles-matrix toggle away from anyone.
   */
  capability: CapabilityKey | 'owner';
  children: JSX.Element;
}): JSX.Element {
  const allowed = useSessionStore((s) =>
    capability === 'owner' ? s.isOwner() : s.can(capability),
  );
  if (!allowed) return <Navigate to="/" replace />;
  return children;
}

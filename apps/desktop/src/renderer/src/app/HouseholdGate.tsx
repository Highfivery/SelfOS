import { useEffect } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { Splash } from './boot/Splash';
import { Setup } from './boot/Setup';
import { Shell } from './Shell';

/**
 * Sits between boot-ready and the app: if the household isn't set up (no master key / no owner),
 * show the setup wizard; otherwise render the app (04-people-roles §3.1).
 */
export function HouseholdGate(): JSX.Element {
  const loaded = useSessionStore((s) => s.loaded);
  const status = useSessionStore((s) => s.status);
  const load = useSessionStore((s) => s.load);

  useEffect(() => {
    void load();
  }, [load]);

  if (!loaded || !status) return <Splash />;
  if (!status.hasMasterKey || !status.hasOwner) return <Setup />;
  return <Shell />;
}

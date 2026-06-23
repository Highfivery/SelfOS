import { useEffect } from 'react';
import { useSetting } from '../../settings/useSetting';
import { useUpdateStore } from '../../stores/updateStore';

/** Six hours between automatic update checks (36-update-awareness §11) — far under the unauth GitHub limit. */
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

/**
 * Drives the update-check cadence (36-update-awareness §3.1/§11): a non-blocking check on launch, then every
 * 6 hours while open, plus on window focus/resume — all gated by the "Check for updates automatically"
 * toggle. The manual Settings button (forced) is separate. Timers + listeners are cleared on unmount (the
 * renderer is torn down on quit), and the store throttles focus-driven checks so they can't spam GitHub.
 */
export function useUpdateChecks(): void {
  const [autoCheck] = useSetting('updates.autoCheck');
  const check = useUpdateStore((s) => s.check);
  const loadCached = useUpdateStore((s) => s.loadCached);

  // Surface the last-known result immediately (so the About panel + notification reflect a prior check).
  useEffect(() => {
    void loadCached();
  }, [loadCached]);

  useEffect(() => {
    if (autoCheck === false) return undefined; // auto checks disabled (default is on)

    void check(false); // launch check (throttled/de-duped in the store)
    const interval = window.setInterval(() => void check(false), SIX_HOURS_MS);
    const onFocus = (): void => void check(false);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void check(false);
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [autoCheck, check]);
}

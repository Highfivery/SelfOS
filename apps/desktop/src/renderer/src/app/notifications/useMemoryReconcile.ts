import { useEffect, useRef } from 'react';
import { useSetting } from '../../settings/useSetting';
import { useInsightStore } from '../../stores/insightStore';
import { useSessionStore } from '../../stores/sessionStore';

/** In-memory throttle so focus events can't spam the auto-reconcile attempt (the real gate is in the bridge). */
const FOCUS_THROTTLE_MS = 30 * 60 * 1000;

/**
 * Drives the automatic memory-reconcile cadence (39-living-memory §3.3 — mirrors spec 36's update-check hook):
 * a non-blocking attempt on launch + on window focus/resume, gated by the "Keep memory tidy automatically"
 * setting. The bridge owns the real decision (threshold/gap/throttle/budget) and returns a calm SKIPPED no-op
 * when not warranted, so this hook just nudges it; the in-memory throttle keeps focus events cheap. Re-armed
 * when the active person changes (the per-person cadence). Manual Refresh is separate (always forces).
 */
export function useMemoryReconcile(): void {
  const [autoReconcile] = useSetting('memory.autoReconcile');
  const run = useInsightStore((s) => s.autoReconcile);
  const activePersonId = useSessionStore((s) => s.activePerson?.id ?? null);
  const lastAttempt = useRef(0);

  useEffect(() => {
    if (autoReconcile === false || !activePersonId) return undefined;

    const attempt = (): void => {
      const now = Date.now();
      if (now - lastAttempt.current < FOCUS_THROTTLE_MS) return;
      lastAttempt.current = now;
      void run();
    };

    attempt(); // launch / person-change
    const onFocus = (): void => attempt();
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') attempt();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [autoReconcile, activePersonId, run]);
}

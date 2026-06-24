import { useEffect, useRef } from 'react';
import { useSynthesisStore } from '../../stores/synthesisStore';
import { useSessionStore } from '../../stores/sessionStore';

/** In-memory throttle so focus events can't spam the auto-synthesis attempt (the real gate is in the bridge). */
const FOCUS_THROTTLE_MS = 30 * 60 * 1000;

/**
 * Drives the automatic cross-feature synthesis cadence (40-proactive-coaching §3.4 — mirrors the memory-
 * reconcile + update-check hooks): a non-blocking attempt on launch + on window focus/resume. The BRIDGE owns
 * the real decision (proactivity off → skip; the weekly throttle + new-insight delta + budget), returning a
 * calm non-`ok` no-op when not warranted, so this hook just nudges it; the in-memory throttle keeps focus
 * events cheap. Re-armed on the active-person change (per-person cadence). The manual run is separate (forces).
 */
export function useCoachingSynthesis(): void {
  const run = useSynthesisStore((s) => s.run);
  const activePersonId = useSessionStore((s) => s.activePerson?.id ?? null);
  const lastAttempt = useRef(0);

  useEffect(() => {
    if (!activePersonId) return undefined;

    const attempt = (): void => {
      const now = Date.now();
      if (now - lastAttempt.current < FOCUS_THROTTLE_MS) return;
      lastAttempt.current = now;
      void run({ auto: true });
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
  }, [activePersonId, run]);
}

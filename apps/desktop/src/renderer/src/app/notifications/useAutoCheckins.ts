import { useEffect, useRef } from 'react';
import { useAutoCheckinStore } from '../../stores/autoCheckinStore';
import { useSessionStore } from '../../stores/sessionStore';

/** In-memory throttle so focus events can't spam the run attempt (the real 24h gate is in the bridge). */
const FOCUS_THROTTLE_MS = 30 * 60 * 1000;

/**
 * Drives the Auto check-ins cadence (63-auto-checkins §3.4 — mirrors the coaching/memory/update-check hooks):
 * a non-blocking attempt on launch + on window focus/resume. Each attempt first runs the write-once
 * onboarding-completion seed backfill (§5.1) — so a person who finished onboarding is switched on by default —
 * then nudges the auto run. The BRIDGE owns the real decision (24h throttle, crisis, budget, AI-off), returning
 * a calm no-op when not warranted, so this hook just nudges it. Re-armed on the active-person change (per-person
 * cadence). The manual "Run now" in the panel is separate (forces).
 */
export function useAutoCheckins(): void {
  const ensureSeed = useAutoCheckinStore((s) => s.ensureSeed);
  const load = useAutoCheckinStore((s) => s.load);
  const run = useAutoCheckinStore((s) => s.run);
  const activePersonId = useSessionStore((s) => s.activePerson?.id ?? null);
  const lastAttempt = useRef(0);

  useEffect(() => {
    if (!activePersonId) return undefined;

    const attempt = async (): Promise<void> => {
      const now = Date.now();
      if (now - lastAttempt.current < FOCUS_THROTTLE_MS) return;
      lastAttempt.current = now;
      const seeded = await ensureSeed();
      if (seeded) await load(); // reflect the seeded default-on config in the panel
      await run({ auto: true });
    };

    void attempt(); // launch / person-change
    const onFocus = (): void => void attempt();
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void attempt();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [activePersonId, ensureSeed, load, run]);
}

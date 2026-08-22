import { useEffect, useRef } from 'react';
import { useSessionStore } from '../../stores/sessionStore';

/** In-memory throttle so focus events can't spam the reconcile (the real 24h gate is in the bridge). */
const FOCUS_THROTTLE_MS = 30 * 60 * 1000;

/**
 * The no-backend email cadence (67 §3.4 / Phase 3 — the `useAutoCheckins` template): a non-blocking
 * `email:scheduleReconcile({ auto: true })` on launch + on window focus/resume. The BRIDGE owns the real
 * warranted, so this hook just nudges it. Each run polls Resend delivery status + reconciles the scheduled
 * families (digest / re-engagement via `scheduledAt`/cancel) + cancels answered questionnaire reminders.
 * Re-armed on the active-person change (per-person cadence). Gated on the person holding `email.own`.
 */
export function useEmailScheduler(): void {
  const activePersonId = useSessionStore((s) => s.activePerson?.id ?? null);
  const canEmail = useSessionStore((s) => s.can('email.own'));
  const lastAttempt = useRef(0);

  useEffect(() => {
    if (!activePersonId || !canEmail) return undefined;

    const attempt = async (): Promise<void> => {
      const now = Date.now();
      if (now - lastAttempt.current < FOCUS_THROTTLE_MS) return;
      lastAttempt.current = now;
      await window.selfos?.emailScheduleReconcile({ auto: true });
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
  }, [activePersonId, canEmail]);
}

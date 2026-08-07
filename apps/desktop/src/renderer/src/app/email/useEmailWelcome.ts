import { useEffect } from 'react';
import { useSessionStore } from '../../stores/sessionStore';

/**
 * The welcome-email cadence (67 §3.2 / Phase 0) — on app open, once per person, send the family-G welcome
 * when: email is connected + the person set their engagement address + welcome is on + not paused. The
 * bridge is idempotent ("sent once" — it checks the activity log), so a re-open never re-sends. This is the
 * "first run / a new person joins" trigger; every gate + the send + the log live behind the bridge.
 */
export function useEmailWelcome(): void {
  const activePersonId = useSessionStore((s) => s.activePerson?.id ?? null);
  const canEmail = useSessionStore((s) => s.can('email.own'));

  useEffect(() => {
    if (!activePersonId || !canEmail) return;
    let cancelled = false;
    void (async () => {
      const status = await window.selfos?.emailStatus();
      if (cancelled || !status?.resolvedReady) return;
      const prefs = await window.selfos?.emailGetPrefs();
      if (cancelled || !prefs?.address || prefs.paused) return;
      if ((prefs.families?.welcome ?? true) === false) return;
      // The bridge no-ops if a welcome was already sent; safe to call on every open.
      await window.selfos?.emailSend({ family: 'welcome' });
    })();
    return () => {
      cancelled = true;
    };
  }, [activePersonId, canEmail]);
}

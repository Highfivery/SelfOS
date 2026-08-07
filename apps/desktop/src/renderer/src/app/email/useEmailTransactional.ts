import { useEffect, useRef } from 'react';
import { isEmailableTransactionalKind } from '@shared/schemas';
import { useSessionStore } from '../../stores/sessionStore';
import { useNotificationStore } from '../../stores/notificationStore';

/**
 * The transactional-email cadence (67 §3.2 / Phase 2, family B). Email is a channel alongside the in-app
 * notification center (35), so this watches the SAME derived notification candidates and, for each emailable
 * kind (a genuinely time-sensitive / reaches-another-person alert), sends one teaser email to the active
 * person's engagement address — "immediate when the app is open" (§3.4).
 *
 * De-dup is by `sourceKey = coalesceKey#signature` (the resolved-notification id): the bridge is idempotent
 * on it (checks the activity log), so a re-open never re-sends, while a changed signature — a genuinely new
 * event — is a new key and sends again. A per-session `attempted` set avoids redundant idempotent IPC calls
 * within one run; the vault activity log is the durable source of truth (and a prior FAILED send retries next
 * session). Every gate (config + the engagement address + the `transactional` opt-in + pause) lives behind
 * the bridge; the pre-check here just avoids pointless calls when email isn't set up.
 */
export function useEmailTransactional(): void {
  const activePersonId = useSessionStore((s) => s.activePerson?.id ?? null);
  const canEmail = useSessionStore((s) => s.can('email.own'));
  const candidates = useNotificationStore((s) => s.candidates);
  const attempted = useRef<Set<string>>(new Set());

  // A per-session guard, reset on a person switch (the per-person-isolation rule).
  useEffect(() => {
    attempted.current = new Set();
  }, [activePersonId]);

  useEffect(() => {
    if (!activePersonId || !canEmail) return;
    const fresh = candidates
      .filter((c) => isEmailableTransactionalKind(c.kind))
      .map((c) => ({ candidate: c, sourceKey: `${c.coalesceKey}#${c.signature}` }))
      .filter(({ sourceKey }) => !attempted.current.has(sourceKey));
    if (fresh.length === 0) return;

    let cancelled = false;
    // The active person must still be the one this effect ran for after every await — the `sessionStore` id
    // and the `notificationStore` candidates reset independently on a switch, so re-check before sending so
    // one person's alert can never reach another's inbox (the `useNotificationSources` guard, structural
    // rather than relying on effect ordering + IPC latency).
    const stillActive = (): boolean =>
      !cancelled && useSessionStore.getState().activePerson?.id === activePersonId;
    void (async () => {
      const status = await window.selfos?.emailStatus();
      if (!stillActive() || !status?.resolvedReady) return;
      const prefs = await window.selfos?.emailGetPrefs();
      if (!stillActive() || !prefs?.address || prefs.paused) return;
      if ((prefs.families?.transactional ?? true) === false) return;
      for (const { candidate, sourceKey } of fresh) {
        if (!stillActive()) return;
        // Mark before awaiting so a concurrent recompute never double-fires the same alert.
        attempted.current.add(sourceKey);
        try {
          await window.selfos?.emailSendTransactional({
            kind: candidate.kind,
            sourceKey,
            // Clamp to the bridge caps (a questionnaire/session title has no length cap) so a long title
            // never trips the schema — and a throw on one candidate never aborts the rest of the batch.
            title: candidate.title.slice(0, 200),
            ...(candidate.body ? { body: candidate.body.slice(0, 400) } : {}),
          });
        } catch {
          // Best-effort — a transactional email is a nudge; the vault activity log is the source of truth,
          // and a prior failure retries next session.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activePersonId, canEmail, candidates]);
}

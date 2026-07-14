import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pin } from 'lucide-react';
import { Button, Inline, Stack, Text } from '../../../design-system/components';
import { useSessionStore } from '../../../stores/sessionStore';
import { appendTogetherChunk, useTogetherStore } from '../../../stores/togetherStore';
import { InvitationCeremony } from './InvitationCeremony';
import { PrepPanel } from './PrepPanel';
import { TogetherThread } from './TogetherThread';
import { TogetherReflection } from './TogetherReflection';
import { TogetherSuggestions } from './TogetherSuggestions';
import { canWithdraw } from './TogetherSessionCard';
import { WithdrawInviteButton } from './WithdrawInviteButton';
import { useSetting } from '../../../settings/useSetting';
import { aiKeyResolved } from '../../aiAvailability';
import styles from './Together.module.css';

/**
 * A Together session route (58 §3.4/§3.6). Resolves the view: an un-accepted invitation shows the consent
 * ceremony → the thread. Subscribes to the couples-turn stream + the vault watcher for near-live refresh.
 */
export function TogetherSession(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const myId = useSessionStore((s) => s.activePerson?.id ?? null);
  const open = useTogetherStore((s) => s.open);
  const reportView = useTogetherStore((s) => s.reportView);
  const openSession = useTogetherStore((s) => s.openSession);
  const accept = useTogetherStore((s) => s.accept);
  const withdraw = useTogetherStore((s) => s.withdraw);
  const refresh = useTogetherStore((s) => s.refresh);
  const [prepOpen, setPrepOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [aiEnabled] = useSetting('ai.enabled');
  const [memoryEnabled] = useSetting('sessions.memoryEnabled');
  const [hasKey, setHasKey] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reflectionRef = useRef<HTMLElement | null>(null);

  const jumpToReflection = (): void => {
    const el = reflectionRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.focus({ preventScroll: true });
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void aiKeyResolved('anthropic').then((ok) => {
      if (alive) setHasKey(ok);
    });
    void openSession(id ?? '').finally(() => {
      if (alive) setLoading(false);
    });
    if (id) void useTogetherStore.getState().loadReport(id);
    return () => {
      alive = false;
      useTogetherStore.getState().closeSession();
    };
  }, [id, openSession]);

  // Stream the coach reply into the live bubble; refresh on a synced partner message (§3.6).
  useEffect(() => {
    const offChunk = window.selfos?.onTogetherChunk((delta) => appendTogetherChunk(delta));
    const offVault = window.selfos?.onVaultChanged(() => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void refresh(), 400);
    });
    return () => {
      if (timer.current) clearTimeout(timer.current);
      offChunk?.();
      offVault?.();
    };
  }, [refresh]);

  const back = (
    <Inline gap={1} align="center">
      <Button variant="secondary" onClick={() => navigate('/together')}>
        <ArrowLeft size={14} aria-hidden="true" /> Together
      </Button>
    </Inline>
  );

  if (loading) {
    return (
      <div className={styles.page}>
        <Stack gap={2}>
          {back}
          <Text tone="secondary">Loading…</Text>
        </Stack>
      </div>
    );
  }

  if (!open) {
    return (
      <div className={styles.page}>
        <Stack gap={2}>
          {back}
          <Text tone="secondary">This session isn’t available right now.</Text>
        </Stack>
      </div>
    );
  }

  // An un-accepted invitation (the viewer hasn't acked) → the consent ceremony, then acceptance. The
  // initiator is already acked (starting is consenting), so they skip straight in.
  const needsCeremony = !open.viewerAcked && open.status === 'invited';

  if (needsCeremony) {
    return (
      <div className={styles.page}>
        <Stack gap={2}>
          {back}
          <InvitationCeremony
            session={open}
            onContinue={() => void accept(open.id)}
            onNotNow={() => navigate('/together')}
          />
        </Stack>
      </div>
    );
  }

  // An expired/ended/declined session that reached here — a calm terminal note.
  if (open.status === 'expired' || open.status === 'ended') {
    return (
      <div className={styles.page}>
        <Stack gap={2}>
          {back}
          <Text tone="secondary">
            {open.status === 'ended'
              ? 'This session has ended.'
              : 'This invitation expired. Start a fresh session any time.'}
          </Text>
          {canWithdraw(open, myId) ? (
            <WithdrawInviteButton
              onWithdraw={async () => {
                const ok = await withdraw(open.id);
                if (ok) navigate('/together');
                return ok;
              }}
            />
          ) : null}
        </Stack>
      </div>
    );
  }

  const other = open.participants.find((p) => p.personId !== myId);

  // The private prep space (§3.7) — reached from the thread's "Prep privately"; it's the person's OWN thread.
  if (prepOpen) {
    return (
      <div className={styles.page}>
        <PrepPanel sessionId={open.id} onBack={() => setPrepOpen(false)} />
      </div>
    );
  }

  const memReady = memoryEnabled !== false;
  const aiReady = aiEnabled === true && hasKey;
  const activeAgreements = reportView.agreements.filter((a) => a.status !== 'retired');
  const report = reportView.report;
  const hasReport = report !== null;
  // The top summary strip mirrors the reflection panel's visibility (spec 61 §3.3) so it never points at a
  // section that isn't there.
  const showStrip = hasReport || activeAgreements.length > 0 || (memReady && aiReady);
  // Label the jump by intent: a report → "Jump to reflection"; agreements-only → "View" them; else "Wrap up".
  const stripJumpLabel = hasReport
    ? 'Jump to reflection'
    : activeAgreements.length > 0
      ? 'View'
      : 'Wrap up';

  return (
    <div className={styles.page}>
      <div className={styles.sessionTop}>
        {back}
        <Text size="sm" tone="secondary">
          You &amp; {other?.displayName ?? 'your partner'}
        </Text>
        {canWithdraw(open, myId) ? (
          <span className={styles.sessionTopAction}>
            <WithdrawInviteButton
              size="sm"
              onWithdraw={async () => {
                const ok = await withdraw(open.id);
                if (ok) navigate('/together');
                return ok;
              }}
            />
          </span>
        ) : null}
      </div>

      {showStrip ? (
        <div className={styles.reflectionStrip}>
          <Pin size={14} aria-hidden="true" />
          <Text size="sm" className={styles.reflectionStripText}>
            {activeAgreements.length > 0
              ? activeAgreements.length === 1
                ? '1 agreement'
                : `${activeAgreements.length} agreements`
              : hasReport
                ? 'Your reflection'
                : 'Ready to wrap up & reflect'}
            {report && activeAgreements.length > 0
              ? ` · reflection from ${relativeDay(report.createdAt)}`
              : ''}
          </Text>
          <button type="button" className={styles.reflectionStripJump} onClick={jumpToReflection}>
            {stripJumpLabel}
          </button>
        </div>
      ) : null}

      <TogetherThread session={open} onPrep={() => setPrepOpen(true)} />
      {other ? <TogetherSuggestions sessionId={open.id} partnerId={other.personId} /> : null}
      <TogetherReflection
        sessionId={open.id}
        memoryEnabled={memReady}
        aiReady={aiReady}
        sectionRef={reflectionRef}
      />
    </div>
  );
}

/** A gentle "3 days ago" / "today" / "yesterday" relative-day label for the reflection strip. */
function relativeDay(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return 'recently';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

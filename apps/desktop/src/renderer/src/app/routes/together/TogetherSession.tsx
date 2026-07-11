import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button, Inline, Stack, Text } from '../../../design-system/components';
import { useSessionStore } from '../../../stores/sessionStore';
import { appendTogetherChunk, useTogetherStore } from '../../../stores/togetherStore';
import { InvitationCeremony } from './InvitationCeremony';
import { PreScreenForm } from './PreScreenForm';
import { PrepPanel } from './PrepPanel';
import { TogetherThread } from './TogetherThread';
import { TogetherReflection } from './TogetherReflection';
import { TogetherSuggestions } from './TogetherSuggestions';
import { useSetting } from '../../../settings/useSetting';
import { aiKeyResolved } from '../../aiAvailability';
import styles from './Together.module.css';

/**
 * A Together session route (58 §3.4/§3.6). Resolves the view: an un-accepted invitation shows the consent
 * ceremony → (first time) the private pre-screen → the thread. Subscribes to the couples-turn stream + the
 * vault watcher for near-live refresh.
 */
export function TogetherSession(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const myId = useSessionStore((s) => s.activePerson?.id ?? null);
  const open = useTogetherStore((s) => s.open);
  const prescreen = useTogetherStore((s) => s.prescreen);
  const openSession = useTogetherStore((s) => s.openSession);
  const accept = useTogetherStore((s) => s.accept);
  const refresh = useTogetherStore((s) => s.refresh);
  const [showPrescreen, setShowPrescreen] = useState(false);
  const [prepOpen, setPrepOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [aiEnabled] = useSetting('ai.enabled');
  const [memoryEnabled] = useSetting('sessions.memoryEnabled');
  const [hasKey, setHasKey] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void useTogetherStore.getState().loadPrescreen();
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

  // An un-accepted invitation (the viewer hasn't acked) → the consent ceremony, then the pre-screen (first
  // time), then acceptance. The initiator is already acked (starting is consenting), so they skip straight in.
  const needsCeremony = !open.viewerAcked && open.status === 'invited';

  const continueFromCeremony = (): void => {
    if (prescreen?.needsScreen) setShowPrescreen(true);
    else void accept(open.id);
  };

  if (needsCeremony) {
    if (showPrescreen && prescreen?.needsScreen) {
      return (
        <div className={styles.page}>
          <Stack gap={2}>
            {back}
            <PreScreenForm onCleared={() => void accept(open.id)} />
          </Stack>
        </div>
      );
    }
    return (
      <div className={styles.page}>
        <Stack gap={2}>
          {back}
          <InvitationCeremony
            session={open}
            onContinue={continueFromCeremony}
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

  return (
    <div className={styles.page}>
      <div className={styles.sessionTop}>
        {back}
        <Text size="sm" tone="secondary">
          You &amp; {other?.displayName ?? 'your partner'}
        </Text>
      </div>
      <TogetherThread session={open} onPrep={() => setPrepOpen(true)} />
      {other ? <TogetherSuggestions sessionId={open.id} partnerId={other.personId} /> : null}
      <TogetherReflection
        sessionId={open.id}
        memoryEnabled={memoryEnabled !== false}
        aiReady={aiEnabled === true && hasKey}
      />
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Heart } from 'lucide-react';
import type { TogetherSessionSummary } from '@shared/schemas';
import {
  Banner,
  Button,
  Card,
  Heading,
  Inline,
  Select,
  Stack,
  Text,
  TextInput,
} from '../../../design-system/components';
import { CrisisFooter } from '../sessions/CrisisFooter';
import { useSessionStore } from '../../../stores/sessionStore';
import { useTogetherStore } from '../../../stores/togetherStore';
import { PreScreenForm } from './PreScreenForm';
import { TOGETHER_FRAME_LINE } from './roomRules';
import styles from './Together.module.css';

const STATUS_LABELS: Record<string, string> = {
  invited: 'Invited',
  expired: 'Invitation expired',
  active: 'Active',
  onHold: 'Paused',
  ended: 'Ended',
  complete: 'Completed',
  declined: '',
};

function statusLabel(session: TogetherSessionSummary, myId: string | null): string {
  if (session.status === 'active') {
    return session.yourTurn ? 'Your turn' : 'Waiting for you both';
  }
  if (session.status === 'invited' && session.initiatorPersonId === myId)
    return 'Invited · waiting';
  return STATUS_LABELS[session.status] ?? '';
}

function SessionCard({
  session,
  myId,
  onOpen,
}: {
  session: TogetherSessionSummary;
  myId: string | null;
  onOpen: () => void;
}): JSX.Element {
  const other = session.participants.find((p) => p.personId !== myId);
  return (
    <button type="button" className={styles.sessionCard} onClick={onOpen}>
      <Stack gap={1}>
        <Inline gap={2} align="center" justify="between">
          <Text weight={600} className={styles.cardTitle}>
            {session.topic ?? `With ${other?.displayName ?? 'your partner'}`}
          </Text>
          <span className={styles.statusPill} data-status={session.status}>
            {statusLabel(session, myId)}
          </span>
        </Inline>
        <Text size="sm" tone="secondary">
          You &amp; {other?.displayName ?? 'your partner'}
        </Text>
        {session.lastMessageSnippet ? (
          <Text size="sm" tone="secondary" className={styles.cardSnippet}>
            {session.lastMessageSnippet}
          </Text>
        ) : null}
      </Stack>
    </button>
  );
}

function StartCard(): JSX.Element {
  const navigate = useNavigate();
  const partners = useTogetherStore((s) => s.partners);
  const create = useTogetherStore((s) => s.create);
  const eligible = partners.filter((p) => p.eligible);
  const firstEligible = eligible[0]?.personId ?? '';
  const [partnerId, setPartnerId] = useState(firstEligible);
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = partnerId || firstEligible;
  const canSend = Boolean(chosen) && !busy;

  const onSend = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await create(chosen, topic);
      if (result.ok) navigate(`/together/session/${result.session.id}`);
      else setError(result.message);
    } finally {
      setBusy(false);
    }
  };

  const ineligible = partners.filter((p) => !p.eligible);

  return (
    <Card>
      <Stack gap={2}>
        <Heading level={2}>Start a session</Heading>
        {eligible.length > 1 ? (
          <label className={styles.field}>
            <Text size="sm" weight={600}>
              With
            </Text>
            <Select value={chosen} onChange={(e) => setPartnerId(e.target.value)}>
              {eligible.map((p) => (
                <option key={p.personId} value={p.personId}>
                  {p.displayName}
                </option>
              ))}
            </Select>
          </label>
        ) : eligible.length === 1 ? (
          <Text tone="secondary">With {eligible[0]?.displayName}</Text>
        ) : null}
        <label className={styles.field}>
          <Text size="sm" weight={600}>
            What’s on your mind?{' '}
            <Text as="span" tone="secondary">
              (optional)
            </Text>
          </Text>
          <TextInput
            value={topic}
            placeholder="e.g. Feeling disconnected lately"
            onChange={(e) => setTopic(e.target.value)}
          />
        </label>
        {error ? <Banner tone="danger">{error}</Banner> : null}
        {ineligible.length > 0 ? (
          <Text size="xs" tone="secondary">
            {ineligible.map((p) => p.displayName).join(', ')} needs a SelfOS login in this household
            to join — make them a subject in People.
          </Text>
        ) : null}
        <Button onClick={() => void onSend()} disabled={!canSend} aria-busy={busy}>
          {busy ? 'Sending…' : 'Send invitation'}
        </Button>
      </Stack>
    </Card>
  );
}

/** Together home (58 §3.2): the frame line, the start flow, and the sessions list. */
export function Together(): JSX.Element {
  const navigate = useNavigate();
  const myId = useSessionStore((s) => s.activePerson?.id ?? null);
  const loaded = useTogetherStore((s) => s.loaded);
  const hasPartner = useTogetherStore((s) => s.hasPartner);
  const sessions = useTogetherStore((s) => s.sessions);
  const prescreen = useTogetherStore((s) => s.prescreen);
  const refresh = useTogetherStore((s) => s.refresh);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void useTogetherStore.getState().load();
    void useTogetherStore.getState().loadPrescreen();
  }, [myId]);

  // Near-live refresh (58 §3.6): a synced partner change re-fetches the list (debounced), the first data
  // consumer of the vault watcher. Nav/focus loads still work with the watcher absent (§7).
  useEffect(() => {
    const unsubscribe = window.selfos?.onVaultChanged(() => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void refresh(), 400);
    });
    return () => {
      if (timer.current) clearTimeout(timer.current);
      unsubscribe?.();
    };
  }, [refresh]);

  if (loaded && !hasPartner) {
    return (
      <div className={styles.page}>
        <Stack gap={2}>
          <Heading level={1}>Together</Heading>
          <Text tone="secondary">{TOGETHER_FRAME_LINE}</Text>
          <Card>
            <Stack gap={1}>
              <Inline gap={2} align="center">
                <Heart size={18} aria-hidden="true" />
                <Text weight={600}>Together is for you and a partner</Text>
              </Inline>
              <Text tone="secondary">
                Once you’re connected with a partner in this household, you can start a shared,
                coached conversation here.
              </Text>
            </Stack>
          </Card>
        </Stack>
        <CrisisFooter />
      </div>
    );
  }

  const needsScreen = prescreen?.needsScreen === true;

  return (
    <div className={styles.page}>
      <Stack gap={3}>
        <Stack gap={1}>
          <Heading level={1}>Together</Heading>
          <Text tone="secondary">{TOGETHER_FRAME_LINE}</Text>
        </Stack>

        {needsScreen ? (
          <PreScreenForm onCleared={() => void useTogetherStore.getState().loadPrescreen()} />
        ) : (
          <StartCard />
        )}

        {sessions.length > 0 ? (
          <Stack gap={2}>
            <Heading level={2}>Your sessions</Heading>
            <div className={styles.sessionGrid}>
              {sessions.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  myId={myId}
                  onOpen={() => navigate(`/together/session/${session.id}`)}
                />
              ))}
            </div>
          </Stack>
        ) : null}
      </Stack>
      <CrisisFooter />
    </div>
  );
}

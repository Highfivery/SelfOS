import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Heart, Plus } from 'lucide-react';
import type { TogetherCatalogEntry } from '@shared/schemas';
import { Button, Heading, Inline, Select, Stack, Text } from '../../../design-system/components';
import { CrisisFooter } from '../sessions/CrisisFooter';
import { useSessionStore } from '../../../stores/sessionStore';
import { useTogetherStore } from '../../../stores/togetherStore';
import { TogetherStartDialog, type StartPending } from './TogetherStartDialog';
import { TogetherCatalog } from './TogetherCatalog';
import { TogetherIntimacy } from './TogetherIntimacy';
import { TogetherPulse } from './TogetherPulse';
import { TogetherJointChallenges } from './TogetherJointChallenges';
import { TogetherSessionsBoard } from './TogetherSessionsBoard';
import { TOGETHER_FRAME_LINE } from './roomRules';
import styles from './Together.module.css';

/** What the start dialog is about to create — a free session, a specific guided practice, or nothing open. */
type Pending = StartPending | null;

/** Together home (58 §3.2 redesign): a partner-scoped dashboard — check-in, sessions, guided practices,
 *  joint challenges, and the Desire & intimacy panel, in priority order. */
export function Together(): JSX.Element {
  const navigate = useNavigate();
  const myId = useSessionStore((s) => s.activePerson?.id ?? null);
  const loaded = useTogetherStore((s) => s.loaded);
  const hasPartner = useTogetherStore((s) => s.hasPartner);
  const sessions = useTogetherStore((s) => s.sessions);
  const catalog = useTogetherStore((s) => s.catalog);
  const partners = useTogetherStore((s) => s.partners);
  const create = useTogetherStore((s) => s.create);
  const withdraw = useTogetherStore((s) => s.withdraw);
  const refresh = useTogetherStore((s) => s.refresh);

  const eligiblePartners = useMemo(() => partners.filter((p) => p.eligible), [partners]);
  const ineligible = useMemo(() => partners.filter((p) => !p.eligible), [partners]);

  const [partnerId, setPartnerId] = useState<string>('');
  const [pending, setPending] = useState<Pending>(null);
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void useTogetherStore.getState().load();
    void useTogetherStore.getState().loadCatalog();
    setPending(null);
    setPartnerId('');
  }, [myId]);

  // Keep a valid selected partner as the eligible set resolves / changes.
  useEffect(() => {
    if (eligiblePartners.length === 0) {
      if (partnerId) setPartnerId('');
      return;
    }
    if (!eligiblePartners.some((p) => p.personId === partnerId)) {
      setPartnerId(eligiblePartners[0]!.personId);
    }
  }, [eligiblePartners, partnerId]);

  // Near-live refresh (58 §3.6): a synced partner change re-fetches the list (debounced).
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

  const selectedPartner = eligiblePartners.find((p) => p.personId === partnerId);
  const partnerName = selectedPartner?.displayName ?? 'your partner';

  const guideById = useMemo(() => new Map(catalog.map((e) => [e.id, e])), [catalog]);
  const nonAdultCatalog = useMemo(() => catalog.filter((e) => !e.adult), [catalog]);
  const adultPractices = useMemo(
    () => catalog.filter((e) => e.adult && e.id !== 'yes-no-maybe-together'),
    [catalog],
  );
  const mySessions = useMemo(
    () =>
      partnerId ? sessions.filter((s) => s.participants.some((p) => p.personId === partnerId)) : [],
    [sessions, partnerId],
  );

  const selectedGuideId = pending?.kind === 'guide' ? pending.entry.id : null;

  const pickGuide = (entry: TogetherCatalogEntry): void => {
    setError(null);
    setPending({ kind: 'guide', entry });
  };
  const openNew = (): void => {
    setError(null);
    setTopic('');
    setPending({ kind: 'free' });
  };
  const clearPending = (): void => {
    setPending(null);
    setError(null);
    setTopic('');
  };

  const send = async (): Promise<void> => {
    if (!selectedPartner || !pending) return;
    setBusy(true);
    setError(null);
    const guideId = pending.kind === 'guide' ? pending.entry.id : undefined;
    const t = pending.kind === 'free' ? topic.trim() || undefined : undefined;
    try {
      const result = await create(selectedPartner.personId, t, guideId);
      if (result.ok) navigate(`/together/session/${result.session.id}`);
      else setError(result.message);
    } finally {
      setBusy(false);
    }
  };

  // No partner at all — the connect-first empty state.
  if (loaded && !hasPartner) {
    return (
      <div className={styles.page}>
        <Header
          partnerName={null}
          eligiblePartners={[]}
          partnerId=""
          onPartner={setPartnerId}
          onNew={openNew}
          canStart={false}
        />
        <div className={styles.emptyCard}>
          <Inline gap={2} align="center">
            <Heart size={18} aria-hidden="true" />
            <Text weight={600}>Together is for you and a partner</Text>
          </Inline>
          <Text tone="secondary">
            Once you’re connected with a partner in this household, you can start a shared, coached
            conversation here.
          </Text>
        </div>
        <CrisisFooter />
      </div>
    );
  }

  const canStart = eligiblePartners.length > 0;

  return (
    <div className={styles.page}>
      <Header
        partnerName={canStart ? partnerName : null}
        eligiblePartners={eligiblePartners}
        partnerId={partnerId}
        onPartner={setPartnerId}
        onNew={openNew}
        canStart={canStart}
      />

      {ineligible.length > 0 ? (
        <div className={styles.emptyCard}>
          <Text weight={600}>{canStart ? 'One more to add' : 'Almost there'}</Text>
          <Text tone="secondary">
            {ineligible.map((p) => p.displayName).join(', ')}{' '}
            {ineligible.length === 1 ? 'needs' : 'need'} a SelfOS login in this household to join —
            make them a subject in People.
          </Text>
        </div>
      ) : null}

      {canStart ? (
        <>
          {/* The start flow is a centered modal (58 §3.3) — "New session" + every guided / Desire & intimacy
              practice card open it, so it never requires scrolling to an inline bar (issue #207). */}
          {pending ? (
            <TogetherStartDialog
              pending={pending}
              partnerName={partnerName}
              topic={topic}
              onTopicChange={setTopic}
              busy={busy}
              error={error}
              onSend={() => void send()}
              onClose={clearPending}
            />
          ) : null}

          {partnerId ? <TogetherPulse partnerId={partnerId} partnerName={partnerName} /> : null}

          {mySessions.length > 0 ? (
            <TogetherSessionsBoard
              sessions={mySessions}
              myId={myId}
              partnerName={partnerName}
              guideById={guideById}
              onOpen={(id) => navigate(`/together/session/${id}`)}
              onWithdraw={(id) => withdraw(id)}
            />
          ) : (
            <Stack gap={2}>
              <Heading level={2}>Your sessions</Heading>
              <div className={styles.emptyCard}>
                <Text weight={600}>No sessions yet</Text>
                <Text tone="secondary">
                  Start an open conversation, or pick a guided practice below to begin one together.
                </Text>
                <Button onClick={openNew}>
                  <Plus size={14} aria-hidden="true" /> New session
                </Button>
              </div>
            </Stack>
          )}

          {nonAdultCatalog.length > 0 ? (
            <TogetherCatalog
              catalog={nonAdultCatalog}
              selectedId={selectedGuideId}
              onPick={pickGuide}
            />
          ) : null}

          {partnerId ? (
            <TogetherJointChallenges partnerId={partnerId} partnerName={partnerName} />
          ) : null}

          {partnerId ? (
            <TogetherIntimacy
              partnerId={partnerId}
              partnerName={partnerName}
              adultPractices={adultPractices}
              selectedId={selectedGuideId}
              onPick={pickGuide}
            />
          ) : null}
        </>
      ) : null}

      <CrisisFooter />
    </div>
  );
}

/** The dashboard header — brand mark, title, the not-therapy frame line, a partner switcher, and New session. */
function Header({
  partnerName,
  eligiblePartners,
  partnerId,
  onPartner,
  onNew,
  canStart,
}: {
  partnerName: string | null;
  eligiblePartners: { personId: string; displayName: string }[];
  partnerId: string;
  onPartner: (id: string) => void;
  onNew: () => void;
  canStart: boolean;
}): JSX.Element {
  return (
    <div className={styles.hero}>
      <div className={styles.heroLeft}>
        <span className={styles.heroMark} aria-hidden="true">
          <Heart size={20} />
        </span>
        <div className={styles.heroText}>
          <Heading level={1}>Together</Heading>
          <div className={styles.heroSub}>
            {partnerName && eligiblePartners.length > 1 ? (
              <label className={styles.partnerSelect}>
                <Text size="sm" tone="secondary">
                  with
                </Text>
                <Select
                  aria-label="Choose a partner"
                  value={partnerId}
                  onChange={(e) => onPartner(e.target.value)}
                >
                  {eligiblePartners.map((p) => (
                    <option key={p.personId} value={p.personId}>
                      {p.displayName}
                    </option>
                  ))}
                </Select>
              </label>
            ) : partnerName ? (
              <Text size="sm" tone="secondary">
                with {partnerName}
              </Text>
            ) : null}
            <Text size="sm" tone="secondary">
              {TOGETHER_FRAME_LINE}
            </Text>
          </div>
        </div>
      </div>
      {canStart ? (
        <Button variant="secondary" onClick={onNew}>
          <Plus size={14} aria-hidden="true" /> New session
        </Button>
      ) : null}
    </div>
  );
}

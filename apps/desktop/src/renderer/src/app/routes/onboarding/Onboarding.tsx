import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Sparkles } from 'lucide-react';
import { Banner, Button, Card, Heading, Text } from '../../../design-system/components';
import { useIntakeStore } from '../../../stores/intakeStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { CrisisFooter } from '../sessions/CrisisFooter';
import { IntakeSectionPanel } from './IntakeSectionPanel';
import { ClosingPortrait } from './ClosingPortrait';
import styles from './Onboarding.module.css';

type SectionStatus = 'notStarted' | 'inProgress' | 'skipped' | 'complete';

/**
 * Personal onboarding — the "getting to know you" intake surface (18-personal-onboarding §3). An AI-guided,
 * resumable interview that auto-fills the (owner-only) profile and produces a member-facing portrait. AI is
 * required to run (§7); when it isn't ready a calm "connect AI" state shows (owner vs member copy). The
 * crisis footer + not-medical line are always present (§8.2).
 */
export function Onboarding(): JSX.Element {
  const navigate = useNavigate();
  const state = useIntakeStore((s) => s.state);
  const loaded = useIntakeStore((s) => s.loaded);
  const error = useIntakeStore((s) => s.error);
  const appendChunk = useIntakeStore((s) => s.appendChunk);
  const finishIntake = useIntakeStore((s) => s.finishIntake);
  const finalizing = useIntakeStore((s) => s.finalizing);
  const displayName = useSessionStore((s) => s.activePerson?.displayName ?? null);
  // "Owner" here = someone who can turn on AI (settings.manage); drives the AI-unavailable copy (§7).
  const canManageAi = useSessionStore((s) => s.can('settings.manage'));

  const [activeId, setActiveId] = useState<string | null>(null);
  const [revisiting, setRevisiting] = useState(false);

  useEffect(() => window.selfos?.onIntakeChunk(appendChunk), [appendChunk]);
  useEffect(() => {
    if (!loaded) void useIntakeStore.getState().load();
  }, [loaded]);

  const sections = state?.sections ?? [];
  const statusOf = useMemo(() => {
    const map = new Map<string, SectionStatus>();
    for (const s of state?.session.sections ?? []) map.set(s.id, s.status);
    return map;
  }, [state?.session.sections]);

  const pending = sections.filter(
    (m) => (statusOf.get(m.id) ?? 'notStarted') !== 'complete' && statusOf.get(m.id) !== 'skipped',
  );
  const allDone = pending.length === 0;
  const activeMeta = sections.find((m) => m.id === activeId) ?? pending[0] ?? null;

  const advance = (): void => {
    const fresh = useIntakeStore.getState().state;
    const next = fresh?.sections.find((m) => {
      const st = fresh.session.sections.find((s) => s.id === m.id)?.status ?? 'notStarted';
      return st !== 'complete' && st !== 'skipped';
    });
    setActiveId(next?.id ?? null);
  };

  if (!loaded || !state) return <div className={styles.onboarding} aria-busy="true" />;

  // AI is required to run the interview (§7). Show a calm "connect AI" state, never a dead-end.
  if (!state.aiAvailable) {
    return (
      <div className={styles.onboarding}>
        <header className={styles.header}>
          <Heading level={1}>Getting to know you</Heading>
        </header>
        <Card>
          <div className={styles.center}>
            <Lock size={22} aria-hidden="true" />
            <Heading level={2}>Connect AI to begin</Heading>
            {canManageAi ? (
              <>
                <Text tone="secondary">
                  Onboarding is a guided conversation, so it needs AI turned on. Add your Claude API
                  key and enable AI in Settings to start.
                </Text>
                <Button variant="primary" onClick={() => navigate('/settings')}>
                  Open Settings
                </Button>
              </>
            ) : (
              <Text tone="secondary">
                Onboarding is a guided conversation, so it needs AI turned on. Ask your household
                owner to enable AI, then come back here — nothing you’ve done is lost.
              </Text>
            )}
          </div>
        </Card>
        <CrisisFooter />
      </div>
    );
  }

  const complete = state.session.status === 'complete';

  return (
    <div className={styles.onboarding}>
      <header className={styles.header}>
        <Heading level={1}>
          <Sparkles size={20} aria-hidden="true" /> Getting to know you
          {displayName ? `, ${displayName}` : ''}
        </Heading>
        <Text tone="secondary">
          A warm, private conversation so SelfOS understands you. Everything is encrypted and yours,
          you can skip anything, and your most sensitive answers stay private to your own coaching.
        </Text>
      </header>

      {error ? <Banner tone="danger">{error}</Banner> : null}

      {complete && !revisiting ? (
        <ClosingPortrait
          session={state.session}
          sections={sections}
          onRevisit={() => {
            setRevisiting(true);
            setActiveId(null);
          }}
        />
      ) : (
        <>
          <div className={styles.progress} role="group" aria-label="Onboarding sections">
            {sections.map((m) => {
              const st = statusOf.get(m.id) ?? 'notStarted';
              const dotClass =
                st === 'complete'
                  ? `${styles.chipDot} ${styles.chipDotComplete}`
                  : st === 'skipped'
                    ? `${styles.chipDot} ${styles.chipDotSkipped}`
                    : styles.chipDot;
              return (
                <button
                  key={m.id}
                  type="button"
                  className={`${styles.chip} ${activeMeta?.id === m.id ? styles.chipActive : ''}`}
                  aria-current={activeMeta?.id === m.id ? 'true' : undefined}
                  onClick={() => setActiveId(m.id)}
                >
                  <span className={dotClass} aria-hidden="true" />
                  {m.title}
                  {m.restricted ? (
                    <Lock size={12} aria-hidden="true" className={styles.lock} />
                  ) : null}
                </button>
              );
            })}
          </div>

          {allDone ? (
            <Card>
              <div className={styles.center}>
                <Heading level={2}>That’s everything — thank you</Heading>
                <Text tone="secondary">
                  When you’re ready, I’ll bring it together into a portrait of what I’ve come to
                  understand about you.
                </Text>
                <Button
                  variant="primary"
                  disabled={finalizing}
                  onClick={() => {
                    void finishIntake().then((ok) => {
                      if (ok) setRevisiting(false);
                    });
                  }}
                >
                  <Sparkles size={16} aria-hidden="true" />
                  {finalizing ? 'Writing your portrait…' : 'See my portrait'}
                </Button>
              </div>
            </Card>
          ) : activeMeta ? (
            <IntakeSectionPanel
              meta={activeMeta}
              section={state.session.sections.find((s) => s.id === activeMeta.id)}
              adultAcknowledged={state.adultAcknowledged}
              onAdvance={advance}
            />
          ) : null}
        </>
      )}

      <CrisisFooter />
    </div>
  );
}

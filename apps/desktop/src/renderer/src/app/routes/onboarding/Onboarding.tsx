import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Lock, Sparkles } from 'lucide-react';
import type { IntakeSectionMeta } from '@shared/channels';
import { Banner, Button, Card, Heading, Text } from '../../../design-system/components';
import { useIntakeStore } from '../../../stores/intakeStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { CrisisFooter } from '../sessions/CrisisFooter';
import { IntakeSectionPanel } from './IntakeSectionPanel';
import { IntakeFormPanel } from './IntakeFormPanel';
import { ClosingPortrait } from './ClosingPortrait';
import styles from './Onboarding.module.css';

type SectionStatus = 'notStarted' | 'inProgress' | 'skipped' | 'complete';

/**
 * Personal onboarding — the "getting to know you" intake surface (18-personal-onboarding §3/§14). A hybrid of
 * quick structured **forms** and AI **chat**: a short gated `core` of forms produces a starter portrait that
 * releases the Member gate, while deeper/sensitive `invited` sections are offered anytime afterward. AI is
 * required for the chat sections + synthesis (§7); the crisis footer + not-medical line are always present.
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

  const isResolved = (id: string): boolean => {
    const st = statusOf.get(id) ?? 'notStarted';
    return st === 'complete' || st === 'skipped';
  };
  const core = sections.filter((m) => m.tier === 'core');
  const invited = sections.filter((m) => m.tier === 'invited');
  const pendingCore = core.filter((m) => !isResolved(m.id));
  const complete = state?.session.status === 'complete';

  // The active section: an explicitly-opened one, else (until the portrait) the next pending core section —
  // so the gated first-run flows core → core → portrait. Keyed by id so each panel re-seeds its form state.
  const activeMeta: IntakeSectionMeta | null = activeId
    ? (sections.find((m) => m.id === activeId) ?? null)
    : !complete
      ? (pendingCore[0] ?? null)
      : null;
  if (!loaded || !state) return <div className={styles.onboarding} aria-busy="true" />;

  // AI is required to run the chat sections + synthesis (§7). Show a calm "connect AI" state, never a dead-end.
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
                  Onboarding uses AI to bring everything together into your portrait, so it needs AI
                  turned on. Add your Claude API key and enable AI in Settings to start.
                </Text>
                <Button variant="primary" onClick={() => navigate('/settings')}>
                  Open Settings
                </Button>
              </>
            ) : (
              <Text tone="secondary">
                Onboarding uses AI to build your portrait, so it needs AI turned on. Ask your
                household owner to enable AI, then come back here — nothing you’ve done is lost.
              </Text>
            )}
          </div>
        </Card>
        <CrisisFooter />
      </div>
    );
  }

  const findSection = (id: string): (typeof state.session.sections)[number] | undefined =>
    state.session.sections.find((s) => s.id === id);

  const renderPanel = (meta: IntakeSectionMeta): JSX.Element =>
    meta.mode === 'form' ? (
      <IntakeFormPanel
        key={meta.id}
        meta={meta}
        section={findSection(meta.id)}
        adultAcknowledged={state.adultAcknowledged}
        onAdvance={() => setActiveId(null)}
      />
    ) : (
      <IntakeSectionPanel
        key={meta.id}
        meta={meta}
        section={findSection(meta.id)}
        adultAcknowledged={state.adultAcknowledged}
        onAdvance={() => setActiveId(null)}
      />
    );

  const InvitedGrid = (): JSX.Element => (
    <Card>
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <Heading level={2}>Go deeper</Heading>
          <Text tone="secondary">
            Optional — add any of these whenever you’re ready. The more you share, the more SelfOS
            understands you.
          </Text>
        </div>
        <div className={styles.invitedGrid}>
          {invited.map((m) => {
            const done = isResolved(m.id);
            return (
              <button
                key={m.id}
                type="button"
                className={styles.invitedCard}
                onClick={() => setActiveId(m.id)}
              >
                <div className={styles.invitedCardHead}>
                  <span className={styles.invitedTitle}>
                    {m.adult || m.restricted ? (
                      <Lock size={13} aria-hidden="true" className={styles.lock} />
                    ) : null}
                    {m.title}
                  </span>
                  <span
                    className={`${styles.invitedTag} ${done ? styles.invitedTagDone : ''}`}
                    aria-hidden="true"
                  >
                    {statusOf.get(m.id) === 'complete' ? (
                      <Check size={14} />
                    ) : statusOf.get(m.id) === 'skipped' ? (
                      'Skipped'
                    ) : (
                      'Add'
                    )}
                  </span>
                </div>
                <span className={styles.invitedBlurb}>{m.blurb}</span>
              </button>
            );
          })}
        </div>
      </div>
    </Card>
  );

  return (
    <div className={styles.onboarding}>
      <header className={styles.header}>
        <Heading level={1}>
          <Sparkles size={20} aria-hidden="true" /> Getting to know you
          {displayName ? `, ${displayName}` : ''}
        </Heading>
        <Text tone="secondary">
          A warm, private space so SelfOS understands you. Everything is encrypted and yours, you
          can skip anything, and your most sensitive answers stay private to your own coaching.
        </Text>
      </header>

      {error ? <Banner tone="danger">{error}</Banner> : null}

      {activeId && activeMeta ? (
        // An explicitly-opened (invited) section — show a back affordance to the overview.
        <>
          <button type="button" className={styles.back} onClick={() => setActiveId(null)}>
            <ArrowLeft size={14} aria-hidden="true" /> Back
          </button>
          {renderPanel(activeMeta)}
        </>
      ) : !complete ? (
        // The gated first-run: walk the core forms, then offer the portrait.
        activeMeta ? (
          <>
            <Text className={styles.stepCount}>
              Step {core.length - pendingCore.length + 1} of {core.length}
            </Text>
            {renderPanel(activeMeta)}
            <InvitedGrid />
          </>
        ) : (
          <>
            <Card>
              <div className={styles.center}>
                <Heading level={2}>That’s the essentials — thank you</Heading>
                <Text tone="secondary">
                  When you’re ready, I’ll bring it together into a portrait of what I’ve come to
                  understand about you. You can keep adding more below anytime.
                </Text>
                <Button
                  variant="primary"
                  disabled={finalizing}
                  onClick={() => {
                    void finishIntake().then((ok) => {
                      if (!ok) return;
                      setRevisiting(false);
                      navigate('/onboarding');
                    });
                  }}
                >
                  <Sparkles size={16} aria-hidden="true" />
                  {finalizing ? 'Writing your portrait…' : 'See my portrait'}
                </Button>
              </div>
            </Card>
            <InvitedGrid />
          </>
        )
      ) : revisiting ? (
        // Post-completion, an invited section can be opened from the grid; the grid is the landing.
        <InvitedGrid />
      ) : (
        <>
          <ClosingPortrait
            session={state.session}
            sections={sections}
            onRevisit={() => {
              setRevisiting(true);
              setActiveId(null);
            }}
          />
          <InvitedGrid />
          {invited.some((m) => isResolved(m.id)) ? (
            <div className={styles.controls}>
              <Button variant="secondary" disabled={finalizing} onClick={() => void finishIntake()}>
                <Sparkles size={16} aria-hidden="true" />
                {finalizing ? 'Refreshing…' : 'Refresh my portrait'}
              </Button>
            </div>
          ) : null}
        </>
      )}

      <CrisisFooter />
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Compass, Lock, Sparkles, Users } from 'lucide-react';
import type { AnswerMap } from '@selfos/core/questionnaires';
import { portraitStaleness } from '@selfos/core/intake';
import type { IntakeSectionMeta } from '@shared/channels';
import {
  Banner,
  Button,
  Card,
  Heading,
  ProportionBar,
  Text,
} from '../../../design-system/components';
import { useIntakeStore } from '../../../stores/intakeStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { AiUnavailableNotice } from '../../AiUnavailableNotice';
import { Switcher } from '../../Switcher';
import { CrisisFooter } from '../sessions/CrisisFooter';
import { IntakeSectionPanel } from './IntakeSectionPanel';
import { IntakeFormPanel } from './IntakeFormPanel';
import { ClosingPortrait } from './ClosingPortrait';
import { overallProgress, sectionProgress } from './progress';
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
  const location = useLocation();
  const state = useIntakeStore((s) => s.state);
  const loaded = useIntakeStore((s) => s.loaded);
  const error = useIntakeStore((s) => s.error);
  const appendChunk = useIntakeStore((s) => s.appendChunk);
  const finishIntake = useIntakeStore((s) => s.finishIntake);
  const finalizing = useIntakeStore((s) => s.finalizing);
  const displayName = useSessionStore((s) => s.activePerson?.displayName ?? null);
  const activePersonId = useSessionStore((s) => s.activePerson?.id ?? null);

  // The opened section is persisted device-local (per person) so a reload/restart returns you to where you
  // were instead of bouncing to the first unfinished core step. It's transient UI nav state — never content.
  const storageKey = activePersonId ? `selfos:onboarding:section:${activePersonId}` : null;
  const [activeId, setActiveIdState] = useState<string | null>(() => {
    if (!storageKey) return null;
    try {
      return window.localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  });
  const setActiveId = useCallback(
    (id: string | null): void => {
      setActiveIdState(id);
      if (!storageKey) return;
      try {
        if (id) window.localStorage.setItem(storageKey, id);
        else window.localStorage.removeItem(storageKey);
      } catch {
        /* localStorage unavailable — keep the in-memory value only */
      }
    },
    [storageKey],
  );
  const [revisiting, setRevisiting] = useState(false);
  // A person can switch accounts from within onboarding (esp. the full-screen gated takeover, where the
  // sidebar is hidden) — not only via the titlebar account menu. Owner switches PIN-free; others enter a PIN.
  const [switching, setSwitching] = useState(false);
  // The "See my portrait" confirmation modal (a chance to add more before generating, §15).
  const [confirmPortrait, setConfirmPortrait] = useState(false);
  // 29 — pending DEPTH invitations (sectionId → theme), so the "Go deeper" cards for an invited section the
  // coach has suggested get a gentle "Suggested" treatment + the recurring theme (§3.2/§5.4). Own-scoped via
  // the bridge. Deep-link target (from the Home depth card) is read from router state once.
  const [depthThemeBySection, setDepthThemeBySection] = useState<Map<string, string>>(new Map());
  const deepLinkedRef = useRef(false);
  // Switching sections from the bottom "Go deeper" grid loads the new section at the top — bring it into view.
  const topRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (activeId) topRef.current?.scrollIntoView?.({ block: 'start' });
  }, [activeId]);

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

  // The explicitly-opened section (an invited or revisited one). A persisted id that no longer resolves
  // (e.g. a section removed/renamed across a release) is dropped so we fall back to the normal flow.
  const openSection: IntakeSectionMeta | null = activeId
    ? (sections.find((m) => m.id === activeId) ?? null)
    : null;
  useEffect(() => {
    if (activeId && !openSection && sections.length > 0) setActiveId(null);
  }, [activeId, openSection, sections.length, setActiveId]);

  // Load pending depth invitations (29) → highlight the matching "Go deeper" cards. Re-loads per active person.
  useEffect(() => {
    let cancelled = false;
    void window.selfos?.profileSuggestions().then((all) => {
      if (cancelled) return;
      const map = new Map<string, string>();
      for (const s of all ?? []) {
        if (s.kind === 'depth' && s.sectionId) map.set(s.sectionId, s.theme ?? '');
      }
      setDepthThemeBySection(map);
    });
    return () => {
      cancelled = true;
    };
  }, [activePersonId]);

  // Deep-link from the Home depth card: open the invited section it points at, once, after sections load. The
  // ref guards against re-firing (and clobbering a later manual navigation — the §20 reset-clobber lesson).
  useEffect(() => {
    if (deepLinkedRef.current) return;
    const target = (location.state as { openSection?: string } | null)?.openSection;
    if (target && sections.some((m) => m.id === target)) {
      deepLinkedRef.current = true;
      setActiveId(target);
    }
  }, [location.state, sections, setActiveId]);
  // The gated first-run walks the next pending core section (core → core → portrait); keyed by id so each
  // panel re-seeds its form state.
  const nextCore: IntakeSectionMeta | null = !complete ? (pendingCore[0] ?? null) : null;

  // A "Switch person" affordance available in every onboarding state (reachable in the gated takeover where
  // the sidebar/titlebar are the only other path), + the shared switcher overlay it opens.
  const switchPersonButton = (
    <Button variant="ghost" onClick={() => setSwitching(true)}>
      <Users size={16} aria-hidden="true" />
      Switch person
    </Button>
  );
  const switcherOverlay = switching ? <Switcher onClose={() => setSwitching(false)} /> : null;

  // Overall progress, by section (a section counts once it's finished). Shown in the page header AND the
  // "Go deeper" block so it's clear how much is done / left (18 §3.1).
  const progress = overallProgress(sections, (id) => statusOf.get(id));
  const progressBar =
    sections.length > 0 ? (
      <ProportionBar label="Your progress" value={progress.completed} total={progress.total} />
    ) : null;

  if (!loaded || !state) return <div className={styles.onboarding} aria-busy="true" />;

  // AI is required to run the chat sections + synthesis (§7). Show a calm "connect AI" state, never a dead-end.
  if (!state.aiAvailable) {
    return (
      <div className={styles.onboarding}>
        <header className={styles.header}>
          <div className={styles.headerTop}>
            <Heading level={1}>Getting to know you</Heading>
            {switchPersonButton}
          </div>
        </header>
        <Card>
          <div className={styles.center}>
            <Lock size={22} aria-hidden="true" />
            <Heading level={2}>Connect AI to begin</Heading>
            <Text tone="secondary">
              Onboarding uses AI to bring everything together into your portrait, so it needs AI
              turned on. Nothing you’ve done is lost.
            </Text>
            <AiUnavailableNotice />
          </div>
        </Card>
        <CrisisFooter />
        {switcherOverlay}
      </div>
    );
  }

  const findSection = (id: string): (typeof state.session.sections)[number] | undefined =>
    state.session.sections.find((s) => s.id === id);

  // The person's gender (from the already-answered `basics` section) tailors the intimacy activity matrix's
  // oral rows (27 §4.2); the intimacy panel pairs it with the live `drawnTo` answer.
  const basicsGender = findSection('basics')?.answers?.['gender'];
  const profileGender = typeof basicsGender === 'string' ? basicsGender : undefined;

  const renderPanel = (meta: IntakeSectionMeta): JSX.Element =>
    meta.mode === 'form' ? (
      <IntakeFormPanel
        key={meta.id}
        meta={meta}
        section={findSection(meta.id)}
        adultAcknowledged={state.adultAcknowledged}
        {...(profileGender ? { profileGender } : {})}
        portraitStale={portraitStaleness(state.session).stale}
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

  const sectionCard = (m: IntakeSectionMeta): JSX.Element => {
    const status = statusOf.get(m.id);
    const current = m.id === activeId;
    const isDone = status === 'complete';
    // 29 — a pending depth invitation for this (unfilled, not-current) invited section → "Suggested" treatment.
    const suggested = !current && !isDone && depthThemeBySection.has(m.id);
    const { answered, total } = sectionProgress(m, (findSection(m.id)?.answers ?? {}) as AnswerMap);
    const cardClass = [
      styles.invitedCard,
      current ? styles.invitedCardCurrent : '',
      isDone && !current ? styles.invitedCardDone : '',
      suggested ? styles.invitedCardSuggested : '',
    ]
      .filter(Boolean)
      .join(' ');
    return (
      <button
        key={m.id}
        type="button"
        className={cardClass}
        aria-current={current ? 'true' : undefined}
        onClick={() => setActiveId(m.id)}
      >
        <div className={styles.invitedCardHead}>
          <span className={styles.invitedTitle}>
            {m.adult || m.restricted ? (
              <Lock size={13} aria-hidden="true" className={styles.lock} />
            ) : null}
            {m.title}
          </span>
          {current ? (
            <span className={styles.invitedTagCurrent} aria-hidden="true">
              Current
            </span>
          ) : isDone ? (
            <span className={styles.invitedTagDone} aria-hidden="true">
              <Check size={13} aria-hidden="true" /> Update
            </span>
          ) : suggested ? (
            <span className={styles.invitedTagSuggested}>
              <Compass size={13} aria-hidden="true" /> Suggested
            </span>
          ) : (
            <span className={styles.invitedTag} aria-hidden="true">
              {status === 'skipped' ? 'Skipped' : 'Add'}
            </span>
          )}
        </div>
        <span className={styles.invitedBlurb}>{m.blurb}</span>
        {suggested && depthThemeBySection.get(m.id) ? (
          <span className={styles.invitedSuggestedNote}>
            Come up a few times: {depthThemeBySection.get(m.id)}
          </span>
        ) : total > 0 ? (
          <span className={styles.invitedCount} aria-hidden="true">
            {answered} of {total} answered
          </span>
        ) : null}
      </button>
    );
  };

  // Both the "The essentials" (core) and "Go deeper" (invited) grids — so EVERY section, core included, is
  // revisitable from one place (18 §3.1). The overall progress bar rides on the "Go deeper" block.
  const Grids = (): JSX.Element => (
    <>
      <Card>
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <Heading level={2}>The essentials</Heading>
            <Text tone="secondary">The quick basics — revisit or update any of these anytime.</Text>
          </div>
          <div className={styles.invitedGrid}>{core.map(sectionCard)}</div>
        </div>
      </Card>
      <Card>
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <Heading level={2}>Go deeper</Heading>
            <Text tone="secondary">
              Add to or update any of these whenever you’re ready — there’s no rush, and you can
              come back and revisit any section anytime. The more you share, the more SelfOS
              understands you.
            </Text>
          </div>
          {progressBar}
          <div className={styles.invitedGrid}>{invited.map(sectionCard)}</div>
        </div>
      </Card>
    </>
  );

  // How much has been filled in across the whole intake (for the portrait modal + the "you've shared a
  // little so far" nudge), and whether the existing portrait is now out of date (§15).
  const answeredTotals = sections.reduce(
    (acc, m) => {
      const p = sectionProgress(m, (findSection(m.id)?.answers ?? {}) as AnswerMap);
      return { answered: acc.answered + p.answered, total: acc.total + p.total };
    },
    { answered: 0, total: 0 },
  );
  const lightlyFilled = answeredTotals.answered < 25;
  const staleness = portraitStaleness(state.session);

  // Generate (or refresh) the portrait, closing the confirm modal and landing on the result.
  const generatePortrait = (): void => {
    void finishIntake().then((ok) => {
      setConfirmPortrait(false);
      if (!ok) return;
      setRevisiting(false);
      navigate('/onboarding');
    });
  };

  const portraitModal = confirmPortrait ? (
    <div
      className={styles.modalOverlay}
      role="dialog"
      aria-modal="true"
      aria-label="Ready for your portrait?"
    >
      <Card className={styles.modalPanel}>
        <div className={styles.section}>
          <Heading level={2}>Ready for your portrait?</Heading>
          <Text tone="secondary">
            You’ve answered {answeredTotals.answered} of {answeredTotals.total} questions, across{' '}
            {progress.completed} of {progress.total} sections.
          </Text>
          {lightlyFilled ? (
            <Banner tone="info">
              You’ve shared just a little so far. Even a few more minutes makes your portrait
              noticeably richer — and you can always come back, add more, and refresh it anytime.
            </Banner>
          ) : (
            <Text tone="secondary">
              The more you share, the more personal your portrait. You don’t have to do it all now —
              you can come back, add more, and refresh it anytime.
            </Text>
          )}
          <div className={styles.controls}>
            <Button variant="primary" disabled={finalizing} onClick={generatePortrait}>
              <Sparkles size={16} aria-hidden="true" />
              {finalizing ? 'Writing your portrait…' : 'Generate my portrait'}
            </Button>
            <Button variant="ghost" disabled={finalizing} onClick={() => setConfirmPortrait(false)}>
              Keep adding
            </Button>
          </div>
        </div>
      </Card>
    </div>
  ) : null;

  return (
    <div className={styles.onboarding} ref={topRef}>
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <Heading level={1}>
            <Sparkles size={20} aria-hidden="true" /> Getting to know you
            {displayName ? `, ${displayName}` : ''}
          </Heading>
          {switchPersonButton}
        </div>
        <Text tone="secondary">
          A warm, private space so SelfOS understands you. Everything is encrypted and yours, you
          can skip anything, and your most sensitive answers stay private to your own coaching.
        </Text>
        {progressBar}
      </header>

      {error ? <Banner tone="danger">{error}</Banner> : null}

      {openSection ? (
        // An explicitly-opened section — a back affordance, the section, then the "Go deeper" navigator so
        // the person can jump straight to any other section without going Back first (18 §3.1).
        <>
          <button type="button" className={styles.back} onClick={() => setActiveId(null)}>
            <ArrowLeft size={14} aria-hidden="true" /> Back
          </button>
          {renderPanel(openSection)}
          <Grids />
        </>
      ) : !complete ? (
        // The gated first-run: walk the core forms, then offer the portrait.
        nextCore ? (
          <>
            <Text className={styles.stepCount}>
              Step {core.length - pendingCore.length + 1} of {core.length}
            </Text>
            {renderPanel(nextCore)}
            <Grids />
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
                  onClick={() => setConfirmPortrait(true)}
                >
                  <Sparkles size={16} aria-hidden="true" />
                  See my portrait
                </Button>
              </div>
            </Card>
            <Grids />
          </>
        )
      ) : revisiting ? (
        // Post-completion, an invited section can be opened from the grid; the grid is the landing.
        <Grids />
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
          {staleness.stale ? (
            <Banner tone="info">
              You’ve added or changed about {staleness.pct}% since your last portrait — refresh it
              so your coaching stays up to date.
            </Banner>
          ) : null}
          <Grids />
          <div className={styles.controls}>
            <Button variant="secondary" disabled={finalizing} onClick={() => void finishIntake()}>
              <Sparkles size={16} aria-hidden="true" />
              {finalizing ? 'Refreshing…' : 'Refresh my portrait'}
            </Button>
          </div>
        </>
      )}

      <CrisisFooter />
      {switcherOverlay}
      {portraitModal}
    </div>
  );
}

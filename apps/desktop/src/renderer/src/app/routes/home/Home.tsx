import { useEffect, useState } from 'react';
import { aiKeyResolved } from '../../aiAvailability';
import { useSessionStore } from '../../../stores/sessionStore';
import { useConversationStore } from '../../../stores/conversationStore';
import { useDreamStore } from '../../../stores/dreamStore';
import { useDreamPatternStore } from '../../../stores/dreamPatternStore';
import { useInsightStore } from '../../../stores/insightStore';
import { unansweredCount, useInboxStore } from '../../../stores/inboxStore';
import { useGuidanceStore } from '../../../stores/guidanceStore';
import { useIntakeStore } from '../../../stores/intakeStore';
import { useSetting } from '../../../settings/useSetting';
import { aggregateCrisisSignal } from '@selfos/core/coaching';
import { CrisisFooter } from '../sessions/CrisisFooter';
import { CrisisSupportBanner } from './CrisisSupportBanner';
import { OnboardingCard } from './OnboardingCard';
import { ProfileFreshnessCard } from './ProfileFreshnessCard';
import { DepthInvitationCard } from './DepthInvitationCard';
import { ContinueCard } from './ContinueCard';
import { SuggestionsCard } from './SuggestionsCard';
import { WellbeingCard } from './WellbeingCard';
import { DreamsCard } from './DreamsCard';
import { MemoryCard } from './MemoryCard';
import { InboxCard } from './InboxCard';
import { GettingStarted } from './GettingStarted';
import { buildStatusLine, timeOfDayGreeting } from './greeting';
import { sessionMoodPoints, wellbeingRead } from './wellbeing';
import styles from './Home.module.css';

/**
 * The Home dashboard (17): a per-active-person, card-based overview composed from the existing per-person
 * stores (no new IPC). Each card self-hides when empty; a brand-new person sees a warm getting-started
 * state. Loads on mount and on the active-person change (the per-person reset rule). No action spends
 * budget on load (§3.4).
 */
export function Home(): JSX.Element {
  const activePerson = useSessionStore((s) => s.activePerson);
  const activePersonId = activePerson?.id ?? null;
  const isAdmin = useSessionStore((s) => s.can('budgets.manage'));
  const hasSessions = useSessionStore((s) => s.can('sessions.own'));
  const canCreateQuestionnaires = useSessionStore((s) => s.can('questionnaires.create'));
  const canViewMemory = useSessionStore((s) => s.can('memory.own'));
  const canOwnDreams = useSessionStore((s) => s.can('dreams.own'));
  const canManagePeople = useSessionStore((s) => s.can('people.manage'));

  const conversations = useConversationStore((s) => s.conversations);
  const sessionCosts = useConversationStore((s) => s.sessionCosts);
  const dreams = useDreamStore((s) => s.dreams);
  const patternStats = useDreamPatternStore((s) => s.stats);
  const insights = useInsightStore((s) => s.insights);
  const inboxItems = useInboxStore((s) => s.items);

  const [aiEnabled] = useSetting('ai.enabled');
  const [hasKey, setHasKey] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void aiKeyResolved('anthropic').then(setHasKey);
  }, []);

  // Load every source this dashboard composes — on mount and whenever the active person changes (so one
  // account's overview never lingers into another's). Deterministic reads only; nothing spends budget.
  useEffect(() => {
    setReady(false);
    let cancelled = false;
    void Promise.all([
      useConversationStore.getState().load(),
      useDreamStore.getState().load(),
      useDreamPatternStore.getState().load(),
      useInsightStore.getState().load(),
      useInboxStore.getState().load(),
      useGuidanceStore.getState().load(),
      useIntakeStore.getState().load(),
    ]).then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [activePersonId]);

  const configured = aiEnabled === true && hasKey;

  const openSessions = conversations.filter(
    (c) => c.status === 'inProgress' || c.status === 'onHold',
  ).length;
  // `insightStore` now holds only the ACTIVE person's memory (own + relationships' shareable facts —
  // 20-memory-dashboard §5.1); this filter keeps Home's cards to the person's OWN approved insights.
  const approvedInsights = insights.filter(
    (i) => i.approved && i.subjectPersonId === activePersonId,
  );
  const moodPoints = activePersonId ? sessionMoodPoints(insights, activePersonId) : [];
  // Cross-insight crisis awareness (40 §3.5): recurring distress across the person's OWN approved insights +
  // the dream nightmare nudge → a supportive, resources-first surface. Deterministic, no AI, no spend, and
  // NOT governed by the proactivity setting (it's safety). Per-person — only this person's insights.
  const crisis = aggregateCrisisSignal({
    insights: approvedInsights,
    nightmareNudge: patternStats?.nightmareNudge === true,
    now: new Date(),
  }).recurring;
  const inboxCount = unansweredCount(inboxItems);

  const greeting = `${timeOfDayGreeting(new Date().getHours())}, ${activePerson?.displayName ?? 'there'}`;
  const statusLine = buildStatusLine({
    openSessions,
    inboxCount,
    moodRead: wellbeingRead(moodPoints),
  });

  const isNew =
    ready &&
    conversations.length === 0 &&
    dreams.length === 0 &&
    approvedInsights.length === 0 &&
    inboxCount === 0;

  return (
    <div className={styles.home}>
      <header>
        <h1 className={styles.greeting}>{greeting}</h1>
        {statusLine ? <p className={styles.status}>{statusLine}</p> : null}
      </header>

      {ready && crisis ? <CrisisSupportBanner /> : null}

      {ready ? <OnboardingCard /> : null}
      {ready ? <ProfileFreshnessCard /> : null}
      {ready ? <DepthInvitationCard /> : null}

      {!ready ? null : isNew ? (
        <GettingStarted
          hasSessions={hasSessions}
          canOwnDreams={canOwnDreams}
          canManagePeople={canManagePeople}
        />
      ) : (
        <div className={styles.grid}>
          <ContinueCard
            conversations={conversations}
            sessionCosts={sessionCosts}
            isAdmin={isAdmin}
          />
          {hasSessions ? (
            <SuggestionsCard
              configured={configured}
              canCreateQuestionnaires={canCreateQuestionnaires}
            />
          ) : null}
          <WellbeingCard points={moodPoints} />
          <DreamsCard dreams={dreams} stats={patternStats} />
          <MemoryCard insights={approvedInsights} canView={canViewMemory} />
          <InboxCard count={inboxCount} />
        </div>
      )}

      <CrisisFooter />
    </div>
  );
}

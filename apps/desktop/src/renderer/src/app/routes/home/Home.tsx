import { useEffect, useState } from 'react';
import { ANTHROPIC_API_KEY_ID } from '@shared/channels';
import { useSessionStore } from '../../../stores/sessionStore';
import { useConversationStore } from '../../../stores/conversationStore';
import { useDreamStore } from '../../../stores/dreamStore';
import { useDreamPatternStore } from '../../../stores/dreamPatternStore';
import { useInsightStore } from '../../../stores/insightStore';
import { unansweredCount, useInboxStore } from '../../../stores/inboxStore';
import { useGuidanceStore } from '../../../stores/guidanceStore';
import { useIntakeStore } from '../../../stores/intakeStore';
import { useSetting } from '../../../settings/useSetting';
import { CrisisFooter } from '../sessions/CrisisFooter';
import { OnboardingCard } from './OnboardingCard';
import { ContinueCard } from './ContinueCard';
import { SuggestionsCard } from './SuggestionsCard';
import { WellbeingCard } from './WellbeingCard';
import { DreamsCard } from './DreamsCard';
import { MemoryCard } from './MemoryCard';
import { InboxCard } from './InboxCard';
import { GettingStarted } from './GettingStarted';
import { buildStatusLine, timeOfDayGreeting } from './greeting';
import { hasRecentCrisis, sessionMoodPoints, wellbeingRead } from './wellbeing';
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
  const canViewInsights = useSessionStore((s) => s.can('questionnaires.viewResults'));
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
    void window.selfos?.secretHas({ id: ANTHROPIC_API_KEY_ID }).then((v) => setHasKey(Boolean(v)));
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
  // `insightStore` intentionally holds EVERY person's insights (the household Memory surface needs that);
  // per-person isolation on Home is this filter, not a store reset — keep it on every consumption.
  const approvedInsights = insights.filter(
    (i) => i.approved && i.subjectPersonId === activePersonId,
  );
  const moodPoints = activePersonId ? sessionMoodPoints(insights, activePersonId) : [];
  const crisis = activePersonId ? hasRecentCrisis(insights, activePersonId) : false;
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

      {ready ? <OnboardingCard /> : null}

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
          <WellbeingCard points={moodPoints} crisis={crisis} />
          <DreamsCard dreams={dreams} stats={patternStats} />
          <MemoryCard insights={approvedInsights} canView={canViewInsights} />
          <InboxCard count={inboxCount} />
        </div>
      )}

      <CrisisFooter />
    </div>
  );
}

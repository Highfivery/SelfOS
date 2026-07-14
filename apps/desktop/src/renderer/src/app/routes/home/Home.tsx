import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { aiKeyResolved } from '../../aiAvailability';
import { useSessionStore } from '../../../stores/sessionStore';
import { useConversationStore } from '../../../stores/conversationStore';
import { useDreamStore } from '../../../stores/dreamStore';
import { useDreamPatternStore } from '../../../stores/dreamPatternStore';
import { useInsightStore } from '../../../stores/insightStore';
import { unansweredCount, useInboxStore } from '../../../stores/inboxStore';
import { useQuestionnaireStore } from '../../../stores/questionnaireStore';
import { usePeopleStore } from '../../../stores/peopleStore';
import { useGuidanceStore } from '../../../stores/guidanceStore';
import { useIntakeStore } from '../../../stores/intakeStore';
import { useSynthesisStore } from '../../../stores/synthesisStore';
import { useGoalStore } from '../../../stores/goalStore';
import { useChallengeStore } from '../../../stores/challengeStore';
import { useTestStore } from '../../../stores/testStore';
import { useDiscoveryStore } from '../../../stores/discoveryStore';
import { useTogetherStore } from '../../../stores/togetherStore';
import { useSetting } from '../../../settings/useSetting';
import { aggregateCrisisSignal } from '@selfos/core/coaching';
import {
  checkInDueChallenge,
  featuredActiveChallenge,
  shouldSuggestChallenge,
} from '@selfos/core/challenges';
import {
  computeMomentum,
  computeTogetherHomeNudge,
  listRecommendationProviders,
  pendingCelebration,
  rankRecommendations,
  type Completion,
  type PersonRecommendationState,
  type ProactivityLevel,
} from '@selfos/core/recommendations';
import {
  activeMilestones,
  buildActivityFeed,
  computeLifeRings,
  computeStreak,
} from '@selfos/core/home';
import type { ProfileUpdateSuggestion } from '@shared/channels';
import { CrisisFooter } from '../sessions/CrisisFooter';
import { CrisisSupportBanner } from './CrisisSupportBanner';
import { OnboardingCard } from './OnboardingCard';
import { ContinueCard } from './ContinueCard';
import { WellbeingCard } from './WellbeingCard';
import { DreamsCard } from './DreamsCard';
import { MemoryCard } from './MemoryCard';
import { ChallengeCard } from './ChallengeCard';
import { GoalsCard } from './GoalsCard';
import { YouCard } from './YouCard';
import { NeedsAttentionCard } from './NeedsAttentionCard';
import { needsAttention } from './attention';
import { QuestionnairesCard } from './QuestionnairesCard';
import { GettingStarted } from './GettingStarted';
import { WelcomeOrientationCard } from './WelcomeOrientationCard';
import { ForYou } from './ForYou';
import { ForYouBand } from './ForYouBand';
import { MomentumLine } from './MomentumLine';
import { CelebrationMoment } from './CelebrationMoment';
import { QuickActionDock } from './QuickActionDock';
import { RhythmStreak } from './RhythmStreak';
import { StatTile } from './StatTile';
import { TogetherHomeCard } from './TogetherHomeCard';
import { SharingCard } from './SharingCard';
import { LifeRings } from './LifeRings';
import { ActivityFeed } from './ActivityFeed';
import { CardSkeleton } from './CardSkeleton';
import { timeOfDayGreeting } from './greeting';
import { checkInMoodPoints, sessionMoodPoints, wellbeingCheckin } from './wellbeing';
import styles from './Home.module.css';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SHOWED_UP_WINDOW_DAYS = 7;
const GOAL_RECENT_DAYS = 14;
const RING_WINDOW_DAYS = 30;

/** Recommendation ids that move OUT of the "For you" band INTO the "Needs attention" card (§3.1.2a, split by
 *  intent) — the waiting-on-you / time-sensitive kinds, so the same item never surfaces in both. */
const ATTENTION_REC_IDS = new Set([
  'stale-goal',
  'wellbeing-checkin',
  'together-session',
  'questionnaire-gap',
]);

/** Whether an ISO timestamp falls within the last `days` (false on a missing/unparseable value). */
function withinDays(iso: string | undefined, days: number, now: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return !Number.isNaN(t) && now - t <= days * MS_PER_DAY && t <= now;
}

/** Days after which a Together Pulse check-in is "due" (spec 61 §3.4) — never checked in, or last > 7 days. */
const PULSE_DUE_DAYS = 7;
function pulseIsDue(view: { hasCheckIns: boolean; lastCheckInAt?: string }, now: number): boolean {
  if (!view.hasCheckIns || !view.lastCheckInAt) return true;
  const t = Date.parse(view.lastCheckInAt);
  if (!Number.isFinite(t)) return true;
  return now - t > PULSE_DUE_DAYS * MS_PER_DAY;
}

/** Collect the defined, non-empty values from a list of `string | undefined`. */
function defined(values: (string | undefined)[]): string[] {
  return values.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

/**
 * The Hybrid Home dashboard (60): a highly visual, cross-feature command center composed on the renderer
 * from the existing per-person stores (60 §5.2). A quick-action dock, a greeting + momentum + rhythm streak,
 * a "For you today" band (the cached AI reflection + the smart next action), a graph-rich bento of feature
 * cards, and a right rail of life-rings + a cross-feature activity feed — all skeleton-loaded (§3.2), each
 * region self-hiding when empty, per-person, and full-engagement but crisis-guarded (§8). Slice 1 spends
 * nothing on load (the reflection is cache-only; Slice 2 adds the daily auto-cadence).
 */
export function Home(): JSX.Element {
  const navigate = useNavigate();
  const activePerson = useSessionStore((s) => s.activePerson);
  const activePersonId = activePerson?.id ?? null;
  const isAdmin = useSessionStore((s) => s.can('budgets.manage'));
  const hasSessions = useSessionStore((s) => s.can('sessions.own'));
  const canCreateQuestionnaires = useSessionStore((s) => s.can('questionnaires.create'));
  const canViewResults = useSessionStore((s) => s.can('questionnaires.viewResults'));
  const canViewMemory = useSessionStore((s) => s.can('memory.own'));
  const canOwnDreams = useSessionStore((s) => s.can('dreams.own'));
  const canManagePeople = useSessionStore((s) => s.can('people.manage'));
  const canDoIntake = useSessionStore((s) => s.can('intake.own'));
  const canTakeTests = useSessionStore((s) => s.can('tests.own'));
  const canTakeChallenges = useSessionStore((s) => s.can('challenges.own'));
  const canTogether = useSessionStore((s) => s.can('together.own'));
  // The reactive capability snapshot the engine + the quick-dock filter gated actions against.
  const capabilities = new Set<string>();
  if (hasSessions) capabilities.add('sessions.own');
  if (canCreateQuestionnaires) capabilities.add('questionnaires.create');
  if (canViewMemory) capabilities.add('memory.own');
  if (canDoIntake) capabilities.add('intake.own');
  if (canTakeTests) capabilities.add('tests.own');
  if (canTakeChallenges) capabilities.add('challenges.own');
  if (canTogether) capabilities.add('together.own');
  if (canOwnDreams) capabilities.add('dreams.own');

  const conversations = useConversationStore((s) => s.conversations);
  const sessionCosts = useConversationStore((s) => s.sessionCosts);
  const dreams = useDreamStore((s) => s.dreams);
  const patternStats = useDreamPatternStore((s) => s.stats);
  const insights = useInsightStore((s) => s.insights);
  const outbound = useInsightStore((s) => s.outbound);
  const proposals = useInsightStore((s) => s.proposals);
  const inboxItems = useInboxStore((s) => s.items);
  const sentOverview = useQuestionnaireStore((s) => s.sentOverview);
  const relationships = usePeopleStore((s) => s.relationships);
  const people = usePeopleStore((s) => s.people);
  const goals = useGoalStore((s) => s.goals);
  const challenges = useChallengeStore((s) => s.challenges);
  const challengeSuggestion = useChallengeStore((s) => s.suggestion);
  const synthesis = useSynthesisStore((s) => s.synthesis);
  const guidedSuggestions = useGuidanceStore((s) => s.suggestions);
  const adultAcknowledged = useGuidanceStore((s) => s.adultAcknowledged);
  const testCatalog = useTestStore((s) => s.catalog);
  const resultsByTest = useTestStore((s) => s.resultsByTest);
  const togetherSessions = useTogetherStore((s) => s.sessions);
  const togetherPartners = useTogetherStore((s) => s.partners);
  const myAgreements = useTogetherStore((s) => s.myAgreements);
  const intake = useIntakeStore((s) => s.state);
  const dismissed = useDiscoveryStore((s) => s.dismissed);

  const [aiEnabled] = useSetting('ai.enabled');
  const [hasKey, setHasKey] = useState(false);
  const [proactivity, setProactivity] = useState<ProactivityLevel>('gentle');
  const [profileSuggestions, setProfileSuggestions] = useState<ProfileUpdateSuggestion[]>([]);
  const [pulseCheckinDue, setPulseCheckinDue] =
    useState<Exclude<PersonRecommendationState['pulseCheckinDue'], undefined>>(null);
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
      useInsightStore.getState().loadReconcileState(),
      useInboxStore.getState().load(),
      useQuestionnaireStore.getState().load(),
      usePeopleStore.getState().load(),
      useGuidanceStore.getState().load(),
      useIntakeStore.getState().load(),
      useSynthesisStore.getState().load(),
      useGoalStore.getState().load(),
      useChallengeStore.getState().load(),
      useTestStore.getState().load(),
      useTogetherStore.getState().load(),
      useTogetherStore.getState().loadMyAgreements(),
      useDiscoveryStore.getState().load(),
      window.selfos?.coachingGetPrefs().then((p) => {
        if (!cancelled) setProactivity(p?.proactivity ?? 'gentle');
      }),
      window.selfos?.profileSuggestions().then((s) => {
        if (!cancelled) setProfileSuggestions(s ?? []);
      }),
    ]).then(async () => {
      if (cancelled) return;
      // The inline Pulse check-in callout (spec 61 §3.4) — due for the first eligible live partner when never
      // checked in or the last check-in is > 7 days old. A free, deterministic read (no spend).
      const st = useTogetherStore.getState();
      const partner = st.partners.find((p) => p.eligible);
      let due: Exclude<PersonRecommendationState['pulseCheckinDue'], undefined> = null;
      if (partner) {
        const view = await window.selfos?.togetherPulse({ partnerPersonId: partner.personId });
        if (view && pulseIsDue(view, Date.now())) {
          due = {
            partnerPersonId: partner.personId,
            partnerName: partner.displayName,
            ...(view.lastCheckInAt ? { lastCheckInAt: view.lastCheckInAt } : {}),
          };
        }
      }
      if (!cancelled) {
        setPulseCheckinDue(due);
        setReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activePersonId]);

  const now = new Date();
  const nowMs = now.getTime();
  const configured = aiEnabled === true && hasKey;

  const openSessions = conversations.filter(
    (c) => c.status === 'inProgress' || c.status === 'onHold',
  ).length;
  const approvedInsights = insights.filter(
    (i) => i.approved && i.subjectPersonId === activePersonId,
  );
  const moodPoints = activePersonId ? sessionMoodPoints(insights, activePersonId) : [];
  const moodResults = resultsByTest['phq9'] ?? [];
  const checkInPoints = checkInMoodPoints(moodResults);
  const wbCheckin = wellbeingCheckin(resultsByTest, nowMs);
  const takenTests = testCatalog
    .filter((t) => (resultsByTest[t.id]?.length ?? 0) > 0)
    .map((t) => ({
      instrument: t.instrument,
      group: t.group,
      takenAt: resultsByTest[t.id]?.[0]?.takenAt ?? '',
    }));
  const crisis = aggregateCrisisSignal({
    insights: approvedInsights,
    nightmareNudge: patternStats?.nightmareNudge === true,
    now,
  }).recurring;
  const inboxCount = unansweredCount(inboxItems);

  const greeting = `${timeOfDayGreeting(now.getHours())}, ${activePerson?.displayName ?? 'there'}`;

  const isNew =
    ready &&
    conversations.length === 0 &&
    dreams.length === 0 &&
    approvedInsights.length === 0 &&
    inboxCount === 0 &&
    goals.length === 0 &&
    Object.keys(sentOverview).length === 0 &&
    togetherSessions.length === 0;

  const lightActivity = conversations.length + dreams.length + goals.length <= 2;
  const freshness = profileSuggestions.filter((s) => s.kind !== 'depth');
  const depthSuggestion = profileSuggestions.find((s) => s.kind === 'depth') ?? null;
  const depthArea =
    depthSuggestion && intake
      ? intake.sections.find((m) => m.id === depthSuggestion.sectionId)?.title
      : undefined;

  const areasExplored = new Set(approvedInsights.flatMap((i) => i.categories ?? [])).size;
  const goalsMoving = goals.filter(
    (g) =>
      (g.status === 'open' || g.status === 'inProgress') &&
      withinDays(g.lastTouchedAt ?? g.updatedAt, GOAL_RECENT_DAYS, nowMs),
  ).length;

  // The pure inputs the deterministic ranking engine ranks over (53 §5.1).
  const recState: PersonRecommendationState = {
    capabilities,
    adultAcknowledged,
    proactivity,
    now,
    crisis,
    isNew,
    configured,
    openGoals: goals.filter((g) => g.status === 'open' || g.status === 'inProgress'),
    openSessions,
    hasSynthesisCache: synthesis !== null,
    ...(synthesis?.computedAt ? { synthesisComputedAt: synthesis.computedAt } : {}),
    canSynthesize: approvedInsights.length >= 2,
    portraitStale: freshness.length > 0,
    freshnessSignature: freshness
      .map((s) => s.id)
      .sort()
      .join(','),
    depthInvitation: depthSuggestion
      ? {
          id: depthSuggestion.id,
          ...(depthArea ? { area: depthArea } : {}),
        }
      : null,
    guidedSuggestionCount: guidedSuggestions?.items.length ?? 0,
    ...(guidedSuggestions?.generatedAt ? { guidedGeneratedAt: guidedSuggestions.generatedAt } : {}),
    lightActivity,
    activeChallenge: featuredActiveChallenge(challenges) !== undefined,
    challengeCheckInDue: checkInDueChallenge(challenges, now) !== undefined,
    ...(checkInDueChallenge(challenges, now)
      ? {
          challengeCheckInSignature: `${checkInDueChallenge(challenges, now)?.id}:${
            checkInDueChallenge(challenges, now)?.checkInAt ?? ''
          }`,
        }
      : {}),
    challengeSuggestable: shouldSuggestChallenge(
      {
        hasActiveChallenge: featuredActiveChallenge(challenges) !== undefined,
        level: proactivity,
        ...(challengeSuggestion?.computedAt
          ? { lastSuggestedAt: challengeSuggestion.computedAt }
          : {}),
      },
      now,
    ),
    ...(challengeSuggestion?.computedAt
      ? { challengeSuggestionComputedAt: challengeSuggestion.computedAt }
      : {}),
    questionnaireGapHint: false,
    memoryStale: proposals.length > 0,
    memorySignature: proposals
      .map((p) => p.id)
      .sort()
      .join(','),
    testResults: takenTests,
    wellbeingCheckinDue: wbCheckin.due,
    ...(wbCheckin.lastAt ? { lastWellbeingCheckinAt: wbCheckin.lastAt } : {}),
    togetherNudge: activePersonId
      ? computeTogetherHomeNudge(togetherSessions, activePersonId, now)
      : null,
    pulseCheckinDue,
  };

  const dismissedSet = new Set(dismissed);
  const allRecs = rankRecommendations(listRecommendationProviders(), recState, {
    dismissed: dismissedSet,
  });
  // The synthesis observation is now the band's daily reflection (§3.6), so drop the duplicate rec; and the
  // waiting-on-you kinds move to the "Needs attention" card (§3.1.2a, split by intent) so nothing nags twice.
  const recs = allRecs.filter(
    (r) => r.id !== 'synthesis-observation' && !ATTENTION_REC_IDS.has(r.id),
  );

  const momentum = computeMomentum({
    showedUpThisWeek:
      conversations.filter((c) => withinDays(c.updatedAt, SHOWED_UP_WINDOW_DAYS, nowMs)).length +
      dreams.filter((d) => withinDays(d.createdAt, SHOWED_UP_WINDOW_DAYS, nowMs)).length,
    areasExplored,
    goalsMovingForward: goalsMoving,
  });

  // The rhythm streak (§3.1.1) — consecutive active days from ANY meaningful action. Crisis-suppressed (§8).
  const streak = computeStreak({
    now,
    crisis,
    activity: defined([
      ...conversations.map((c) => c.updatedAt),
      ...dreams.map((d) => d.createdAt),
      ...moodResults.map((r) => r.takenAt),
      // A Together session's last message counts toward YOUR rhythm only when it was yours — when it's your
      // turn, the partner acted last, so it isn't your activity (streak = days YOU showed up).
      ...togetherSessions.filter((t) => !t.yourTurn).map((t) => t.lastMessageAt),
      ...inboxItems.map((i) => i.answeredAt),
      ...challenges.filter((c) => c.checkInAt).map((c) => c.updatedAt),
    ]),
  });

  // The life-rings whole-life glance (§3.1.6). Crisis softens every ring (§8).
  const moodValues = [...moodPoints, ...checkInPoints].map((p) => p.valence);
  const rings = computeLifeRings({
    crisis,
    signals: {
      ...(moodValues.length > 0
        ? { moodValenceMean: moodValues.reduce((a, b) => a + b, 0) / moodValues.length }
        : {}),
      checkInCount: checkInPoints.length,
      hasRelationships: relationships.length > 0,
      activePartners: togetherPartners.length,
      togetherEventsRecent: togetherSessions.filter((t) =>
        withinDays(t.lastMessageAt, RING_WINDOW_DAYS, nowMs),
      ).length,
      sessionsRecent: conversations.filter((c) => withinDays(c.updatedAt, RING_WINDOW_DAYS, nowMs))
        .length,
      dreamsRecent: dreams.filter((d) => withinDays(d.createdAt, RING_WINDOW_DAYS, nowMs)).length,
      areasExplored,
      goalsMoving,
    },
  });

  // The cross-feature activity feed (§3.1.6).
  const feed = buildActivityFeed({
    now,
    sessions: conversations.map((c) => ({
      id: c.id,
      title: c.title,
      status: c.status,
      updatedAt: c.updatedAt,
    })),
    dreams: dreams.map((d) => ({
      id: d.id,
      ...(d.title ? { title: d.title } : {}),
      createdAt: d.createdAt,
    })),
    // Only the ACTIVE person's own insights feed the "needs review" stream — never a related person's
    // shareable-fact insight (defense-in-depth per-person isolation, matching every other consumer here).
    insights: insights
      .filter((i) => i.subjectPersonId === activePersonId)
      .map((i) => ({
        id: i.id,
        summary: i.summary,
        approved: i.approved,
        createdAt: i.createdAt,
      })),
    inbox: inboxItems.map((i) => ({
      assignmentId: i.assignmentId,
      title: i.title,
      senderName: i.senderName ?? 'Someone',
      createdAt: i.createdAt,
      answerable: i.answerable,
      fromSelf: i.fromSelf,
    })),
    sentOverview: Object.values(sentOverview).map((o) => {
      const answered = o.recipients.find((r) => r.answered);
      return {
        questionnaireId: o.questionnaireId,
        ...(answered ? { recipientName: answered.name } : {}),
        newResponses: o.newResponses,
        ...(o.answeredAt ? { answeredAt: o.answeredAt } : {}),
        lastSentAt: o.lastSentAt,
      };
    }),
    together: togetherSessions.map((t) => {
      const partnerName = activePersonId
        ? t.participants.find((p) => p.personId !== activePersonId)?.displayName
        : undefined;
      return {
        id: t.id,
        ...(partnerName ? { partnerName } : {}),
        yourTurn: t.yourTurn,
        unreadCount: t.unreadCount,
        status: t.status,
        ...(t.lastMessageAt ? { lastMessageAt: t.lastMessageAt } : {}),
        createdAt: t.createdAt,
      };
    }),
    challenges: challenges.map((c) => ({
      id: c.id,
      action: c.action,
      status: c.status,
      ...(c.checkInAt ? { checkInAt: c.checkInAt } : {}),
      createdAt: c.createdAt,
    })),
    goals: goals.map((g) => ({
      id: g.id,
      text: g.text,
      status: g.status,
      updatedAt: g.updatedAt,
    })),
    moodCheckIns: moodResults.map((r) => ({ at: r.takenAt })),
  });

  // Stat tiles — honest "new this week" deltas (increase-only, §8).
  const sessions7d = conversations.filter((c) => withinDays(c.updatedAt, 7, nowMs)).length;
  const newInsights7d = approvedInsights.filter((i) => withinDays(i.createdAt, 7, nowMs)).length;
  const dreams30d = dreams.filter((d) => withinDays(d.createdAt, RING_WINDOW_DAYS, nowMs)).length;
  const newDreams7d = dreams.filter((d) => withinDays(d.createdAt, 7, nowMs)).length;
  const needReview = insights.filter(
    (i) => !i.approved && i.subjectPersonId === activePersonId,
  ).length;

  // The "Needs attention" queue (§3.1.2a) — waiting-on-you items, split from the growth-oriented "For you"
  // band. The gentle nudges (check-in / stale goals / ask-someone) are suppressed under crisis or when the
  // person has turned proactive coaching off (§8); genuinely-pending items always show.
  const attentionItems = needsAttention({
    now: nowMs,
    activePersonId,
    goals,
    agreements: myAgreements,
    sentOverview,
    togetherSessions,
    resultsByTest,
    insightDraftCount: needReview,
    otherPeopleCount: people.filter((p) => p.id !== activePersonId).length,
    suppressNudges: crisis || proactivity === 'off',
    can: {
      memory: canViewMemory,
      tests: canTakeTests,
      questionnaires: canCreateQuestionnaires,
      viewResults: canViewResults,
      together: canTogether,
    },
  });

  // Completions worth a warm celebration (§3.5).
  const completions: Completion[] = [];
  if (intake?.session.status === 'complete' && intake.session.completedAt) {
    completions.push({
      key: 'onboarding',
      title: 'You finished getting to know SelfOS',
      body: 'That helps your coaching feel like it’s really for you.',
      at: intake.session.completedAt,
    });
  }
  for (const c of conversations) {
    if (c.status === 'complete') {
      completions.push({
        key: `session:${c.id}`,
        title: 'You wrapped up a session',
        body: `“${c.title}” — that’s real work.`,
        at: c.updatedAt,
      });
    }
  }
  for (const g of goals) {
    if (g.status === 'done') {
      completions.push({
        key: `goal:${g.id}`,
        title: 'You completed a goal',
        body: `“${g.text}” — nicely done.`,
        at: g.updatedAt,
      });
    }
  }
  // Milestone badges (§3.1.7) — each earned milestone celebrates once via the same flow. `streak.days` is 0
  // during crisis (suppressed), so no rhythm badge is earned then; celebration is also gated below (§8).
  for (const badge of activeMilestones({
    streakDays: streak.days,
    sessionCount: conversations.length,
    areasExplored,
    challengesDone: challenges.filter((c) => c.status === 'done').length,
  })) {
    completions.push({
      key: `badge:${badge.id}`,
      title: badge.title,
      body: badge.body,
      at: now.toISOString(),
    });
  }

  const showEncouragement = ready && proactivity !== 'off' && !crisis && !isNew;
  const celebration = showEncouragement ? pendingCelebration(completions, dismissedSet, now) : null;

  return (
    <div className={styles.home}>
      <header className={styles.header}>
        <div className={styles.headerMain}>
          <h1 className={styles.greeting}>{greeting}</h1>
          {showEncouragement ? <MomentumLine reflection={momentum} /> : null}
        </div>
        <RhythmStreak streak={streak} />
      </header>

      {!ready ? (
        <>
          <div className={styles.dock} aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={styles.skDockItem} />
            ))}
          </div>
          <div className={styles.band}>
            <CardSkeleton lines={4} />
            <CardSkeleton lines={3} />
          </div>
          <div className={styles.main}>
            <div className={styles.mainLeft}>
              <CardSkeleton lines={2} />
              <CardSkeleton lines={4} />
              <CardSkeleton lines={3} />
            </div>
            <div className={styles.rail}>
              <CardSkeleton lines={3} />
              <CardSkeleton lines={5} />
            </div>
          </div>
        </>
      ) : (
        <>
          {/* A brand-new person gets the getting-started path only — the dock's starters would collide
              with it (§3.1.8). */}
          {!isNew ? <QuickActionDock capabilities={capabilities} /> : null}

          {crisis ? <CrisisSupportBanner /> : null}

          {/* Needs attention (§3.1.2a) — the waiting-on-you queue, leading above the "For you" band. Self-hides
              when clear; only for an established person (a brand-new one gets getting-started). */}
          {!isNew ? <NeedsAttentionCard items={attentionItems} /> : null}

          {showEncouragement ? (
            <ForYouBand
              recs={recs}
              configured={configured}
              canSynthesize={recState.canSynthesize}
              depthSuggestion={depthSuggestion}
            />
          ) : null}

          {showEncouragement && recs.length > 1 ? (
            <ForYou
              recs={recs.slice(1)}
              configured={configured}
              depthSuggestion={depthSuggestion}
            />
          ) : null}

          <OnboardingCard />

          {isNew ? (
            <GettingStarted
              hasSessions={hasSessions}
              canOwnDreams={canOwnDreams}
              canManagePeople={canManagePeople}
              canCreateQuestionnaires={canCreateQuestionnaires}
            />
          ) : (
            <div className={styles.main}>
              <div className={styles.mainLeft}>
                <div className={styles.statStrip}>
                  <StatTile
                    label="Sessions · 7d"
                    value={String(sessions7d)}
                    onClick={() => navigate('/sessions')}
                  />
                  <StatTile
                    label="Insights"
                    value={String(approvedInsights.length)}
                    {...(newInsights7d > 0 ? { delta: newInsights7d } : {})}
                    {...(needReview > 0 ? { sub: `${needReview} need review` } : {})}
                    onClick={() => navigate('/memory')}
                  />
                  <StatTile
                    label="Dreams · 30d"
                    value={String(dreams30d)}
                    {...(newDreams7d > 0 ? { delta: newDreams7d } : {})}
                    onClick={() => navigate('/dreams')}
                  />
                </div>
                <WellbeingCard points={moodPoints} checkIns={checkInPoints} />
                {canTakeTests ? <YouCard /> : null}
                <TogetherHomeCard sessions={togetherSessions} myId={activePersonId} />
                <ContinueCard
                  conversations={conversations}
                  sessionCosts={sessionCosts}
                  isAdmin={isAdmin}
                />
                <DreamsCard dreams={dreams} stats={patternStats} />
                <MemoryCard insights={approvedInsights} canView={canViewMemory} />
                <ChallengeCard />
                {canViewMemory ? <GoalsCard configured={configured} crisis={crisis} /> : null}
                <QuestionnairesCard
                  sentOverview={sentOverview}
                  inboxCount={inboxCount}
                  people={people}
                  subjectPersonId={activePersonId}
                  canCreate={canCreateQuestionnaires}
                  canViewResults={canViewResults}
                />
                <SharingCard outbound={outbound} />
              </div>
              <div className={styles.rail}>
                <LifeRings rings={rings} />
                <ActivityFeed events={feed} />
              </div>
            </div>
          )}

          {!crisis ? <WelcomeOrientationCard /> : null}
          {showEncouragement ? <CelebrationMoment completion={celebration} /> : null}
        </>
      )}

      <CrisisFooter />
    </div>
  );
}

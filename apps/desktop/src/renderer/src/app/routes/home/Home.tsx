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
import { useSynthesisStore } from '../../../stores/synthesisStore';
import { useGoalStore } from '../../../stores/goalStore';
import { useChallengeStore } from '../../../stores/challengeStore';
import { useDiscoveryStore } from '../../../stores/discoveryStore';
import { useSetting } from '../../../settings/useSetting';
import { aggregateCrisisSignal } from '@selfos/core/coaching';
import {
  checkInDueChallenge,
  featuredActiveChallenge,
  shouldSuggestChallenge,
} from '@selfos/core/challenges';
import {
  computeMomentum,
  listRecommendationProviders,
  pendingCelebration,
  rankRecommendations,
  type Completion,
  type PersonRecommendationState,
  type ProactivityLevel,
} from '@selfos/core/recommendations';
import type { ProfileUpdateSuggestion } from '@shared/channels';
import type { TestResult } from '@shared/schemas';
import { CrisisFooter } from '../sessions/CrisisFooter';
import { CrisisSupportBanner } from './CrisisSupportBanner';
import { OnboardingCard } from './OnboardingCard';
import { ContinueCard } from './ContinueCard';
import { WellbeingCard } from './WellbeingCard';
import { DreamsCard } from './DreamsCard';
import { MemoryCard } from './MemoryCard';
import { InboxCard } from './InboxCard';
import { GettingStarted } from './GettingStarted';
import { WelcomeOrientationCard } from './WelcomeOrientationCard';
import { ForYou } from './ForYou';
import { MomentumLine } from './MomentumLine';
import { CelebrationMoment } from './CelebrationMoment';
import { timeOfDayGreeting } from './greeting';
import { checkInMoodPoints, sessionMoodPoints } from './wellbeing';
import styles from './Home.module.css';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SHOWED_UP_WINDOW_DAYS = 7;
const GOAL_RECENT_DAYS = 14;

/** Whether an ISO timestamp falls within the last `days` (false on a missing/unparseable value). */
function withinDays(iso: string | undefined, days: number, now: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return !Number.isNaN(t) && now - t <= days * MS_PER_DAY && t <= now;
}

/**
 * The Home dashboard (17 + 53): a per-active-person overview composed from the existing per-person stores
 * (no new IPC, no per-load AI spend). The 53 redesign imposes a clear hierarchy — a warm greeting + gentle
 * momentum reflection, the supportive crisis banner (supersedes all), a focal "For you" recommendation zone
 * (the deterministic ranking engine), then a clean status overview grid, plus warm completion celebrations.
 * Each surface self-hides when empty; a brand-new person sees getting-started. Loads + recomputes on the
 * active-person change (the per-person isolation rule).
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
  const canDoIntake = useSessionStore((s) => s.can('intake.own'));
  // The reactive capability snapshot the engine filters gated providers against (§5.2) — built from the
  // active person's `can(...)` checks for the gates the providers use (a new gate adds one line here).
  const capabilities = new Set<string>();
  if (hasSessions) capabilities.add('sessions.own');
  if (canCreateQuestionnaires) capabilities.add('questionnaires.create');
  if (canViewMemory) capabilities.add('memory.own');
  if (canDoIntake) capabilities.add('intake.own');

  const conversations = useConversationStore((s) => s.conversations);
  const sessionCosts = useConversationStore((s) => s.sessionCosts);
  const dreams = useDreamStore((s) => s.dreams);
  const patternStats = useDreamPatternStore((s) => s.stats);
  const insights = useInsightStore((s) => s.insights);
  const proposals = useInsightStore((s) => s.proposals);
  const inboxItems = useInboxStore((s) => s.items);
  const goals = useGoalStore((s) => s.goals);
  const challenges = useChallengeStore((s) => s.challenges);
  const challengeSuggestion = useChallengeStore((s) => s.suggestion);
  const synthesis = useSynthesisStore((s) => s.synthesis);
  const guidedSuggestions = useGuidanceStore((s) => s.suggestions);
  const adultAcknowledged = useGuidanceStore((s) => s.adultAcknowledged);
  const intake = useIntakeStore((s) => s.state);
  const dismissed = useDiscoveryStore((s) => s.dismissed);

  const [aiEnabled] = useSetting('ai.enabled');
  const [hasKey, setHasKey] = useState(false);
  const [proactivity, setProactivity] = useState<ProactivityLevel>('gentle');
  const [profileSuggestions, setProfileSuggestions] = useState<ProfileUpdateSuggestion[]>([]);
  const [moodCheckIns, setMoodCheckIns] = useState<TestResult[]>([]);
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
      useInsightStore.getState().loadReconcileState(), // queued merge proposals → the "memory stale" signal (39)
      useInboxStore.getState().load(),
      useGuidanceStore.getState().load(),
      useIntakeStore.getState().load(),
      useSynthesisStore.getState().load(),
      useGoalStore.getState().load(), // bridge gates on memory.own → [] when not permitted
      useChallengeStore.getState().load(), // bridge gates on challenges.own → [] when not permitted (52)
      useDiscoveryStore.getState().load(), // recommendation dismissals + celebration signatures
      window.selfos?.coachingGetPrefs().then((p) => {
        if (!cancelled) setProactivity(p?.proactivity ?? 'gentle');
      }),
      window.selfos?.profileSuggestions().then((s) => {
        if (!cancelled) setProfileSuggestions(s ?? []); // bridge gates on intake.own → [] when not permitted
      }),
      // The dated mood-check-in results (51 §5.3) → the WellbeingCard's sibling "your check-ins" series. Bridge
      // gates on tests.own → [] when not permitted; wellbeing isn't 18+-gated.
      window.selfos?.testsResults({ testId: 'phq9' }).then((r) => {
        if (!cancelled) setMoodCheckIns(r ?? []);
      }),
    ]).then(() => {
      if (!cancelled) setReady(true);
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
  // `insightStore` holds only the ACTIVE person's memory (own + relationships' shareable facts — 20 §5.1);
  // this filter keeps Home's cards + signals to the person's OWN approved insights.
  const approvedInsights = insights.filter(
    (i) => i.approved && i.subjectPersonId === activePersonId,
  );
  const moodPoints = activePersonId ? sessionMoodPoints(insights, activePersonId) : [];
  const checkInPoints = checkInMoodPoints(moodCheckIns);
  // Cross-insight crisis awareness (40 §3.5): recurring distress across the person's OWN approved insights +
  // the dream nightmare nudge → a supportive surface. NOT governed by the proactivity dial (it's safety). It
  // also de-escalates encouragement: while recurring, the engine suppresses all pushes (§8).
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
    goals.length === 0;

  const lightActivity = conversations.length + dreams.length + goals.length <= 2;
  const freshness = profileSuggestions.filter((s) => s.kind !== 'depth');
  const depthSuggestion = profileSuggestions.find((s) => s.kind === 'depth') ?? null;
  const depthArea =
    depthSuggestion && intake
      ? intake.sections.find((m) => m.id === depthSuggestion.sectionId)?.title
      : undefined;

  // The pure inputs the deterministic ranking engine ranks over (53 §5.1). Assembled from stores Home already
  // loaded — no AI, no extra I/O. Slice-B features extend this additively (their own provider reads it).
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
    // A stable signature of the pending freshness suggestions so a dismissed "refresh" re-surfaces only when
    // NEW suggestions arrive (§7) — sorted ids, never their content (no leak in the device-local key).
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
    // Challenges (52) — the active-challenge check-in nudge + the proactive "take one on" invite.
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
    questionnaireGapHint: configured && inboxCount === 0,
    memoryStale: proposals.length > 0,
    memorySignature: proposals
      .map((p) => p.id)
      .sort()
      .join(','),
  };

  const dismissedSet = new Set(dismissed);
  const recs = rankRecommendations(listRecommendationProviders(), recState, {
    dismissed: dismissedSet,
  });

  // Momentum (gentle, never a streak): a rolling-window reflection of what positively happened (§3.3).
  const momentum = computeMomentum({
    showedUpThisWeek:
      conversations.filter((c) => withinDays(c.updatedAt, SHOWED_UP_WINDOW_DAYS, nowMs)).length +
      dreams.filter((d) => withinDays(d.createdAt, SHOWED_UP_WINDOW_DAYS, nowMs)).length,
    areasExplored: new Set(approvedInsights.flatMap((i) => i.categories ?? [])).size,
    goalsMovingForward: goals.filter(
      (g) =>
        (g.status === 'open' || g.status === 'inProgress') &&
        withinDays(g.lastTouchedAt ?? g.updatedAt, GOAL_RECENT_DAYS, nowMs),
    ).length,
  });

  // Completions worth a warm, once-only celebration (§3.5). The helper picks the newest recent uncelebrated
  // one; `CelebrationMoment` records its signature so a re-visit never re-celebrates.
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

  // The "For you" zone, momentum line, and celebration are PUSHES — suppressed entirely when proactivity is
  // off, during a recurring-distress moment (lead with support), and for a brand-new person (getting-started
  // owns the screen). The status grid + crisis banner are unaffected (§3.7/§7/§8).
  const showEncouragement = ready && proactivity !== 'off' && !crisis && !isNew;
  const celebration = showEncouragement ? pendingCelebration(completions, dismissedSet, now) : null;

  return (
    <div className={styles.home}>
      <header>
        <h1 className={styles.greeting}>{greeting}</h1>
        {showEncouragement ? <MomentumLine reflection={momentum} /> : null}
      </header>

      {ready && crisis ? <CrisisSupportBanner /> : null}

      {showEncouragement ? (
        <ForYou recs={recs} configured={configured} depthSuggestion={depthSuggestion} />
      ) : null}

      {/* Onboarding stays a STATUS surface: a "continue your intake" nudge while incomplete, and a
          refresh prompt once the portrait drifts from edited answers. Self-hides when complete + fresh. */}
      {ready ? <OnboardingCard /> : null}

      {!ready ? null : isNew ? (
        <GettingStarted
          hasSessions={hasSessions}
          canOwnDreams={canOwnDreams}
          canManagePeople={canManagePeople}
          canCreateQuestionnaires={canCreateQuestionnaires}
        />
      ) : (
        <div className={styles.grid}>
          <ContinueCard
            conversations={conversations}
            sessionCosts={sessionCosts}
            isAdmin={isAdmin}
          />
          <WellbeingCard points={moodPoints} checkIns={checkInPoints} />
          <DreamsCard dreams={dreams} stats={patternStats} />
          <MemoryCard insights={approvedInsights} canView={canViewMemory} />
          <InboxCard count={inboxCount} />
        </div>
      )}

      {/* First-run orientation sits near the bottom (§3.1.7) so the focal "For you" zone leads — and never
          above the crisis banner during a distress moment (§8: never minimize distress). Shown once. */}
      {ready && !crisis ? <WelcomeOrientationCard /> : null}

      {showEncouragement ? <CelebrationMoment completion={celebration} /> : null}

      <CrisisFooter />
    </div>
  );
}

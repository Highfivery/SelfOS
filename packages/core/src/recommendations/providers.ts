import { effectiveGoalStatus, type Goal } from '../schemas';
import type { RecommendationCandidate, RecommendationProvider } from './schemas';

/**
 * The Slice-A built-in recommendation providers (53 §5.1) — over EXISTING features. Each is a pure
 * `relevance(state)` returning a deterministic candidate (free `reason` strings — no AI personalization in
 * v1, §3.8) or `null`. Slice-B features register their own providers from their own modules (§5.5), so this
 * list grows without editing Home. Scores are relative "how concrete/relevant a next step is right now":
 * resuming an open session > a quiet goal > a stale portrait > a gentle exploration invite.
 */

/**
 * Among the active goals, the least-recently-touched STALE one (the goal-followup signal, 40 §3.2). Exported
 * so the renderer's notification + the "For you" card resolve the SAME goal (no divergence — 53 §5.4).
 */
export function stalestOpenGoal(goals: Goal[], now: Date): Goal | null {
  const stale = goals.filter((g) => effectiveGoalStatus(g, now) === 'stale');
  if (stale.length === 0) return null;
  return stale.reduce((oldest, g) => {
    const a = g.lastTouchedAt ?? g.updatedAt;
    const b = oldest.lastTouchedAt ?? oldest.updatedAt;
    return a < b ? g : oldest;
  });
}

/** Resume an open/on-hold session — the most concrete next step when one exists. */
const continueSession: RecommendationProvider = {
  id: 'continue-session',
  domain: 'session',
  relevance: (s): RecommendationCandidate | null =>
    s.openSessions > 0
      ? {
          id: 'continue-session',
          label: 'Continue your session',
          reason:
            s.openSessions === 1
              ? 'You have a session in progress — continue it whenever you’re ready.'
              : `You have ${s.openSessions} sessions in progress — pick one back up when it feels right.`,
          route: '/sessions',
          score: 90,
          // Re-surfaces when the open-session situation changes (a new session opens).
          dismissKey: `continue-session:${s.openSessions}`,
        }
      : null,
};

/** A quiet open goal worth a gentle check-in (≤1; absorbs `GoalFollowupCard`). */
const staleGoal: RecommendationProvider = {
  id: 'stale-goal',
  domain: 'session',
  relevance: (s): RecommendationCandidate | null => {
    const goal = stalestOpenGoal(s.openGoals, s.now);
    if (!goal) return null;
    return {
      id: 'stale-goal',
      label: 'A goal worth a check-in',
      reason: `You set a goal a while back: “${goal.text}”. Still on it?`,
      route: '/memory',
      score: 80,
      // Per-goal + its touch stamp: dismissing this goal's nudge won't re-nag it, but a DIFFERENT goal (or
      // this one touched then re-staled) re-surfaces (§7 "a goal touched again").
      dismissKey: `stale-goal:${goal.id}:${goal.lastTouchedAt ?? goal.updatedAt}`,
    };
  },
};

/** The onboarding portrait is stale / freshness suggestions pending (absorbs `ProfileFreshnessCard`). */
const refreshPortrait: RecommendationProvider = {
  id: 'refresh-portrait',
  domain: 'memory',
  capabilityGate: 'intake.own',
  relevance: (s): RecommendationCandidate | null =>
    s.portraitStale
      ? {
          id: 'refresh-portrait',
          label: 'Refresh your portrait',
          reason:
            'A few things have changed since your last portrait — a quick refresh keeps your coaching current.',
          route: '/onboarding',
          score: 60,
          dismissKey: `refresh-portrait:${s.freshnessSignature ?? 'stale'}`, // NEW freshness re-surfaces
        }
      : null,
};

/** A pending DEPTH invitation (absorbs `DepthInvitationCard`). */
const depthInvitation: RecommendationProvider = {
  id: 'depth-invitation',
  domain: 'session',
  capabilityGate: 'intake.own',
  relevance: (s): RecommendationCandidate | null => {
    if (!s.depthInvitation) return null;
    const area = s.depthInvitation.area ?? 'your profile';
    return {
      id: 'depth-invitation',
      label: 'Want to go a little deeper?',
      reason: `We keep coming back to ${area} — tell me more whenever you’re ready.`,
      route: '/onboarding',
      score: 55,
      dismissKey: `depth-invitation:${s.depthInvitation.id ?? area}`, // a NEW invitation re-surfaces
    };
  },
};

/** The one AI voice — a cached synthesis observation, or an explicit-tap invite (absorbs `InsightOfTheWeekCard`). */
const synthesisObservation: RecommendationProvider = {
  id: 'synthesis-observation',
  domain: 'memory',
  relevance: (s): RecommendationCandidate | null => {
    if (s.hasSynthesisCache) {
      return {
        id: 'synthesis-observation',
        label: 'Something I’m noticing',
        reason:
          'A gentle thread across your recent sessions, dreams, and reflections — worth a look.',
        route: '/sessions',
        score: 65,
        dismissKey: `synthesis-observation:${s.synthesisComputedAt ?? 'cached'}`, // a NEW observation re-surfaces
      };
    }
    if (s.configured && s.canSynthesize) {
      return {
        id: 'synthesis-observation',
        label: 'Something I’m noticing',
        reason: 'Want me to look across your recent reflections for a thread worth exploring?',
        route: '/sessions',
        score: 40,
        dismissKey: 'synthesis-observation:invite',
      };
    }
    return null;
  },
};

/** A guided session — a cached suggestion, or an exploration invite for a near-empty person (absorbs the guided half of `SuggestionsCard`/`DiscoveryNudge`). */
const guidedSuggestion: RecommendationProvider = {
  id: 'guided-suggestion',
  domain: 'guided',
  capabilityGate: 'sessions.own',
  relevance: (s): RecommendationCandidate | null => {
    if (s.guidedSuggestionCount > 0) {
      return {
        id: 'guided-suggestion',
        label: 'Try a guided session',
        reason: 'A few exercises picked for you, based on your profile and recent sessions.',
        route: '/sessions',
        score: 50,
        dismissKey: `guided-suggestion:${s.guidedGeneratedAt ?? 'cached'}`, // a NEW suggestion set re-surfaces
      };
    }
    if (s.lightActivity) {
      return {
        id: 'guided-suggestion',
        label: 'Try a guided session',
        reason:
          'SelfOS has guided exercises for reflection, coaching, and connection — explore one when you’re ready.',
        route: '/sessions',
        score: 30,
        dismissKey: 'guided-suggestion:explore',
      };
    }
    return null;
  },
};

/** A questionnaire worth sending (absorbs the questionnaire half of `SuggestionsCard`). */
const questionnaireGap: RecommendationProvider = {
  id: 'questionnaire-gap',
  domain: 'questionnaire',
  capabilityGate: 'questionnaires.create',
  relevance: (s): RecommendationCandidate | null =>
    s.questionnaireGapHint
      ? {
          id: 'questionnaire-gap',
          label: 'A questionnaire to send',
          reason: 'Let the coach suggest the next questionnaire to send someone in your circle.',
          route: '/questionnaires',
          score: 35,
        }
      : null,
};

/** Memory has drifted — a tidy-up reconcile prompt (39). */
const refreshMemory: RecommendationProvider = {
  id: 'refresh-memory',
  domain: 'memory',
  capabilityGate: 'memory.own',
  relevance: (s): RecommendationCandidate | null =>
    s.memoryStale
      ? {
          id: 'refresh-memory',
          label: 'Tidy up memory',
          reason:
            'SelfOS noticed a few things in your memory worth reconciling — review them when you have a moment.',
          route: '/memory',
          score: 45,
          dismissKey: `refresh-memory:${s.memorySignature ?? 'stale'}`, // NEW drift re-surfaces
        }
      : null,
};

/** The Slice-A built-ins, registered by `registerBuiltInRecommendationProviders`. */
export const BUILT_IN_RECOMMENDATION_PROVIDERS: readonly RecommendationProvider[] = [
  continueSession,
  staleGoal,
  refreshPortrait,
  depthInvitation,
  synthesisObservation,
  guidedSuggestion,
  questionnaireGap,
  refreshMemory,
];

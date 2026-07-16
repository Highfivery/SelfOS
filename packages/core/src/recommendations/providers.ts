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

/** An auto-generated check-in is waiting in the inbox (63) — a gentle "a reflection is ready". */
const autoCheckin: RecommendationProvider = {
  id: 'auto-checkin',
  domain: 'questionnaire',
  capabilityGate: 'questionnaires.answer',
  relevance: (s): RecommendationCandidate | null => {
    const n = s.autoCheckinWaiting ?? 0;
    return n > 0
      ? {
          id: 'auto-checkin',
          label: n === 1 ? 'A reflection is ready' : `${n} reflections are ready`,
          reason:
            'SelfOS created a check-in for you from what it’s learned — answer it when you have a moment.',
          route: '/inbox',
          score: 42,
          dismissKey: `auto-checkin:${n}`, // a NEW one arriving re-surfaces a dismissal
        }
      : null;
  },
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

/** An active challenge's check-in is due — a gentle "how did it go?" (52-challenge-sessions §3.5). The most
 *  concrete challenge step: a commitment they made, now due. Capability-gated; not adult-gated (the action
 *  text is non-sexual even for a sexual challenge). */
const challengeCheckin: RecommendationProvider = {
  id: 'challenge-checkin',
  domain: 'challenge',
  capabilityGate: 'challenges.own',
  relevance: (s): RecommendationCandidate | null =>
    s.challengeCheckInDue
      ? {
          id: 'challenge-checkin',
          label: 'How did your challenge go?',
          reason: 'You took on a challenge — no pressure, just curious how it went.',
          route: '/sessions',
          score: 78,
          // Re-surfaces on a NEW due challenge / a pushed-out check-in (the challenge id + checkInAt).
          dismissKey: `challenge-checkin:${s.challengeCheckInSignature ?? 'due'}`,
        }
      : null,
};

/** No active challenge → an explicit-tap invite to take one on (52 §3.7). Needs AI (`configured`) — the
 *  suggester spends on tap; the card itself costs nothing. The throttle/level live in `challengeSuggestable`. */
const suggestChallenge: RecommendationProvider = {
  id: 'suggest-challenge',
  domain: 'challenge',
  capabilityGate: 'challenges.own',
  relevance: (s): RecommendationCandidate | null =>
    !s.activeChallenge && s.challengeSuggestable && s.configured
      ? {
          id: 'suggest-challenge',
          label: 'Ready to stretch a little?',
          reason:
            'Want a small challenge to try this week, picked from what SelfOS knows about you?',
          route: '/sessions',
          score: 42,
          // A NEW cached idea re-surfaces a dismissal; the bare invite has a durable "not now" key.
          dismissKey: `suggest-challenge:${s.challengeSuggestionComputedAt ?? 'invite'}`,
        }
      : null,
};

/** Invite a first self-assessment when none of the personality/relationships profile tests are taken
 *  (50-self-assessments). A "discover yourself" invite — never wellbeing/intimacy (those have their own
 *  gentle/18+ providers); stops firing the moment a profile test is taken. */
const takeATest: RecommendationProvider = {
  id: 'take-a-test',
  domain: 'test',
  capabilityGate: 'tests.own',
  relevance: (s): RecommendationCandidate | null => {
    const taken = s.testResults ?? [];
    const profileTaken = taken.some(
      (r) => r.group === 'personality' || r.group === 'relationships',
    );
    if (profileTaken) return null;
    return {
      id: 'take-a-test',
      label: 'Discover how you see yourself',
      reason:
        'A quick self-assessment helps your coach, dreams, and reflections fit you better — take one when you’re ready.',
      route: '/you',
      score: 38,
      // Durable invite — taking any profile test stops it firing; a "not now" keeps it quiet.
      dismissKey: 'take-a-test',
    };
  },
};

/** A gentle mood/anxiety check-in when the last one is overdue on the ~14-day window (51 §3.4). A soft
 *  invitation, NEVER a schedule, NEVER escalating — SelfOS never pressures a person to log their mood (§8).
 *  Not 18+-gated; gated only on `tests.own`. */
const wellbeingCheckin: RecommendationProvider = {
  id: 'wellbeing-checkin',
  domain: 'wellbeing',
  capabilityGate: 'tests.own',
  relevance: (s): RecommendationCandidate | null =>
    s.wellbeingCheckinDue
      ? {
          id: 'wellbeing-checkin',
          label: 'A gentle check-in',
          reason:
            'It’s been a little while since you checked in on how you’ve been feeling — only if it’d help, no pressure.',
          route: '/you/phq9/take', // straight into the check-in itself, not the You hub (60 §3.1.2)
          score: 48,
          // The last check-in date: dismissing won't re-nag the SAME overdue, but a fresh check-in (then ≥14
          // days later) re-surfaces — never an escalating schedule (§8).
          dismissKey: `wellbeing-checkin:${s.lastWellbeingCheckinAt ?? 'due'}`,
        }
      : null,
};

/** Build on the person's intimacy profile with a guided exercise (48-intimacy-guided-sessions). 18+-gated
 *  (filtered until the per-person ack) AND relevance-gated on having taken an intimacy-group test — so it
 *  reads as "for them", never pushes sexual content at someone who hasn't engaged it. */
const intimacyExercise: RecommendationProvider = {
  id: 'intimacy-exercise',
  domain: 'intimacy',
  capabilityGate: 'sessions.own',
  adultGate: true,
  relevance: (s): RecommendationCandidate | null => {
    const engaged = (s.testResults ?? []).some((r) => r.group === 'intimacy');
    if (!engaged) return null;
    return {
      id: 'intimacy-exercise',
      label: 'Build on your intimacy profile',
      reason:
        'You’ve explored your intimacy profile — a guided exercise can turn that into more connection, whenever it feels right.',
      route: '/sessions',
      score: 36,
      dismissKey: 'intimacy-exercise',
    };
  },
};

/**
 * Together (58 §3.12): a pending invitation to answer, an active session where it's the viewer's turn, or a
 * pair gone quiet >14 days since their last completed session. Capability-gated (`together.own`) + only
 * relevant with a live partner edge (the summaries the nudge derives from only exist with one). Relational
 * copy only — the explicit-register variant never appears on Home.
 */
const togetherSession: RecommendationProvider = {
  id: 'together-session',
  domain: 'together',
  capabilityGate: 'together.own',
  relevance: (s): RecommendationCandidate | null => {
    const n = s.togetherNudge;
    if (!n) return null;
    const copy = {
      invite: {
        label: 'A Together invitation',
        reason: `${n.partnerName} invited you to a Together session — open it when you’re ready.`,
        score: 88,
      },
      turn: {
        label: 'Your turn in Together',
        reason: `It’s your turn to reply in your Together session with ${n.partnerName}.`,
        score: 84,
      },
      quiet: {
        label: 'Reconnect in Together',
        reason: `It’s been a while since you and ${n.partnerName} did a Together session — no pressure, whenever it feels right.`,
        score: 52,
      },
    }[n.kind];
    return {
      id: 'together-session',
      label: copy.label,
      reason: copy.reason,
      route: n.sessionId ? `/together/session/${n.sessionId}` : '/together',
      score: copy.score,
      // Re-surfaces when the situation advances: a new invite/turn (a newer stamp) or a still-quiet pair
      // whose last-completed stamp changes (a fresh session completed, then went quiet again). Keyed on the
      // stable `pairKey` (a display name can collide or change), not the partner's name.
      dismissKey: `together:${n.kind}:${n.pairKey}:${n.stamp}`,
    };
  },
};

/**
 * The inline Pulse check-in callout (spec 61 §3.4) — surfaces on Home when a couples check-in is due for a
 * live partner (never checked in, or last > 7 days ago). Capability-gated (`together.own`) + only relevant
 * with a live partner edge. The card renders the shared check-in FORM inline (`RecommendationItem`), so the
 * person logs it right on the dashboard. Re-surfaces when a NEW overdue begins (the `lastCheckInAt` changes).
 */
const pulseCheckin: RecommendationProvider = {
  id: 'pulse-checkin',
  domain: 'together',
  capabilityGate: 'together.own',
  relevance: (s): RecommendationCandidate | null => {
    const due = s.pulseCheckinDue;
    if (!due) return null;
    return {
      id: 'pulse-checkin',
      label: `Check in with ${due.partnerName}`,
      reason: `A quick temperature check on how things feel with ${due.partnerName} — 20 seconds, private to you.`,
      route: '/together',
      score: 58,
      dismissKey: `pulse-checkin:${due.partnerPersonId}:${due.lastCheckInAt ?? 'never'}`,
    };
  },
};

/**
 * The living-book Home presence (64 §5.6): ONE card for the person's book, surfacing the highest-priority
 * signal — new material to weave in > structural suggestions to review > chapters awaiting a first draft. No
 * card for someone with no book (starting one is the nav's job, not a push). The signature drives the dismissal
 * so a NEW signal re-surfaces while the same one won't re-nag.
 */
const storyLiving: RecommendationProvider = {
  id: 'story-living',
  domain: 'story',
  capabilityGate: 'story.own',
  relevance: (s): RecommendationCandidate | null => {
    const st = s.story;
    if (!st || !st.hasBook) return null;
    const dismissKey = `story-living:${st.signature}`;
    if (st.staleChapters > 0) {
      return {
        id: 'story-living',
        label: 'Your story grew',
        reason:
          st.staleChapters === 1
            ? 'A chapter of your story has new material to weave in.'
            : `${st.staleChapters} chapters of your story have new material to weave in.`,
        route: '/story',
        score: 62,
        dismissKey,
      };
    }
    if (st.pendingProposals > 0) {
      return {
        id: 'story-living',
        label: 'Shape your story',
        reason:
          st.pendingProposals === 1
            ? 'Your biographer suggested a change to your story’s shape — review it when you like.'
            : `Your biographer suggested ${st.pendingProposals} changes to your story’s shape — review them when you like.`,
        route: '/story',
        score: 50,
        dismissKey,
      };
    }
    if (st.unwrittenChapters > 0) {
      return {
        id: 'story-living',
        label: 'Keep writing your story',
        reason:
          st.unwrittenChapters === 1
            ? 'A chapter of your story is waiting to be written.'
            : `${st.unwrittenChapters} chapters of your story are waiting to be written.`,
        route: '/story',
        score: 44,
        dismissKey,
      };
    }
    return null;
  },
};

/**
 * The built-in recommendation providers, registered by `registerBuiltInRecommendationProviders`. Slice A is
 * the existing-feature set; Slice B grows it as the 2026-06 features land (50/51/48/52) — each registered
 * here (the engine built-ins), so they appear in "For you" when relevant + permitted with NO `Home.tsx` edit.
 */
export const BUILT_IN_RECOMMENDATION_PROVIDERS: readonly RecommendationProvider[] = [
  continueSession,
  staleGoal,
  refreshPortrait,
  depthInvitation,
  synthesisObservation,
  guidedSuggestion,
  questionnaireGap,
  autoCheckin,
  refreshMemory,
  challengeCheckin,
  suggestChallenge,
  // Slice B (50/51/48): self-assessments, wellbeing check-ins, intimacy exercises.
  takeATest,
  wellbeingCheckin,
  intimacyExercise,
  // Together (58 §3.12): couples-session presence on Home.
  togetherSession,
  // Together follow-through (spec 61): the inline Pulse check-in callout.
  pulseCheckin,
  // Your Story (64 §5.6): the living-book presence on Home.
  storyLiving,
];

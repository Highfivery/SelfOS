import { useEffect, useState } from 'react';
import type {
  AnswersUpdatedSummary,
  Challenge,
  ReminderDueSummary,
  ResponsesArrivedSummary,
} from '@shared/channels';
import type { CoachingSynthesis, Goal, SharedBookSummary } from '@shared/schemas';
import { checkInDueChallenge } from '@selfos/core/challenges';
import { useSessionStore } from '../../stores/sessionStore';
import { useNotificationStore } from '../../stores/notificationStore';
import { useUpdateStore } from '../../stores/updateStore';
import { useIntakeStore } from '../../stores/intakeStore';
import { useTogetherStore } from '../../stores/togetherStore';
import { attentionFromIntakeState } from '../routes/onboarding/progress';
import { togetherNotificationCandidates } from '../routes/together/notifications';
import { stalestGoal } from './goalFollowup';
import type { NotificationCandidate } from './notificationKinds';

/**
 * Wires the four v1 sources into the notification store (35-notification-system §3.5/§3.6). Most are
 * DERIVED from live state: sync conflicts (already computed in the AppHeader path, passed in), profile
 * suggestions + responses-arrived (one-shot reads on mount/person-change — NO background polling; the
 * relay drain is the existing point that fetches external responses), and update-available (stubbed —
 * spec 36 raises it). Re-fetches when the active person changes; the active-id guard drops a fetch that
 * resolves after a switch (the same async-after-reset race the Home dashboard guards).
 */
export function useNotificationSources(conflicts: string[]): void {
  const activePersonId = useSessionStore((s) => s.activePerson?.id ?? null);
  const canViewResults = useSessionStore((s) => s.can('questionnaires.viewResults'));
  const canIntake = useSessionStore((s) => s.can('intake.own'));
  const canMemory = useSessionStore((s) => s.can('memory.own'));
  const canSessions = useSessionStore((s) => s.can('sessions.own'));
  const canChallenges = useSessionStore((s) => s.can('challenges.own'));
  const canTogether = useSessionStore((s) => s.can('together.own'));
  const canAnswer = useSessionStore((s) => s.can('questionnaires.answer'));
  const canAutoCheckin = useSessionStore((s) => s.can('questionnaires.autoCheckin'));
  const canStory = useSessionStore((s) => s.can('story.own'));
  // Together sessions are loaded + reset per active person by AppShell (58 §5.3) — derive the invite/turn
  // notifications from the projection-computed summaries (no extra fetch, no message content, §3.11).
  const togetherSessions = useTogetherStore((s) => s.sessions);
  const setCandidates = useNotificationStore((s) => s.setCandidates);
  // The update result is app-global (NOT per-person) — it survives a person switch (36 §11).
  const update = useUpdateStore((s) => s.result);
  // The intake state is loaded + reset per active person by AppShell (18 §7); the onboarding-attention
  // notification (55) derives from it, so no extra fetch here.
  const intake = useIntakeStore((s) => s.state);

  const [suggestionIds, setSuggestionIds] = useState<string[]>([]);
  const [responses, setResponses] = useState<ResponsesArrivedSummary[]>([]);
  const [answerEdits, setAnswerEdits] = useState<AnswersUpdatedSummary[]>([]);
  const [reminders, setReminders] = useState<ReminderDueSummary[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [synthesis, setSynthesis] = useState<CoachingSynthesis | null>(null);
  // The life-areas covered by active DEPTH invitations — a synthesis observation for the same area yields
  // to the more specific, actionable nudge (§3.7).
  const [freshnessAreas, setFreshnessAreas] = useState<string[]>([]);
  // Auto check-ins (63): how many auto-generated check-ins are waiting to answer + the one-time seed marker.
  const [autoPending, setAutoPending] = useState(0);
  const [autoSeededAt, setAutoSeededAt] = useState<string | null>(null);
  // Your Story (64 §3.6): books shared WITH the active person — the never-opened ones drive the one-time
  // "shared with you" notification (the "Updated" marker lives on the /story card, not the bell).
  const [sharedBooks, setSharedBooks] = useState<SharedBookSummary[]>([]);

  // One-shot reads per active person. Guarded so a fetch resolving after a person switch is ignored.
  useEffect(() => {
    let active = true;
    setSuggestionIds([]);
    setResponses([]);
    setAnswerEdits([]);
    setReminders([]);
    setGoals([]);
    setChallenges([]);
    setSynthesis(null);
    setFreshnessAreas([]);
    setAutoPending(0);
    setAutoSeededAt(null);
    setSharedBooks([]);
    void (async () => {
      const [sugg, resp, edits, rem, gls, chs, syn, inbox, autoConfig, shared] = await Promise.all([
        canIntake
          ? (window.selfos?.profileSuggestions() ?? Promise.resolve([]))
          : Promise.resolve([]),
        canViewResults
          ? (window.selfos?.notificationsResponsesArrived() ?? Promise.resolve([]))
          : Promise.resolve([]),
        canViewResults
          ? (window.selfos?.notificationsAnswersUpdated() ?? Promise.resolve([]))
          : Promise.resolve([]),
        canViewResults
          ? (window.selfos?.notificationsRemindersDue() ?? Promise.resolve([]))
          : Promise.resolve([]),
        canMemory ? (window.selfos?.goalsList() ?? Promise.resolve([])) : Promise.resolve([]),
        canChallenges
          ? (window.selfos?.challengesList() ?? Promise.resolve([]))
          : Promise.resolve([]),
        canSessions
          ? (window.selfos?.coachingGetSynthesis() ?? Promise.resolve(null))
          : Promise.resolve(null),
        canAnswer
          ? (window.selfos?.assignmentsInbox() ?? Promise.resolve([]))
          : Promise.resolve([]),
        canAutoCheckin
          ? (window.selfos?.autoCheckinsGetConfig() ?? Promise.resolve(null))
          : Promise.resolve(null),
        canStory ? (window.selfos?.storySharedBooks() ?? Promise.resolve([])) : Promise.resolve([]),
      ]);
      if (!active || useSessionStore.getState().activePerson?.id !== activePersonId) return;
      setSuggestionIds(sugg.map((s) => s.id).sort());
      setFreshnessAreas(sugg.map((s) => s.lifeArea).filter((a): a is string => Boolean(a)));
      setResponses(resp);
      setAnswerEdits(edits);
      setReminders(rem);
      setGoals(gls);
      setChallenges(chs);
      setSynthesis(syn);
      setAutoPending(inbox.filter((i) => i.autoCheckin && i.answerable).length);
      // The one-time seed notice only while it's still on (turning it off = they've engaged, no notice).
      setAutoSeededAt(autoConfig?.enabled ? (autoConfig.seededAt ?? null) : null);
      setSharedBooks(shared);
    })();
    return () => {
      active = false;
    };
  }, [
    activePersonId,
    canIntake,
    canViewResults,
    canMemory,
    canSessions,
    canChallenges,
    canAnswer,
    canAutoCheckin,
    canStory,
  ]);

  // Rebuild the candidate list whenever any source changes; conflicts arrive reactively via the prop.
  useEffect(() => {
    const candidates: NotificationCandidate[] = [];

    if (update?.isUpdateAvailable) {
      candidates.push({
        kind: 'update-available',
        coalesceKey: 'update-available', // app-global slot (the bridge persists its read/dismissed globally)
        signature: update.latest, // a still-newer version changes it and re-surfaces (onChange, §11)
        title: `SelfOS ${update.latest} is available`,
        body: `You're on ${update.current}.`,
        action: { type: 'external', url: update.releaseUrl },
      });
    }

    if (conflicts.length > 0) {
      candidates.push({
        kind: 'sync-conflict',
        coalesceKey: 'sync-conflict',
        signature: String(conflicts.length),
        title: 'Sync conflicts found',
        body:
          conflicts.length === 1
            ? 'A sync conflict copy was found in your vault.'
            : `${conflicts.length} sync conflict copies were found in your vault.`,
        action: { type: 'reveal-vault' },
      });
    }

    if (suggestionIds.length > 0) {
      candidates.push({
        kind: 'profile-freshness',
        coalesceKey: 'profile-freshness',
        // The set of suggestion ids — a brand-new suggestion changes it and re-surfaces (§11).
        signature: suggestionIds.join(','),
        title: 'Profile updates to review',
        body:
          suggestionIds.length === 1
            ? 'A profile update was noticed from your recent activity.'
            : `${suggestionIds.length} profile updates were noticed from your recent activity.`,
        action: { type: 'navigate', to: '/' },
      });
    }

    for (const r of responses) {
      // "Seen" = opening that questionnaire's Results (38 §3.1) — the action deep-links straight there
      // (focus + view), and QuestionnaireResults marks this slot read on open.
      const single = r.submittedCount === 1;
      candidates.push({
        kind: 'responses-arrived',
        coalesceKey: `responses-arrived:${r.questionnaireId}`,
        signature: String(r.submittedCount), // a new response → higher count → re-surfaces (§11)
        title: single
          ? `${r.latestRecipientName} answered “${r.title}”`
          : `New responses to “${r.title}”`,
        ...(single ? {} : { body: `${r.submittedCount} responses are ready to review.` }),
        createdAt: r.at,
        action: { type: 'navigate', to: `/questionnaires?focus=${r.questionnaireId}&view=results` },
      });
    }

    for (const e of answerEdits) {
      // A recipient edited + resubmitted after the sender analyzed them (56 §3.2) — nudge a re-analyze. One
      // slot per send; the revision is the re-surface signature (a further edit → higher → re-surfaces).
      candidates.push({
        kind: 'answers-updated',
        coalesceKey: `answers-updated:${e.assignmentId}`,
        signature: String(e.revision),
        title: `${e.recipientName} updated their answers to “${e.title}”`,
        body: 'Re-analyze to refresh what SelfOS learned.',
        createdAt: e.at,
        action: { type: 'navigate', to: `/questionnaires?focus=${e.questionnaireId}&view=results` },
      });
    }

    for (const r of reminders) {
      // A gentle nudge to the SENDER that a send is still unanswered after 7 days (38 §3.3) — it links to
      // Results so they can re-share; it never messages the recipient.
      const single = r.count === 1;
      candidates.push({
        kind: 'reminder-due',
        coalesceKey: `reminder-due:${r.questionnaireId}`,
        signature: String(r.count), // a new unanswered send → higher count → re-surfaces (onIncrease)
        title: single
          ? `${r.recipientName} hasn’t answered “${r.title}” yet`
          : `${r.count} people haven’t answered “${r.title}” yet`,
        body: 'Open it to re-share the link.',
        action: { type: 'navigate', to: `/questionnaires?focus=${r.questionnaireId}&view=results` },
      });
    }

    // A gentle goal check-in (40 §3.2) — at most ONE open at a time (the stalest), coalesced. The action
    // links to the Goals page (57 §3.7) where the goal + its Still on it / Mark done / Let it go actions live;
    // Home's "For you" goal recommendation (53) offers those inline. Acting changes the goal (signature) so a
    // dismissed nudge stays dismissed until the goal changes; resolving the stalest surfaces the next.
    const stale = stalestGoal(goals, new Date());
    if (stale) {
      candidates.push({
        kind: 'goal-followup',
        coalesceKey: 'goal-followup',
        signature: `${stale.id}:${stale.updatedAt}`,
        title: 'A goal worth a check-in',
        body: `You set a goal a while back: “${stale.text}”. Still working on it?`,
        action: { type: 'navigate', to: '/goals' },
      });
    }

    // A gentle "how did your challenge go?" check-in (52 §3.5) when an active challenge's check-in is due —
    // at most ONE open (the due one), coalesced; the action links to Sessions where the challenge card + its
    // I-did-it / Not yet / Reflect live (Home's "For you" challenge-checkin (53) offers those inline). Acting
    // changes the challenge (signature: id + checkInAt) so a dismissed nudge stays dismissed until it changes.
    const dueChallenge = checkInDueChallenge(challenges, new Date());
    if (dueChallenge) {
      candidates.push({
        kind: 'challenge-followup',
        coalesceKey: 'challenge-followup',
        signature: `${dueChallenge.id}:${dueChallenge.checkInAt ?? ''}`,
        title: 'How did your challenge go?',
        body: `You took on: “${dueChallenge.action}”. No pressure — just curious how it went.`,
        action: { type: 'navigate', to: '/sessions' },
      });
    }

    // The cross-feature synthesis observation (40 §3.3) as a nudge — UNLESS a same-life-area depth/freshness
    // invitation is already active (§3.7: the more specific, actionable nudge wins, so the user sees one
    // coherent prompt about that area). Home's "For you" synthesis recommendation (53) is the persistent
    // action surface; this is the transient alert (the card+notification coexistence precedent, 17 §11).
    if (synthesis && !(synthesis.lifeArea && freshnessAreas.includes(synthesis.lifeArea))) {
      candidates.push({
        kind: 'coaching-synthesis',
        coalesceKey: 'coaching-synthesis',
        signature: synthesis.computedAt, // a newer synthesis supersedes a dismissed one (onChange)
        title: 'Something I’m noticing',
        body: synthesis.observation,
        createdAt: synthesis.computedAt,
        action: { type: 'navigate', to: '/' },
      });
    }

    // Completed onboarding has genuinely-new or unfinished questions (55 §3.1) — a calm, dismissible invitation
    // to fill in more of the profile. Only after onboarding is COMPLETE (first-run is already gated into the
    // flow); the "new + inProgress" rule keeps it from nagging about the whole un-started invited catalog.
    if (canIntake && intake && intake.session.status === 'complete') {
      const attention = attentionFromIntakeState(intake);
      if (attention.total > 0) {
        const areas = attention.areas.length;
        candidates.push({
          kind: 'onboarding-updated',
          coalesceKey: 'onboarding-updated',
          signature: String(attention.total), // more outstanding → re-surfaces (onIncrease); fewer never does
          title: 'More of your profile to fill in',
          body:
            areas === 1
              ? 'You have unanswered onboarding questions in 1 area — including anything added in recent updates.'
              : `You have unanswered onboarding questions in ${areas} areas — including anything added in recent updates.`,
          action: { type: 'navigate', to: '/onboarding' },
        });
      }
    }

    // Together invitations + your-turn nudges (58 §3.11), derived from the projection-computed summaries.
    if (canTogether) {
      candidates.push(...togetherNotificationCandidates(togetherSessions, activePersonId));
    }

    // Auto check-ins (63): a gentle "a reflection is ready" + the one-time "it's now on" seed notice.
    if (autoPending > 0) {
      candidates.push({
        kind: 'auto-checkin-ready',
        coalesceKey: 'auto-checkin-ready',
        signature: String(autoPending), // a new one → higher count → re-surfaces; answering some never re-pops
        title:
          autoPending === 1
            ? 'A new reflection is ready'
            : `${autoPending} new reflections are ready`,
        body: 'SelfOS created a check-in for you from what it’s learned.',
        action: { type: 'navigate', to: '/inbox' },
      });
    }
    if (autoSeededAt) {
      candidates.push({
        kind: 'auto-checkin-enabled',
        coalesceKey: 'auto-checkin-enabled',
        signature: autoSeededAt, // fires once (write-once seed); once dismissed it never returns
        title: 'Auto check-ins is now on',
        body: 'SelfOS will create the occasional check-in for you — manage it under Questionnaires.',
        action: { type: 'navigate', to: '/questionnaires' },
      });
    }

    // A Story book shared with you (64 §3.6) — one notification per NEVER-OPENED book, the first-share cue.
    // Opening it records read progress → the book drops from `neverOpened` → the notification clears and never
    // re-pops (later republishes surface only as the quiet "Updated" marker on the /story card, not the bell).
    for (const book of sharedBooks) {
      if (!book.neverOpened) continue;
      candidates.push({
        kind: 'story-shared',
        coalesceKey: `story-shared:${book.authorPersonId}:${book.bookId}`,
        signature: book.bookId, // stable per book — a dismissal without opening stays dismissed
        title: `${book.authorName} shared their story`,
        body: `“${book.title}” is ready for you to read.`,
        action: { type: 'navigate', to: '/story' },
      });
    }

    setCandidates(candidates);
  }, [
    conflicts,
    suggestionIds,
    responses,
    answerEdits,
    reminders,
    goals,
    challenges,
    synthesis,
    freshnessAreas,
    update,
    canIntake,
    intake,
    canTogether,
    togetherSessions,
    autoPending,
    autoSeededAt,
    sharedBooks,
    activePersonId,
    setCandidates,
  ]);
}

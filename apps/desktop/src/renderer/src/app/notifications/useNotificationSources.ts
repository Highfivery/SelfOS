import { useEffect, useState } from 'react';
import type { ReminderDueSummary, ResponsesArrivedSummary } from '@shared/channels';
import type { CoachingSynthesis, Goal } from '@shared/schemas';
import { useSessionStore } from '../../stores/sessionStore';
import { useNotificationStore } from '../../stores/notificationStore';
import { useUpdateStore } from '../../stores/updateStore';
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
  const setCandidates = useNotificationStore((s) => s.setCandidates);
  // The update result is app-global (NOT per-person) — it survives a person switch (36 §11).
  const update = useUpdateStore((s) => s.result);

  const [suggestionIds, setSuggestionIds] = useState<string[]>([]);
  const [responses, setResponses] = useState<ResponsesArrivedSummary[]>([]);
  const [reminders, setReminders] = useState<ReminderDueSummary[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [synthesis, setSynthesis] = useState<CoachingSynthesis | null>(null);
  // The life-areas covered by active DEPTH invitations — a synthesis observation for the same area yields
  // to the more specific, actionable nudge (§3.7).
  const [freshnessAreas, setFreshnessAreas] = useState<string[]>([]);

  // One-shot reads per active person. Guarded so a fetch resolving after a person switch is ignored.
  useEffect(() => {
    let active = true;
    setSuggestionIds([]);
    setResponses([]);
    setReminders([]);
    setGoals([]);
    setSynthesis(null);
    setFreshnessAreas([]);
    void (async () => {
      const [sugg, resp, rem, gls, syn] = await Promise.all([
        canIntake
          ? (window.selfos?.profileSuggestions() ?? Promise.resolve([]))
          : Promise.resolve([]),
        canViewResults
          ? (window.selfos?.notificationsResponsesArrived() ?? Promise.resolve([]))
          : Promise.resolve([]),
        canViewResults
          ? (window.selfos?.notificationsRemindersDue() ?? Promise.resolve([]))
          : Promise.resolve([]),
        canMemory ? (window.selfos?.goalsList() ?? Promise.resolve([])) : Promise.resolve([]),
        canSessions
          ? (window.selfos?.coachingGetSynthesis() ?? Promise.resolve(null))
          : Promise.resolve(null),
      ]);
      if (!active || useSessionStore.getState().activePerson?.id !== activePersonId) return;
      setSuggestionIds(sugg.map((s) => s.id).sort());
      setFreshnessAreas(sugg.map((s) => s.lifeArea).filter((a): a is string => Boolean(a)));
      setResponses(resp);
      setReminders(rem);
      setGoals(gls);
      setSynthesis(syn);
    })();
    return () => {
      active = false;
    };
  }, [activePersonId, canIntake, canViewResults, canMemory, canSessions]);

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
    // links to Memory where the goal + its Still on it / Mark done / Let it go actions live; the Home
    // GoalFollowupCard offers those inline. Acting changes the goal (signature) so a dismissed nudge stays
    // dismissed until the goal changes; resolving the stalest surfaces the next.
    const stale = stalestGoal(goals, new Date());
    if (stale) {
      candidates.push({
        kind: 'goal-followup',
        coalesceKey: 'goal-followup',
        signature: `${stale.id}:${stale.updatedAt}`,
        title: 'A goal worth a check-in',
        body: `You set a goal a while back: “${stale.text}”. Still working on it?`,
        action: { type: 'navigate', to: '/memory' },
      });
    }

    // The cross-feature synthesis observation (40 §3.3) as a nudge — UNLESS a same-life-area depth/freshness
    // invitation is already active (§3.7: the more specific, actionable nudge wins, so the user sees one
    // coherent prompt about that area). The Home InsightOfTheWeekCard is the persistent action surface; this
    // is the transient alert (the profile-freshness card+notification coexistence precedent, 17 §11).
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

    setCandidates(candidates);
  }, [
    conflicts,
    suggestionIds,
    responses,
    reminders,
    goals,
    synthesis,
    freshnessAreas,
    update,
    setCandidates,
  ]);
}

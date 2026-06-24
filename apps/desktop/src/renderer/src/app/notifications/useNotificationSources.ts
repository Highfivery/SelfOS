import { useEffect, useState } from 'react';
import type { ReminderDueSummary, ResponsesArrivedSummary } from '@shared/channels';
import { useSessionStore } from '../../stores/sessionStore';
import { useNotificationStore } from '../../stores/notificationStore';
import { useUpdateStore } from '../../stores/updateStore';
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
  const setCandidates = useNotificationStore((s) => s.setCandidates);
  // The update result is app-global (NOT per-person) — it survives a person switch (36 §11).
  const update = useUpdateStore((s) => s.result);

  const [suggestionIds, setSuggestionIds] = useState<string[]>([]);
  const [responses, setResponses] = useState<ResponsesArrivedSummary[]>([]);
  const [reminders, setReminders] = useState<ReminderDueSummary[]>([]);

  // One-shot reads per active person. Guarded so a fetch resolving after a person switch is ignored.
  useEffect(() => {
    let active = true;
    setSuggestionIds([]);
    setResponses([]);
    setReminders([]);
    void (async () => {
      const [sugg, resp, rem] = await Promise.all([
        canIntake
          ? (window.selfos?.profileSuggestions() ?? Promise.resolve([]))
          : Promise.resolve([]),
        canViewResults
          ? (window.selfos?.notificationsResponsesArrived() ?? Promise.resolve([]))
          : Promise.resolve([]),
        canViewResults
          ? (window.selfos?.notificationsRemindersDue() ?? Promise.resolve([]))
          : Promise.resolve([]),
      ]);
      if (!active || useSessionStore.getState().activePerson?.id !== activePersonId) return;
      setSuggestionIds(sugg.map((s) => s.id).sort());
      setResponses(resp);
      setReminders(rem);
    })();
    return () => {
      active = false;
    };
  }, [activePersonId, canIntake, canViewResults]);

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

    setCandidates(candidates);
  }, [conflicts, suggestionIds, responses, reminders, update, setCandidates]);
}

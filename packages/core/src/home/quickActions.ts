import type { QuickAction } from './schemas';

/**
 * The quick-action dock config (60 §3.1.2), in display order. Each action is capability-gated so the dock
 * never renders a dead starter — `quickActions(caps)` returns only the ones the active person can do.
 */
export const QUICK_ACTIONS: readonly QuickAction[] = [
  {
    id: 'start-session',
    label: 'Start a session',
    hint: 'Talk something through',
    // The Sessions launcher (free-start composer) is what this route lands on — the start surface itself.
    route: '/sessions',
    capability: 'sessions.own',
  },
  {
    id: 'log-dream',
    label: 'Log a dream',
    hint: 'Before it fades',
    // Deep-link straight into the dream composer, not the journal (the route reads `state.compose`).
    route: '/dreams',
    state: { compose: true },
    capability: 'dreams.own',
  },
  {
    id: 'ask-someone',
    label: 'Ask someone',
    hint: 'Send a questionnaire',
    // Open the new-questionnaire start step directly, not the list (the route reads `state.startNew`).
    route: '/questionnaires',
    state: { startNew: true },
    capability: 'questionnaires.create',
  },
  {
    id: 'check-in',
    label: 'Check in',
    hint: 'A 2-minute mood check',
    // Straight into the mood check-in itself (the PHQ-9 take flow), not the You hub.
    route: '/you/phq9/take',
    capability: 'tests.own',
  },
];

/** The dock actions the active person is permitted to take (§3.1.2). Pure. */
export function quickActions(capabilities: Set<string>): QuickAction[] {
  return QUICK_ACTIONS.filter((action) => capabilities.has(action.capability));
}

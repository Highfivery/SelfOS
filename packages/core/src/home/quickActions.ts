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
    route: '/sessions',
    capability: 'sessions.own',
  },
  {
    id: 'log-dream',
    label: 'Log a dream',
    hint: 'Before it fades',
    route: '/dreams',
    capability: 'dreams.own',
  },
  {
    id: 'ask-someone',
    label: 'Ask someone',
    hint: 'Send a questionnaire',
    route: '/questionnaires',
    capability: 'questionnaires.create',
  },
  {
    id: 'check-in',
    label: 'Check in',
    hint: 'A 2-minute mood check',
    route: '/you',
    capability: 'tests.own',
  },
];

/** The dock actions the active person is permitted to take (§3.1.2). Pure. */
export function quickActions(capabilities: Set<string>): QuickAction[] {
  return QUICK_ACTIONS.filter((action) => capabilities.has(action.capability));
}

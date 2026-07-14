import { describe, expect, it } from 'vitest';
import { quickActions } from './quickActions';

describe('quickActions', () => {
  it('returns only actions the person holds the capability for, in display order', () => {
    const caps = new Set(['sessions.own', 'questionnaires.create']);
    const actions = quickActions(caps);
    expect(actions.map((a) => a.id)).toEqual(['start-session', 'ask-someone']);
  });

  it('returns all four when every capability is present', () => {
    const caps = new Set(['sessions.own', 'dreams.own', 'questionnaires.create', 'tests.own']);
    expect(quickActions(caps)).toHaveLength(4);
    // Each links DIRECTLY to its action, not a parent page (§3.1.2).
    expect(quickActions(caps).map((a) => a.route)).toEqual([
      '/sessions',
      '/dreams',
      '/questionnaires',
      '/you/phq9/take',
    ]);
    // The dream + questionnaire actions carry nav state to open their composer/start flow directly.
    expect(quickActions(caps).find((a) => a.id === 'log-dream')?.state).toEqual({ compose: true });
    expect(quickActions(caps).find((a) => a.id === 'ask-someone')?.state).toEqual({
      startNew: true,
    });
  });

  it('returns nothing for a person with no relevant capabilities (no dead actions)', () => {
    expect(quickActions(new Set())).toEqual([]);
  });
});

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
    expect(quickActions(caps).map((a) => a.route)).toEqual([
      '/sessions',
      '/dreams',
      '/questionnaires',
      '/you',
    ]);
  });

  it('returns nothing for a person with no relevant capabilities (no dead actions)', () => {
    expect(quickActions(new Set())).toEqual([]);
  });
});

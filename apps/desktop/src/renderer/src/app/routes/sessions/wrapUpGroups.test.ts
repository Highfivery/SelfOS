import { describe, expect, it } from 'vitest';
import type { InsightFact } from '@shared/schemas';
import { groupWrapUpFacts } from './wrapUpGroups';

function fact(id: string, text: string): InsightFact {
  return { id, text, shareable: false };
}

describe('groupWrapUpFacts', () => {
  it('routes each fact to its section by prefix and strips the prefix from the display text', () => {
    const groups = groupWrapUpFacts([
      fact('1', 'Goal: Send Angel an honest text'),
      fact('2', 'Theme: emotional withdrawal'),
      fact('3', 'Follow-up: How did Angel respond?'),
      fact('4', 'Person mentioned: Angel'),
    ]);
    expect(groups.goals).toEqual([{ id: '1', text: 'Send Angel an honest text' }]);
    expect(groups.themes).toEqual([{ id: '2', text: 'emotional withdrawal' }]);
    expect(groups.followUps).toEqual([{ id: '3', text: 'How did Angel respond?' }]);
    expect(groups.people).toEqual([{ id: '4', text: 'Angel' }]);
    expect(groups.other).toEqual([]);
  });

  it('keeps an unrecognized fact in `other` with its full text (never dropped)', () => {
    const groups = groupWrapUpFacts([
      fact('1', 'Exercise: Thought Record (CBT)'),
      fact('2', 'Feels connected through shared time.'),
    ]);
    expect(groups.other).toEqual([
      { id: '1', text: 'Exercise: Thought Record (CBT)' },
      { id: '2', text: 'Feels connected through shared time.' },
    ]);
    expect(groups.goals).toEqual([]);
  });

  it('preserves order within each section and does not mutate on a prefix substring elsewhere', () => {
    // A theme that merely CONTAINS "Goal:" mid-text must not be mis-routed to goals.
    const groups = groupWrapUpFacts([
      fact('1', 'Theme: fear of naming a Goal: out loud'),
      fact('2', 'Goal: name it out loud'),
    ]);
    expect(groups.themes).toEqual([{ id: '1', text: 'fear of naming a Goal: out loud' }]);
    expect(groups.goals).toEqual([{ id: '2', text: 'name it out loud' }]);
  });

  it('returns empty groups for no facts', () => {
    expect(groupWrapUpFacts([])).toEqual({
      goals: [],
      themes: [],
      followUps: [],
      people: [],
      other: [],
    });
  });
});

import { describe, expect, it } from 'vitest';
import type { Questionnaire } from '@shared/channels';
import { matchesQuery, sentStatusOf, sortSent, type SentEntry } from './sentGrouping';

function q(over: Partial<Questionnaire> = {}): Questionnaire {
  return {
    id: 'q1',
    schemaVersion: 1,
    version: 1,
    title: 'Weekly check-in',
    type: 'general',
    sensitivity: 'standard',
    questions: [],
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...over,
  } as Questionnaire;
}

describe('sentStatusOf', () => {
  it('an unsent questionnaire is a Draft', () => {
    expect(sentStatusOf({ questionnaire: q(), isDraft: true })).toBe('draft');
  });

  it('a sent one with no answers is Awaiting', () => {
    expect(
      sentStatusOf({
        questionnaire: q(),
        isDraft: false,
        sendState: { lastSentAt: '2026-06-10T00:00:00.000Z', total: 1 },
        overview: {
          questionnaireId: 'q1',
          lastSentAt: '2026-06-10T00:00:00.000Z',
          recipients: [{ name: 'A', status: 'sent', answered: false }],
          answeredCount: 0,
          newResponses: 0,
          analyzed: false,
        },
      }),
    ).toBe('awaiting');
  });

  it('answered-but-not-analysed is Answered; fully analysed is Analyzed', () => {
    const base = {
      questionnaire: q(),
      isDraft: false,
      sendState: { lastSentAt: '2026-06-10T00:00:00.000Z', total: 1 },
    };
    expect(
      sentStatusOf({
        ...base,
        overview: {
          questionnaireId: 'q1',
          lastSentAt: '2026-06-10T00:00:00.000Z',
          recipients: [{ name: 'A', status: 'submitted', answered: true }],
          answeredCount: 1,
          newResponses: 1,
          analyzed: false,
          analyzableAssignmentId: 'a1',
        },
      }),
    ).toBe('answered');
    expect(
      sentStatusOf({
        ...base,
        overview: {
          questionnaireId: 'q1',
          lastSentAt: '2026-06-10T00:00:00.000Z',
          recipients: [{ name: 'A', status: 'submitted', answered: true }],
          answeredCount: 1,
          newResponses: 0,
          analyzed: true,
          insightSummary: 'x',
        },
      }),
    ).toBe('analyzed');
  });
});

describe('matchesQuery', () => {
  it('matches on title or type, case-insensitively; blank matches all', () => {
    expect(matchesQuery(q({ title: 'Love languages' }), 'love')).toBe(true);
    expect(matchesQuery(q({ type: 'appreciation' }), 'appreci')).toBe(true);
    expect(matchesQuery(q({ title: 'Money' }), 'weekly')).toBe(false);
    expect(matchesQuery(q(), '')).toBe(true);
  });
});

describe('sortSent', () => {
  const entry = (title: string, favorite: boolean, lastSentAt: string): SentEntry => ({
    questionnaire: q({ title, favorite }),
    isDraft: false,
    sendState: { lastSentAt, total: 1 },
  });

  it('pins favourites first, then sorts by the chosen key', () => {
    const a = entry('Alpha', false, '2026-06-01T00:00:00.000Z');
    const b = entry('Beta', true, '2026-05-01T00:00:00.000Z');
    // Recent → newest first, but the favourite pins to the top regardless of its older send.
    expect(sortSent([a, b], 'recent').map((e) => e.questionnaire.title)).toEqual(['Beta', 'Alpha']);
    // Title A–Z among non-favourites.
    const c = entry('Charlie', false, '2026-04-01T00:00:00.000Z');
    expect(sortSent([c, a], 'title').map((e) => e.questionnaire.title)).toEqual([
      'Alpha',
      'Charlie',
    ]);
  });
});

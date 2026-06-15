import { describe, expect, it } from 'vitest';
import type { IntakeSession } from '../schemas';
import { intakeAnswerHashes, portraitStaleness } from './portraitFreshness';

const session = (over: Partial<IntakeSession> = {}): IntakeSession => ({
  id: 'i1',
  schemaVersion: 1,
  personId: 'p1',
  status: 'inProgress',
  sections: [
    {
      id: 'basics',
      status: 'complete',
      restricted: false,
      messages: [],
      answers: { a: 'hi', b: 2 },
    },
    {
      id: 'health',
      status: 'complete',
      restricted: false,
      messages: [],
      answers: { c: ['x', 'y'] },
    },
  ],
  startedAt: 'now',
  updatedAt: 'now',
  ...over,
});

describe('intakeAnswerHashes', () => {
  it('hashes every filled answer, keyed section.question, ignoring empties + array order', () => {
    const h = intakeAnswerHashes(
      session({
        sections: [
          {
            id: 'basics',
            status: 'complete',
            restricted: false,
            messages: [],
            answers: { a: 'hi', empty: '', list: ['y', 'x'], none: [] },
          },
        ],
      }),
    );
    expect(Object.keys(h).sort()).toEqual(['basics.a', 'basics.list']);
    // Array order doesn't change the hash.
    const h2 = intakeAnswerHashes(
      session({
        sections: [
          {
            id: 'basics',
            status: 'complete',
            restricted: false,
            messages: [],
            answers: { a: 'hi', list: ['x', 'y'] },
          },
        ],
      }),
    );
    expect(h2['basics.list']).toBe(h['basics.list']);
  });
});

describe('portraitStaleness', () => {
  it('is not stale when no portrait has been made yet', () => {
    expect(portraitStaleness(session())).toMatchObject({ hasPortrait: false, stale: false });
  });

  it('is not stale right after a portrait (snapshot matches current)', () => {
    const s = session();
    s.portraitAnswerSig = intakeAnswerHashes(s);
    expect(portraitStaleness(s)).toMatchObject({ hasPortrait: true, stale: false, changed: 0 });
  });

  it('counts added, edited, and cleared answers as changed with a %', () => {
    const s = session();
    s.portraitAnswerSig = intakeAnswerHashes(s); // snapshot: basics.a, basics.b, health.c (3)
    // Edit one (a), add one (d), clear one (b).
    s.sections[0]!.answers = { a: 'changed', d: 'new' };
    const result = portraitStaleness(s);
    // a edited, b cleared, d added → 3 changed; current filled = a, d, c = 3.
    expect(result.changed).toBe(3);
    expect(result.current).toBe(3);
    expect(result.stale).toBe(true);
    expect(result.pct).toBe(100);
  });
});

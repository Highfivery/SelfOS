import { describe, expect, it } from 'vitest';

import {
  mentionsTrafficLight,
  scrubLexiconProse,
  scrubList,
  scrubProse,
  scrubResult,
  scrubTestInsight,
} from './trafficLight';
import { emptyLexicon } from './lexicon';
import type { EroticLexicon, Insight, TestResult } from '../../schemas';

const NOW = new Date('2026-08-22T12:00:00.000Z');

function result(patch: Partial<TestResult>): TestResult {
  return {
    id: 'r1',
    schemaVersion: 1,
    testId: 'dirty-talk',
    testVersion: 1,
    subjectPersonId: 'p1',
    answers: [],
    scores: [],
    kind: 'adaptive',
    status: 'complete',
    takenAt: NOW.toISOString(),
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...patch,
  };
}

describe('74 §3.6.40 — the traffic-light matcher', () => {
  it('catches both removed rows, in either spelling and however the lights are separated', () => {
    for (const text of [
      'colour?',
      'green / amber / red',
      'green, amber, red',
      'green-amber-red',
      'red, amber, green',
      'What is your color right now',
      'we use the traffic light system',
      'traffic-lights',
    ]) {
      expect(mentionsTrafficLight(text), text).toBe(true);
    }
  });

  it('leaves the consent rows that SURVIVED the cut alone', () => {
    // The owner cut two rows, not the family. If the matcher touched these the scrub would be eating the
    // stop-language it was never aimed at.
    for (const text of [
      'is this okay',
      'you can stop me',
      'say the word and I stop',
      'we can stop any time',
      'tell me if it is too much',
      'do you want me to stop',
    ]) {
      expect(mentionsTrafficLight(text), text).toBe(false);
    }
  });

  it('does not fire on green or red alone — only on the three as a run', () => {
    // "red" and "green" are ordinary words in this register ("your face went red"). Only the protocol
    // matches, or the scrub would delete true sentences that mention one light.
    expect(mentionsTrafficLight('your face went red')).toBe(false);
    expect(mentionsTrafficLight('the green dress')).toBe(false);
    expect(mentionsTrafficLight('red and green')).toBe(false);
  });
});

describe('74 §3.6.40 — scrubbing prose', () => {
  it('drops the sentence that names it and keeps the rest of the paragraph', () => {
    const text =
      'You want to be asked. Being checked on with a colour mid-scene lands hard for you. The asking itself is part of it.';
    expect(scrubProse(text)).toBe('You want to be asked. The asking itself is part of it.');
  });

  it('keeps a continuation attached, so a trailing question mark cannot strand a fragment', () => {
    /*
     * The whole reason `sentences()` folds a lowercase segment back: the removed term ENDS IN A QUESTION
     * MARK, so a naive split leaves ", which fits the pattern" behind as its own surviving "sentence".
     */
    const text =
      'You loved being asked colour? mid-scene, which fits the pattern. Nothing else changed.';
    expect(scrubProse(text)).toBe('Nothing else changed.');
  });

  it('preserves paragraph breaks', () => {
    const text = 'First para stands.\n\nA colour check belongs here.\n\nThird para stands.';
    expect(scrubProse(text)).toBe('First para stands.\n\nThird para stands.');
  });

  it('returns empty when every sentence names it, and is idempotent', () => {
    expect(scrubProse('Use a colour check. Green, amber, red.')).toBe('');
    const once = scrubProse('You want asking. A colour check lands.');
    expect(scrubProse(once)).toBe(once);
  });

  it('leaves prose that never names it byte-identical', () => {
    const text = 'Low, close, certain. Not loud.';
    expect(scrubProse(text)).toBe(text);
  });
});

describe('74 §3.6.40 — scrubbing a past take', () => {
  it('scrubs narrative, lede, readings, profile and turns — including the answer they typed themselves', () => {
    const before = result({
      narrative: 'You want asking. A colour check is how you like it. That is the shape of it.',
      lede: 'Green, amber, red.',
      readings: [
        { kind: 'pattern', text: 'You like the colour system.' },
        { kind: 'gap', text: 'You freeze on the filthier end.' },
      ],
      profile: {
        registers: {},
        contexts: { during: { heat: 0.8, note: 'colour checks mid-scene' } },
        themes: ['being asked', 'green / amber / red'],
        wantsToSay: ['cock', 'colour?'],
        voice: 'low and certain',
      },
      turns: [
        {
          phase: 'probe',
          item: {
            id: 'q1',
            pack: 'probe',
            text: 'Does a colour check land?',
            options: ['yes', 'no'],
          },
          answer: 'Yes — I like being asked for a colour. It never breaks the spell.',
          at: NOW.toISOString(),
        },
        {
          phase: 'bank',
          item: { id: 'bank', pack: 'bank', text: '600 entries across 33 families', options: [] },
          answer: 42,
          at: NOW.toISOString(),
        },
      ],
    });

    const { result: after, changed } = scrubResult(before);
    expect(changed).toBe(true);

    expect(after.narrative).toBe('You want asking. That is the shape of it.');
    expect(after.lede).toBeUndefined(); // scrubbed to nothing → absent, not blank
    expect(after.readings?.map((r) => r.kind)).toEqual(['gap']);
    expect(after.profile?.themes).toEqual(['being asked']);
    expect(after.profile?.wantsToSay).toEqual(['cock']);
    expect(after.profile?.contexts['during']).toEqual({ heat: 0.8 });
    expect(after.profile?.voice).toBe('low and certain');

    // The generated question goes; so does the matching sentence of the answer the PERSON typed (owner
    // decision, "everything, including my own answers"). Sentence-level there too, so the rest of what they
    // said survives rather than the whole answer being thrown away.
    expect(after.turns?.[0]?.item.text).toBe('');
    expect(after.turns?.[0]?.answer).toBe('It never breaks the spell.');
    // A non-string answer can never carry prose and is untouched — the marking pass's mark COUNT.
    expect(after.turns?.[1]?.answer).toBe(42);
    expect(after.turns?.[1]?.item.text).toBe('600 entries across 33 families');
  });

  it('drops a typed answer entirely when the whole of it named the protocol', () => {
    const after = scrubResult(
      result({
        turns: [
          {
            phase: 'probe',
            item: { id: 'q1', pack: 'probe', text: 'Does it land?', options: [] },
            answer: 'Only with a colour check.',
            at: NOW.toISOString(),
          },
        ],
      }),
    ).result;
    // Absent, not blank — the same state the schema already uses for "asked, not yet answered", which
    // `isAnsweredTurn` already handles.
    expect(after.turns?.[0]?.answer).toBeUndefined();
  });

  it("UNSETS a take's voice too, for the same reason", () => {
    const after = scrubResult(
      result({
        profile: {
          registers: {},
          contexts: {},
          themes: [],
          wantsToSay: [],
          voice: 'Use the colour system.',
        },
      }),
    ).result;
    expect(after.profile?.voice).toBeUndefined();
  });

  it('is a no-op — and returns the same object — for a take that never mentioned it', () => {
    const clean = result({ narrative: 'You want asking.', turns: [] });
    const out = scrubResult(clean);
    expect(out.changed).toBe(false);
    expect(out.result).toBe(clean);
  });

  it('is idempotent', () => {
    const once = scrubResult(
      result({ narrative: 'A colour check lands. You want asking.' }),
    ).result;
    expect(scrubResult(once).changed).toBe(false);
  });
});

describe('74 §3.6.40 — scrubbing the living lexicon prose', () => {
  function seeded(): EroticLexicon {
    return {
      ...emptyLexicon('p1', NOW),
      themes: ['being asked', 'colour checks'],
      // The one that matters most: it feeds `goalSuggestService` AND becomes a partner-shared Insight fact,
      // and no control in the app can remove an item from it.
      wantsToSay: ['cock', 'green / amber / red'],
      voice: 'Low and close. Ask for a colour when it gets heavy.',
      contexts: { during: { heat: 0.9, note: 'colour checks land' }, after: { heat: 0.3 } },
    };
  }

  it('drops the goal, the theme and the context note, and trims the voice', () => {
    const { lexicon, changed } = scrubLexiconProse(seeded());
    expect(changed).toBe(true);
    expect(lexicon.themes).toEqual(['being asked']);
    expect(lexicon.wantsToSay).toEqual(['cock']);
    expect(lexicon.voice).toBe('Low and close.');
    expect(lexicon.contexts['during']).toEqual({ heat: 0.9 });
    expect(lexicon.contexts['after']).toEqual({ heat: 0.3 });
  });

  it('UNSETS a voice whose every sentence named it — a conditional spread cannot clear what was spread in', () => {
    const { lexicon } = scrubLexiconProse({
      ...emptyLexicon('p1', NOW),
      voice: 'Ask for a colour when it gets heavy.',
    });
    expect(lexicon.voice).toBeUndefined();
  });

  it('is a no-op for a lexicon that never mentioned it', () => {
    const clean = { ...emptyLexicon('p1', NOW), themes: ['being asked'] };
    const out = scrubLexiconProse(clean);
    expect(out.changed).toBe(false);
    expect(out.lexicon).toBe(clean);
  });
});

describe('74 §3.6.40 — scrubbing the derived Insight', () => {
  function insight(source: Insight['source'], text: string): Insight {
    return {
      id: 'i1',
      schemaVersion: 1,
      source,
      subjectPersonId: 'p1',
      summary: 'The language you want in bed.',
      facts: [
        { id: 'f1', text, shareable: false },
        { id: 'f2', text: 'Loves to hear: mine, good girl.', shareable: false },
      ],
      confidence: 'high',
      approved: true,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    } as Insight;
  }

  it('drops a test fact that names it', () => {
    const { insight: out, changed } = scrubTestInsight(
      insight('test', 'Wants to be able to say (but freezes): colour?.'),
    );
    expect(changed).toBe(true);
    expect(out.facts.map((f) => f.id)).toEqual(['f2']);
  });

  it('leaves every OTHER kind of insight alone — "colour" is an ordinary word in ordinary life data', () => {
    const portrait = insight('intake', 'Her favourite colour is green.');
    const out = scrubTestInsight(portrait);
    expect(out.changed).toBe(false);
    expect(out.insight).toBe(portrait);
  });
});

describe('74 §3.6.40 — scrubList', () => {
  it('drops whole items, since a goal or a theme has no sentence to keep', () => {
    expect(scrubList(['cock', 'colour?', 'mine'])).toEqual(['cock', 'mine']);
  });
});

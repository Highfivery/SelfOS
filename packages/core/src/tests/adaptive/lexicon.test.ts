import { describe, expect, it } from 'vitest';

import { memFileSystem } from '../../host/memFileSystem';
import type { EroticLexicon } from '../../schemas';
import { DIRTY_TALK_BANK } from './instruments/dirtyTalkBank';
import {
  addBoundary,
  addCustomEntry,
  applyBankMarks,
  applyDirections,
  clearState,
  derivedWantsToSay,
  emptyLexicon,
  lovedEntries,
  mergeLexicons,
  readLexicon,
  suppressedTexts,
  violatesBoundary,
  writeLexicon,
} from './lexicon';

const NOW = new Date('2026-08-16T12:00:00.000Z');
const LATER = new Date('2026-08-17T12:00:00.000Z');
const KEY = new Uint8Array(32).fill(7);

const GOOD_GIRL = 'names-power:good-girl';
const WHORE = 'names-degrading:whore';
const CUNT = 'anatomy-her:cunt';

function seeded(): EroticLexicon {
  return applyBankMarks(
    emptyLexicon('p1', NOW),
    DIRTY_TALK_BANK,
    { [GOOD_GIRL]: 'love', [WHORE]: 'never', [CUNT]: 'okay' },
    'take:1',
    NOW,
  );
}

describe('the erotic lexicon (74 §4.4)', () => {
  it('applies pass-1 marks: love seeds both directions, a no zeroes and records a boundary', () => {
    const lex = seeded();
    const byKey = new Map(lex.entries.map((entry) => [entry.key, entry]));
    expect(byKey.get(GOOD_GIRL)).toMatchObject({ hear: 3, say: 3, state: undefined });
    expect(byKey.get(WHORE)).toMatchObject({ hear: 0, say: 0, state: 'never' });
    expect(byKey.get(CUNT)).toMatchObject({ hear: 0, say: 0, state: 'okay' });
    // A `never` becomes a GLOBAL boundary, which is what every consumer suppresses on.
    expect(lex.boundaries.map((b) => b.text)).toEqual(['whore']);
    // `notYet` is NOT a boundary — it is coachable material, not a hard no.
    expect(suppressedTexts(lex)).toEqual(['whore']);
  });

  it('leaves everything unmarked genuinely unrated — never read as a no', () => {
    const lex = seeded();
    // Only the three marked entries exist at all; the other ~1,100 are absent, not zeroed.
    expect(lex.entries).toHaveLength(3);
  });

  it('never lets a mark or a split lift a hard no', () => {
    const lex = seeded();
    const reMarked = applyBankMarks(lex, DIRTY_TALK_BANK, { [WHORE]: 'love' }, 'take:2', LATER);
    expect(reMarked.entries.find((e) => e.key === WHORE)).toMatchObject({
      state: 'never',
      hear: 0,
    });
    const split = applyDirections(reMarked, { [WHORE]: { hear: 4, say: 4 } }, LATER);
    expect(split.entries.find((e) => e.key === WHORE)).toMatchObject({
      state: 'never',
      hear: 0,
      say: 0,
    });
  });

  it('lifts a boundary ONLY through an explicit clear, which drops the suppression with it', () => {
    const cleared = clearState(seeded(), WHORE, LATER);
    expect(cleared.entries.find((e) => e.key === WHORE)?.state).toBeUndefined();
    expect(suppressedTexts(cleared)).toEqual([]);
  });

  it('applies the pass-2 hear/say split, clamped', () => {
    const lex = applyDirections(seeded(), { [GOOD_GIRL]: { hear: 4, say: 9 } }, LATER);
    expect(lex.entries.find((e) => e.key === GOOD_GIRL)).toMatchObject({ hear: 4, say: 4 });
  });

  it('merges last-write-wins on ratings, but a `never` from EITHER side survives and boundaries union', () => {
    const mine = seeded();
    const theirs = addBoundary(
      applyBankMarks(
        emptyLexicon('p1', LATER),
        DIRTY_TALK_BANK,
        { [GOOD_GIRL]: 'love', 'anatomy-her:tits': 'love' },
        'take:2',
        LATER,
      ),
      { text: 'anything about being used', kind: 'theme' },
      LATER,
    );
    const merged = mergeLexicons(mine, theirs);
    // The newer side never marked `whore` at all — the hard no still survives the merge.
    expect(merged.entries.find((e) => e.key === WHORE)?.state).toBe('never');
    expect(new Set(merged.boundaries.map((b) => b.text))).toEqual(
      new Set(['whore', 'anything about being used']),
    );
    expect(merged.entries.find((e) => e.key === 'anatomy-her:tits')).toBeDefined();
  });

  it('suppresses a candidate line that touches any boundary', () => {
    const lex = addBoundary(seeded(), { text: 'daddy', kind: 'word' }, NOW);
    expect(violatesBoundary(lex, 'You filthy whore')).toBe(true);
    expect(violatesBoundary(lex, 'yes daddy, please')).toBe(true);
    expect(violatesBoundary(lex, 'good girl, just like that')).toBe(false);
  });

  it('derives the wants-to-say goal list from the hear/say GAP alone (74 §3.6.2)', () => {
    const lex = applyDirections(seeded(), { [GOOD_GIRL]: { hear: 4, say: 0 } }, LATER);
    const goals = derivedWantsToSay(lex);
    expect(goals).toContain('good girl'); // loves hearing it, can't say it — the whole signal
    // The middle mark is a MILD YES now, not "I'd feel like an idiot", so it is not a goal.
    expect(goals).not.toContain('cunt');
    expect(goals).not.toContain('whore'); // a hard no is never a goal
  });

  it('ranks loved entries and never surfaces a boundary among them', () => {
    const lex = applyDirections(seeded(), { [GOOD_GIRL]: { hear: 4, say: 1 } }, LATER);
    expect(lovedEntries(lex, 'hear').map((e) => e.text)).toEqual(['good girl']);
    expect(lovedEntries(lex, 'say')).toEqual([]);
  });

  it('takes their own words as a custom entry, once', () => {
    const once = addCustomEntry(
      emptyLexicon('p1', NOW),
      { text: 'wreck me', family: 'demands-receiving', kind: 'phrase' },
      'take:1',
      NOW,
    );
    const twice = addCustomEntry(
      once,
      { text: 'wreck me', family: 'demands-receiving', kind: 'phrase' },
      'take:1',
      NOW,
    );
    expect(twice.entries).toHaveLength(1);
    expect(twice.entries[0]).toMatchObject({ text: 'wreck me', custom: true });
  });

  it('round-trips through the encrypted vault, and degrades to empty when absent or corrupt', async () => {
    const fs = memFileSystem();
    expect((await readLexicon(fs, KEY, 'p1', NOW)).entries).toEqual([]);
    await writeLexicon(fs, KEY, seeded());
    const read = await readLexicon(fs, KEY, 'p1', NOW);
    expect(read.entries).toHaveLength(3);
    expect(read.boundaries.map((b) => b.text)).toEqual(['whore']);
    // A corrupt doc must never throw out of the surface that depends on it.
    await fs.writeAtomic('people/p1/tests/lexicon.enc', new TextEncoder().encode('not json'));
    expect((await readLexicon(fs, KEY, 'p1', NOW)).entries).toEqual([]);
  });

  it('refuses an unsafe person id rather than writing outside the vault', async () => {
    const fs = memFileSystem();
    const bad = { ...emptyLexicon('../escape', NOW) };
    await writeLexicon(fs, KEY, bad);
    expect(await fs.list('people')).toEqual([]);
  });
});

describe('boundary matching (74 §5.7)', () => {
  it('matches a WORD boundary literally and a THEME boundary by its content words', () => {
    let lex = addBoundary(emptyLexicon('p1', NOW), { text: 'whore', kind: 'word' }, NOW);
    lex = addBoundary(lex, { text: 'anything about being used', kind: 'theme' }, NOW);
    // Literal.
    expect(violatesBoundary(lex, 'you filthy whore')).toBe(true);
    // Themed — no substring in common, which is exactly why a substring check isn't enough on its own.
    expect(violatesBoundary(lex, 'I love using you')).toBe(true);
    expect(violatesBoundary(lex, 'use me')).toBe(true);
    // …and it doesn't swallow everything: an unrelated line passes.
    expect(violatesBoundary(lex, 'good girl, just like that')).toBe(false);
  });
});

describe('a hard no is unliftable (74 §3.2 — the invariant the feature rests on)', () => {
  it('cannot be downgraded by ANY mark, not just by love', () => {
    const lex = seeded();
    for (const mark of ['love', 'okay'] as const) {
      const after = applyBankMarks(lex, DIRTY_TALK_BANK, { [WHORE]: mark }, 'take:2', LATER);
      expect(after.entries.find((e) => e.key === WHORE)?.state).toBe('never');
      expect(suppressedTexts(after)).toContain('whore');
    }
  });

  it('never appears in the goal list, however it was marked', () => {
    // The path that used to leak: never → notYet put the word in `wantsToSay`, which reaches their own coach
    // prompt as something to PRACTISE, two lines under "never use this".
    const downgraded = applyBankMarks(seeded(), DIRTY_TALK_BANK, { [WHORE]: 'okay' }, 'e', LATER);
    expect(derivedWantsToSay(downgraded)).not.toContain('whore');
  });

  it('matches a literal boundary on word boundaries, so a short word cannot suppress everything', () => {
    const lex = addBoundary(emptyLexicon('p1', NOW), { text: 'ass', kind: 'word' }, NOW);
    expect(violatesBoundary(lex, 'that ass')).toBe(true);
    expect(violatesBoundary(lex, 'pass me the water')).toBe(false);
    expect(violatesBoundary(lex, 'a class act')).toBe(false);
  });
});

describe('74 §3.6.6 — a side that was never asked is not a refusal', () => {
  const base = {
    key: 'names-power:good-girl',
    text: 'good girl',
    kind: 'word' as const,
    family: 'names-power',
    tier: 2,
    hear: 4,
    say: 0,
  };

  it('does NOT turn a loved HEAR-ONLY entry into a goal the person never declined', () => {
    // The failure this guards: goals reach their own coach prompt AND a partner-shared Insight fact, so a
    // fabricated one is not a cosmetic bug — it invents a want and then shares it.
    const lexicon = {
      ...emptyLexicon('p1', NOW),
      entries: [{ ...base, sides: ['hear' as const] }],
    };
    expect(derivedWantsToSay(lexicon)).toEqual([]);
  });

  it('still derives the goal when BOTH sides were actually asked', () => {
    const lexicon = {
      ...emptyLexicon('p1', NOW),
      entries: [{ ...base, sides: ['hear' as const, 'say' as const] }],
    };
    expect(derivedWantsToSay(lexicon)).toEqual(['good girl']);
  });

  it('treats a pre-orientation entry (no `sides`) as both-asked, which is what it was', () => {
    const lexicon = { ...emptyLexicon('p1', NOW), entries: [base] };
    expect(derivedWantsToSay(lexicon)).toEqual(['good girl']);
  });

  it('records the sides it showed, so the take is the record of what was asked', () => {
    const marked = applyBankMarks(
      emptyLexicon('p1', NOW),
      DIRTY_TALK_BANK,
      { 'names-power:good-girl': 'love' },
      'test:r1',
      NOW,
      { 'names-power:good-girl': ['say'] },
    );
    expect(marked.entries[0]?.sides).toEqual(['say']);
  });
});
describe('mergeLexicons keeps what was ASKED (74 §3.6.6)', () => {
  it('does not let an older device drop `sides` — that would recreate the fabricated goal', () => {
    // A device on a pre-orientation build writes entries with no `sides`. Spreading the newer entry alone
    // dropped the record of what was offered, and an entry with no `sides` reads as both-sides-asked — so a
    // loved hear-only entry becomes a goal the person never declined, in their own coach's prompt.
    const withSides: EroticLexicon = {
      ...emptyLexicon('p1', new Date('2026-08-01T00:00:00.000Z')),
      entries: [
        {
          key: 'names-power:good-girl',
          text: 'good girl',
          kind: 'word',
          family: 'names-power',
          tier: 2,
          hear: 4,
          say: 0,
          sides: ['hear'],
        },
      ],
    };
    const older = { ...withSides, updatedAt: '2026-08-01T00:00:00.000Z' };
    const newerNoSides: EroticLexicon = {
      ...withSides,
      updatedAt: '2026-08-02T00:00:00.000Z',
      entries: [{ ...withSides.entries[0]!, sides: undefined }],
    };
    const merged = mergeLexicons(older, newerNoSides);
    expect(merged.entries[0]?.sides).toEqual(['hear']);
    // …and the consequence that actually matters: it is still not a goal.
    expect(derivedWantsToSay(merged)).toEqual([]);
  });

  it('takes the newer answer when BOTH sides recorded one', () => {
    const base = emptyLexicon('p1', new Date('2026-08-01T00:00:00.000Z'));
    const entry = {
      key: 'names-power:good-girl',
      text: 'good girl',
      kind: 'word' as const,
      family: 'names-power',
      tier: 2 as const,
      hear: 4,
      say: 4,
    };
    const older: EroticLexicon = {
      ...base,
      updatedAt: '2026-08-01T00:00:00.000Z',
      entries: [{ ...entry, sides: ['hear'] }],
    };
    const newer: EroticLexicon = {
      ...base,
      updatedAt: '2026-08-02T00:00:00.000Z',
      entries: [{ ...entry, sides: ['hear', 'say'] }],
    };
    expect(mergeLexicons(older, newer).entries[0]?.sides).toEqual(['hear', 'say']);
  });
});

describe('74 §3.6.8 — a name can be ruled out one way and loved the other', () => {
  const base = (over: Partial<EroticLexicon> = {}): EroticLexicon => ({
    schemaVersion: 1,
    personId: 'p1',
    entries: [],
    registers: {},
    contexts: {},
    themes: [],
    wantsToSay: [],
    boundaries: [],
    updatedAt: 'now',
    ...over,
  });

  const withSlut = base({
    entries: [
      {
        key: 'names-degrading:slut',
        text: 'slut',
        kind: 'word',
        family: 'names-degrading',
        tier: 4,
        hear: 0,
        say: 4,
        // "never call me that" — while loving to call HER that.
        hearState: 'never' as const,
        sayState: 'love' as const,
        source: 'test:r1',
      },
    ],
  });

  it('suppresses it for lines aimed AT them, and not for lines they say', () => {
    expect(violatesBoundary(withSlut, 'that is my slut', 'hear')).toBe(true);
    expect(violatesBoundary(withSlut, 'that is my slut', 'say')).toBe(false);
  });

  it('refuses when the caller cannot say which way the line runs', () => {
    // The strict default: a consumer that does not know the direction is exactly the one that must not
    // be trusted to thread it.
    expect(violatesBoundary(withSlut, 'that is my slut')).toBe(true);
  });

  it('keeps a whole-entry `never` and an old undirected boundary covering BOTH ways', () => {
    const legacy = base({
      entries: [
        {
          key: 'names-degrading:whore',
          text: 'whore',
          kind: 'word',
          family: 'names-degrading',
          tier: 4,
          hear: 0,
          say: 0,
          state: 'never' as const,
          source: 'test:r0',
        },
      ],
      boundaries: [{ text: 'being used', kind: 'theme' as const, at: 'now' }],
    });
    for (const direction of ['hear', 'say'] as const) {
      expect(violatesBoundary(legacy, 'you filthy whore', direction)).toBe(true);
      expect(violatesBoundary(legacy, 'I love using you', direction)).toBe(true);
    }
  });

  it('honours a directional THEME boundary', () => {
    const themed = base({
      boundaries: [
        { text: 'being used', kind: 'theme' as const, at: 'now', direction: 'hear' as const },
      ],
    });
    expect(violatesBoundary(themed, 'I love using you', 'hear')).toBe(true);
    expect(violatesBoundary(themed, 'I love using you', 'say')).toBe(false);
    expect(violatesBoundary(themed, 'I love using you')).toBe(true);
  });
});

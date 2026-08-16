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
    { [GOOD_GIRL]: 'love', [WHORE]: 'never', [CUNT]: 'notYet' },
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
    expect(byKey.get(CUNT)).toMatchObject({ hear: 0, say: 0, state: 'notYet' });
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

  it('derives the wants-to-say goal list from the hear/say gap and every cringe', () => {
    const lex = applyDirections(seeded(), { [GOOD_GIRL]: { hear: 4, say: 0 } }, LATER);
    const goals = derivedWantsToSay(lex);
    expect(goals).toContain('good girl'); // loves hearing it, can't say it
    expect(goals).toContain('cunt'); // marked notYet — "I'd feel like an idiot"
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
    for (const mark of ['love', 'notYet'] as const) {
      const after = applyBankMarks(lex, DIRTY_TALK_BANK, { [WHORE]: mark }, 'take:2', LATER);
      expect(after.entries.find((e) => e.key === WHORE)?.state).toBe('never');
      expect(suppressedTexts(after)).toContain('whore');
    }
  });

  it('never appears in the goal list, however it was marked', () => {
    // The path that used to leak: never → notYet put the word in `wantsToSay`, which reaches their own coach
    // prompt as something to PRACTISE, two lines under "never use this".
    const downgraded = applyBankMarks(seeded(), DIRTY_TALK_BANK, { [WHORE]: 'notYet' }, 'e', LATER);
    expect(derivedWantsToSay(downgraded)).not.toContain('whore');
  });

  it('matches a literal boundary on word boundaries, so a short word cannot suppress everything', () => {
    const lex = addBoundary(emptyLexicon('p1', NOW), { text: 'ass', kind: 'word' }, NOW);
    expect(violatesBoundary(lex, 'that ass')).toBe(true);
    expect(violatesBoundary(lex, 'pass me the water')).toBe(false);
    expect(violatesBoundary(lex, 'a class act')).toBe(false);
  });
});

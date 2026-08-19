import { describe, expect, it } from 'vitest';

import { DIRTY_TALK } from './instruments/dirtyTalk';

import { memFileSystem } from '../../host/memFileSystem';
import type { EroticLexicon } from '../../schemas';
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
  applyNameMarks,
  clearNameMarks,
} from './lexicon';

const NOW = new Date('2026-08-16T12:00:00.000Z');
const LATER = new Date('2026-08-17T12:00:00.000Z');
const KEY = new Uint8Array(32).fill(7);

const GOOD_GIRL = 'names-praise:good-girl';
const WHORE = 'names-rough-heavy:whore';
const CUNT = 'anatomy-her:cunt';

function seeded(): EroticLexicon {
  return applyBankMarks(
    emptyLexicon('p1', NOW),
    DIRTY_TALK.bank,
    { [GOOD_GIRL]: 'love', [WHORE]: 'never', [CUNT]: 'okay' },
    'take:1',
    NOW,
  );
}

describe('the erotic lexicon (74 §4.4)', () => {
  it('applies pass-1 marks: love seeds both directions, a no zeroes and suppresses', () => {
    const lex = seeded();
    const byKey = new Map(lex.entries.map((entry) => [entry.key, entry]));
    expect(byKey.get(GOOD_GIRL)).toMatchObject({ hear: 3, say: 3, state: undefined });
    expect(byKey.get(WHORE)).toMatchObject({ hear: 0, say: 0, state: 'never' });
    expect(byKey.get(CUNT)).toMatchObject({ hear: 0, say: 0, state: 'okay' });
    // A `never` suppresses the word everywhere, derived from the LIVE state — no second record is written,
    // which is what used to make it unliftable (74 §3.2, amended 2026-08-19).
    expect(lex.boundaries).toEqual([]);
    // `notYet`/`okay` are NOT suppressed — they are coachable material, not a refusal.
    expect(suppressedTexts(lex)).toEqual(['whore']);
  });

  it('leaves everything unmarked genuinely unrated — never read as a no', () => {
    const lex = seeded();
    // Only the three marked entries exist at all; the other ~1,100 are absent, not zeroed.
    expect(lex.entries).toHaveLength(3);
  });

  it('lets a later mark lift a no — it is a preference, respected only while it is set', () => {
    const lex = seeded();
    expect(suppressedTexts(lex)).toContain('whore');
    const reMarked = applyBankMarks(lex, DIRTY_TALK.bank, { [WHORE]: 'love' }, 'take:2', LATER);
    expect(reMarked.entries.find((e) => e.key === WHORE)?.state).toBeUndefined();
    // The whole point: the suppression goes WITH the mark, on the very next read.
    expect(suppressedTexts(reMarked)).not.toContain('whore');
    expect(violatesBoundary(reMarked, 'come here, whore')).toBe(false);
  });

  it('still refuses to re-rate a no through the SPLIT pass — that pass rates what was loved', () => {
    const split = applyDirections(seeded(), { [WHORE]: { hear: 4, say: 4 } }, LATER);
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

  it('merges last-write-wins on ratings AND states, and unions the themes', () => {
    const mine = seeded();
    const theirs = addBoundary(
      applyBankMarks(
        emptyLexicon('p1', LATER),
        DIRTY_TALK.bank,
        { [GOOD_GIRL]: 'love', 'anatomy-her:tits': 'love' },
        'take:2',
        LATER,
      ),
      { text: 'anything about being used', kind: 'theme' },
      LATER,
    );
    const merged = mergeLexicons(mine, theirs);
    // The newer side never touched `whore`, so the older side's answer stands.
    expect(merged.entries.find((e) => e.key === WHORE)?.state).toBe('never');
    // Only the theme is a record now; a bank entry's suppression rides its state.
    expect(merged.boundaries.map((b) => b.text)).toEqual(['anything about being used']);
    expect(merged.entries.find((e) => e.key === 'anatomy-her:tits')).toBeDefined();
  });

  it('lets the NEWER side lift a no — never-wins would undo it on the next sync', () => {
    // The exact case: ruled out on an old copy, lifted here. Before `never` became a preference this
    // merged back to `never`, silently undoing the change on whichever device synced second.
    const lifted = applyBankMarks(seeded(), DIRTY_TALK.bank, { [WHORE]: 'love' }, 'take:2', LATER);
    const merged = mergeLexicons(seeded(), lifted);
    expect(merged.entries.find((e) => e.key === WHORE)?.state).toBeUndefined();
    expect(suppressedTexts(merged)).not.toContain('whore');
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
    expect(suppressedTexts(read)).toEqual(['whore']);
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

describe('a hard no is respected while set, and changeable (74 §3.2, amended 2026-08-19)', () => {
  it('is lifted by ANY later mark, and the suppression goes with it', () => {
    const lex = seeded();
    for (const mark of ['love', 'okay'] as const) {
      const after = applyBankMarks(lex, DIRTY_TALK.bank, { [WHORE]: mark }, 'take:2', LATER);
      expect(after.entries.find((e) => e.key === WHORE)?.state).not.toBe('never');
      expect(suppressedTexts(after)).not.toContain('whore');
    }
  });

  it('suppresses for exactly as long as it is set — the half that must not regress', () => {
    const lex = seeded();
    expect(violatesBoundary(lex, 'you filthy whore')).toBe(true);
    expect(suppressedTexts(lex)).toContain('whore');
  });

  it('never appears in the goal list, however it was marked', () => {
    // The path that used to leak: never → notYet put the word in `wantsToSay`, which reaches their own coach
    // prompt as something to PRACTISE, two lines under "never use this".
    const downgraded = applyBankMarks(seeded(), DIRTY_TALK.bank, { [WHORE]: 'okay' }, 'e', LATER);
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
    key: 'names-praise:good-girl',
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
      DIRTY_TALK.bank,
      { 'names-praise:good-girl': 'love' },
      'test:r1',
      NOW,
      { 'names-praise:good-girl': ['say'] },
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
          key: 'names-praise:good-girl',
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
      key: 'names-praise:good-girl',
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
        key: 'names-rough-heavy:slut',
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
          key: 'names-rough-heavy:whore',
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

describe('74 §3.6.8 — the pet-name pass', () => {
  const now = new Date('2026-08-17T10:00:00.000Z');
  const start = (): EroticLexicon => emptyLexicon('p1', now);
  const KEY = 'names-rough-heavy:slut';

  it('writes each direction separately, and derives the ratings the rest of the app reads', () => {
    const lex = applyNameMarks(
      start(),
      DIRTY_TALK.bank,
      { [KEY]: { hear: 'never', say: 'love' } },
      'take:1',
      now,
    );
    const entry = lex.entries.find((e) => e.key === KEY);
    expect(entry).toMatchObject({ hearState: 'never', sayState: 'love', hear: 0 });
    expect(entry?.say).toBeGreaterThanOrEqual(3);
    // Both sides were asked — that is what makes it two marks rather than one.
    expect(entry?.sides).toEqual(['hear', 'say']);
  });

  it('suppresses one DIRECTION only, so the other is untouched', () => {
    const lex = applyNameMarks(
      start(),
      DIRTY_TALK.bank,
      { [KEY]: { hear: 'never', say: 'love' } },
      'take:1',
      now,
    );
    expect(lex.boundaries).toEqual([]);
    expect(violatesBoundary(lex, 'take it, slut', 'hear')).toBe(true);
    expect(violatesBoundary(lex, 'take it, slut', 'say')).toBe(false);
  });

  it('lets a LATER take mark over a no, per direction — nothing is settled for good', () => {
    const first = applyNameMarks(
      start(),
      DIRTY_TALK.bank,
      { [KEY]: { hear: 'never' } },
      'take:1',
      now,
    );
    const second = applyNameMarks(
      first,
      DIRTY_TALK.bank,
      { [KEY]: { hear: 'love' } },
      'take:2',
      now,
    );
    expect(second.entries.find((e) => e.key === KEY)?.hearState).toBe('love');
    expect(violatesBoundary(second, 'take it, slut', 'hear')).toBe(false);
  });

  it('takes back ONE direction, leaving the other standing', () => {
    const lex = applyNameMarks(
      start(),
      DIRTY_TALK.bank,
      { [KEY]: { hear: 'never', say: 'never' } },
      'take:1',
      now,
    );
    const cleared = clearNameMarks(lex, { [KEY]: ['hear'] }, now);
    const entry = cleared.entries.find((e) => e.key === KEY);
    expect(entry?.hearState).toBeUndefined();
    expect(entry?.sayState).toBe('never');
    // The direction they took back stops suppressing; the one they left standing does not.
    expect(violatesBoundary(cleared, 'take it, slut', 'hear')).toBe(false);
    expect(violatesBoundary(cleared, 'take it, slut', 'say')).toBe(true);
  });

  it('lets a LATER sitting take back an earlier mark — a preference is not take-scoped', () => {
    const first = applyNameMarks(
      start(),
      DIRTY_TALK.bank,
      { [KEY]: { say: 'never' } },
      'take:1',
      now,
    );
    const taken = clearNameMarks(first, { [KEY]: ['say'] }, now);
    expect(taken.entries.find((e) => e.key === KEY)?.sayState).toBeUndefined();
    expect(violatesBoundary(taken, 'take it, slut', 'say')).toBe(false);
  });
});

describe('a pet name is a boundary when it ADDRESSES them, not whenever the word appears (74 §8.4)', () => {
  // The bank's name families are full of ordinary English: love · baby · beautiful · angel · treasure ·
  // honey · sweet. Someone who rules out most of the name bank was suppressing so much ordinary language
  // that the lines phase filtered out everything it generated and the synthesis threw away whole narratives
  // for containing the word "love" — reported to them as "nothing usable came back".
  const lexiconWith = (bans: string[]): EroticLexicon => ({
    schemaVersion: 1,
    personId: 'p1',
    entries: bans.map((text, i) => ({
      key: `names-warm:${i}`,
      text,
      kind: 'word' as const,
      family: 'names-warm',
      tier: 1,
      hear: 0,
      say: 0,
      state: 'never' as const,
    })),
    registers: {},
    contexts: {},
    themes: [],
    wantsToSay: [],
    boundaries: bans.map((text) => ({
      text,
      kind: 'word' as const,
      at: '2026-08-18T00:00:00.000Z',
    })),
    updatedAt: '2026-08-18T00:00:00.000Z',
  });

  it('does not suppress the ordinary word', () => {
    const lex = lexiconWith(['love', 'beautiful', 'baby']);
    expect(violatesBoundary(lex, 'I love the sound you make')).toBe(false);
    expect(violatesBoundary(lex, 'you look beautiful like that')).toBe(false);
    expect(violatesBoundary(lex, 'I have wanted this all day')).toBe(false);
  });

  it('still suppresses it as a form of address', () => {
    const lex = lexiconWith(['love', 'baby']);
    expect(violatesBoundary(lex, 'come here, love')).toBe(true);
    expect(violatesBoundary(lex, 'love, come here')).toBe(true);
    expect(violatesBoundary(lex, 'my love')).toBe(true);
    expect(violatesBoundary(lex, "that's it baby, just like that")).toBe(true);
    expect(violatesBoundary(lex, "you're my baby")).toBe(true);
  });

  it('leaves a MULTI-WORD name matching anywhere — it has no innocent use', () => {
    const lex = lexiconWith(['good girl']);
    expect(violatesBoundary(lex, 'you were such a good girl for me')).toBe(true);
    expect(violatesBoundary(lex, 'good girl')).toBe(true);
  });

  it('keeps a CRUDE name family matching anywhere — the word IS the slur', () => {
    const lex: EroticLexicon = {
      ...lexiconWith(['whore']),
      entries: [
        {
          key: 'names-rough-heavy:whore',
          text: 'whore',
          kind: 'word',
          family: 'names-rough-heavy',
          tier: 4,
          hear: 0,
          say: 0,
          state: 'never',
        },
      ],
    };
    expect(violatesBoundary(lex, 'You filthy whore')).toBe(true);
  });

  it('fails CLOSED for a family it has never heard of — a new family must not relax a hard no', () => {
    const lex: EroticLexicon = {
      ...lexiconWith(['gutterslut']),
      entries: [
        {
          key: 'names-brand-new:gutterslut',
          text: 'gutterslut',
          kind: 'word',
          family: 'names-brand-new',
          tier: 5,
          hear: 0,
          say: 0,
          state: 'never',
        },
      ],
    };
    // The relaxation is opt-in by family, so a family added to the bank tomorrow keeps the plain match rather
    // than quietly loosening what someone ruled out.
    expect(violatesBoundary(lex, 'nothing but a gutterslut in the end')).toBe(true);
  });

  it('leaves a non-name ban matching anywhere — only pet names are forms of address', () => {
    const lex: EroticLexicon = {
      ...lexiconWith(['slut']),
      entries: [
        {
          key: 'degradation:slut',
          text: 'slut',
          kind: 'word',
          family: 'degradation',
          tier: 4,
          hear: 0,
          say: 0,
          state: 'never',
        },
      ],
    };
    // Not a name family, so nothing is loosened: the word is off wherever it appears.
    expect(violatesBoundary(lex, 'you little slut of a thing')).toBe(true);
  });
});

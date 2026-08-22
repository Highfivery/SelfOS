import { describe, expect, it } from 'vitest';

import { OPEN_ORIENTATION } from './orientation';
import { DIRTY_TALK } from './instruments/dirtyTalk';

import type { FileSystem } from '../../host';
import { memFileSystem } from '../../host/memFileSystem';
import type { EroticLexicon, LexiconEntry } from '../../schemas';
import {
  addBoundary,
  addCustomEntry,
  dropLegacyWordBoundaries,
  applyDirectionalMarks,
  pruneUnshownMarks,
  resetPreDirectionalDeckMarks,
  derivedWantsToSay,
  emptyLexicon,
  lovedEntries,
  mergeLexicons,
  readLexicon,
  retireDeadKeys,
  resolveLexicon,
  suppressedTexts,
  violatesBoundary,
  writeLexicon,
  clearDirectionalMarks,
} from './lexicon';

const NOW = new Date('2026-08-16T12:00:00.000Z');
const LATER = new Date('2026-08-17T12:00:00.000Z');
const KEY = new Uint8Array(32).fill(7);

const GOOD_GIRL = 'names-praise:good-girl';
const WHORE = 'names-rough-heavy:manwhore';
const CUNT = 'anatomy-her:cunt';

function seeded(): EroticLexicon {
  return applyDirectionalMarks(
    emptyLexicon('p1', NOW),
    DIRTY_TALK.bank,
    {
      [GOOD_GIRL]: { hear: 'love', say: 'love' },
      [WHORE]: { hear: 'never', say: 'never' },
      [CUNT]: { hear: 'okay', say: 'okay' },
    },
    'take:1',
    NOW,
  );
}

const KEY34 = new Uint8Array(32).fill(34);
const NOW34 = new Date('2026-08-20T10:00:00.000Z');

describe('74 §3.6.34 — a mark whose entry has left the bank is retired on EVERY read', () => {
  const write = async (fs: FileSystem, entries: LexiconEntry[]) => {
    await writeLexicon(fs, KEY34, {
      ...emptyLexicon('p34', NOW34),
      entries,
    });
  };
  const row = (
    over: Partial<LexiconEntry> & { key: string; family: string; text: string },
  ): LexiconEntry => ({
    kind: 'word',
    tier: 3,
    hear: 0,
    say: 0,
    ...over,
  });

  it('drops a dead-keyed mark, so its word stops suppressing app-wide with nothing left to lift it', async () => {
    const fs = memFileSystem();
    // A family this bank owns, with a key it no longer has: exactly what a purge leaves behind.
    await write(fs, [
      row({
        key: 'names-rough-heavy:my-long-gone-name',
        family: 'names-rough-heavy',
        text: 'zzquux',
        hearState: 'never',
      }),
    ]);
    const read = await readLexicon(fs, KEY34, 'p34', NOW34);
    expect(read.entries).toEqual([]);
    // The point of the fix: nothing is suppressed on behalf of a row no screen can show.
    expect(suppressedTexts(read)).not.toContain('zzquux');
  });

  it('MOVES the mark when the bank names a survivor, rather than dropping it', async () => {
    const fs = memFileSystem();
    await write(fs, [
      row({
        key: 'names-warm:baby-doll',
        family: 'names-warm',
        text: 'baby doll',
        hearState: 'never',
      }),
    ]);
    const read = await readLexicon(fs, KEY34, 'p34', NOW34);
    expect(read.entries.map((e) => e.key)).toEqual(['names-warm:babydoll']);
    expect(read.entries[0]?.hearState).toBe('never');
  });

  it('leaves ANOTHER instrument’s family and the person’s own write-in alone', async () => {
    const fs = memFileSystem();
    await write(fs, [
      row({
        key: 'some-other-instrument:thing',
        family: 'some-other-instrument',
        text: 'not ours',
        hearState: 'never',
      }),
      row({
        key: 'names-rough-heavy:mine',
        family: 'names-rough-heavy',
        text: 'my own word',
        custom: true,
        hearState: 'never',
      }),
    ]);
    const read = await readLexicon(fs, KEY34, 'p34', NOW34);
    expect(read.entries.map((e) => e.key).sort()).toEqual([
      'names-rough-heavy:mine',
      'some-other-instrument:thing',
    ]);
  });

  it('leaves a LIVE mark exactly as it is, and is idempotent', async () => {
    const fs = memFileSystem();
    const live = row({
      key: 'names-warm:babydoll',
      family: 'names-warm',
      text: 'babydoll',
      hearState: 'love',
    });
    await write(fs, [live]);
    const once = await readLexicon(fs, KEY34, 'p34', NOW34);
    expect(once.entries).toEqual([live]);
    expect(retireDeadKeys(once).changed).toBe(false);
  });
});

describe('the erotic lexicon (74 §4.4)', () => {
  it('derives a rating per direction from the mark, and a no zeroes and suppresses', () => {
    const lex = seeded();
    const byKey = new Map(lex.entries.map((entry) => [entry.key, entry]));
    // love → 4, okay → 2, never → 0, per side, with the mark itself kept alongside (74 §3.6.26).
    expect(byKey.get(GOOD_GIRL)).toMatchObject({
      hear: 4,
      say: 4,
      hearState: 'love',
      sayState: 'love',
    });
    expect(byKey.get(WHORE)).toMatchObject({
      hear: 0,
      say: 0,
      hearState: 'never',
      sayState: 'never',
    });
    expect(byKey.get(CUNT)).toMatchObject({ hear: 2, say: 2, hearState: 'okay', sayState: 'okay' });
    // A `never` suppresses the word everywhere, derived from the LIVE state — no second record is written,
    // which is what used to make it unliftable (74 §3.2, amended 2026-08-19).
    expect(lex.boundaries).toEqual([]);
    // `notYet`/`okay` are NOT suppressed — they are coachable material, not a refusal.
    expect(suppressedTexts(lex)).toEqual(['manwhore']);
  });

  it('leaves everything unmarked genuinely unrated — never read as a no', () => {
    const lex = seeded();
    // Only the three marked entries exist at all; the other ~1,100 are absent, not zeroed.
    expect(lex.entries).toHaveLength(3);
  });

  it('lets a later mark lift a no — it is a preference, respected only while it is set', () => {
    const lex = seeded();
    expect(suppressedTexts(lex)).toContain('manwhore');
    const reMarked = applyDirectionalMarks(
      lex,
      DIRTY_TALK.bank,
      { [WHORE]: { hear: 'love', say: 'love' } },
      'take:2',
      LATER,
    );
    expect(reMarked.entries.find((e) => e.key === WHORE)?.hearState).toBe('love');
    // The whole point: the suppression goes WITH the mark, on the very next read.
    expect(suppressedTexts(reMarked)).not.toContain('manwhore');
    expect(violatesBoundary(reMarked, 'come here, manwhore')).toBe(false);
  });

  it('lifts a no by taking the mark back, which drops the suppression with it', () => {
    const cleared = clearDirectionalMarks(seeded(), { [WHORE]: ['hear', 'say'] }, LATER);
    const entry = cleared.entries.find((e) => e.key === WHORE);
    expect(entry?.hearState).toBeUndefined();
    expect(entry?.sayState).toBeUndefined();
    expect(suppressedTexts(cleared)).toEqual([]);
  });

  it('answers the two directions independently — the whole point of §3.6.26', () => {
    // A word can be loved to hear and ruled out to say. The old deck writer took ONE mark for the entry and
    // a second 0–4 pass to pull them apart, which is the pass nobody reached.
    const lex = applyDirectionalMarks(
      emptyLexicon('p1', NOW),
      DIRTY_TALK.bank,
      { [CUNT]: { hear: 'love', say: 'never' } },
      'take:1',
      NOW,
    );
    expect(lex.entries.find((e) => e.key === CUNT)).toMatchObject({
      hear: 4,
      say: 0,
      hearState: 'love',
      sayState: 'never',
    });
    // ...and only the SAY direction is suppressed: ruling out saying a word never bans hearing it.
    expect(suppressedTexts(lex, 'say')).toContain('cunt');
    expect(suppressedTexts(lex, 'hear')).not.toContain('cunt');
  });

  it('merges last-write-wins on ratings AND states, and unions the themes', () => {
    const mine = seeded();
    const theirs = addBoundary(
      applyDirectionalMarks(
        emptyLexicon('p1', LATER),
        DIRTY_TALK.bank,
        {
          [GOOD_GIRL]: { hear: 'love', say: 'love' },
          'anatomy-her:tits': { hear: 'love', say: 'love' },
        },
        'take:2',
        LATER,
      ),
      { text: 'anything about being used', kind: 'theme' },
      LATER,
    );
    const merged = mergeLexicons(mine, theirs);
    // The newer side never touched `manwhore`, so the older side's answer stands.
    expect(merged.entries.find((e) => e.key === WHORE)?.hearState).toBe('never');
    // Only the theme is a record now; a bank entry's suppression rides its state.
    expect(merged.boundaries.map((b) => b.text)).toEqual(['anything about being used']);
    expect(merged.entries.find((e) => e.key === 'anatomy-her:tits')).toBeDefined();
  });

  it('lets the NEWER side lift a no — never-wins would undo it on the next sync', () => {
    // The exact case: ruled out on an old copy, lifted here. Before `never` became a preference this
    // merged back to `never`, silently undoing the change on whichever device synced second.
    const lifted = applyDirectionalMarks(
      seeded(),
      DIRTY_TALK.bank,
      { [WHORE]: { hear: 'love', say: 'love' } },
      'take:2',
      LATER,
    );
    const merged = mergeLexicons(seeded(), lifted);
    expect(merged.entries.find((e) => e.key === WHORE)?.hearState).toBe('love');
    expect(suppressedTexts(merged)).not.toContain('manwhore');
  });

  it('suppresses a candidate line that touches any boundary', () => {
    // Both suppressions come from a live MARK (74 §3.6.29 — a `kind:'word'` record can no longer exist).
    const lex = applyDirectionalMarks(
      seeded(),
      DIRTY_TALK.bank,
      { 'names-hard-power:daddy': { hear: 'never', say: 'never' } },
      'take:2',
      LATER,
    );
    expect(violatesBoundary(lex, 'You filthy manwhore')).toBe(true);
    expect(violatesBoundary(lex, 'yes daddy, please')).toBe(true);
    expect(violatesBoundary(lex, 'good girl, just like that')).toBe(false);
  });

  it('derives the wants-to-say goal list from the hear/say GAP alone (74 §3.6.2)', () => {
    const lex = applyDirectionalMarks(
      seeded(),
      DIRTY_TALK.bank,
      { [GOOD_GIRL]: { hear: 'love', say: 'okay' } },
      'take:2',
      LATER,
    );
    const goals = derivedWantsToSay(lex);
    // Loves hearing it; saying it is only okay — the one gap three marks can express (74 §3.6.26).
    expect(goals).toContain('good girl');
    // The middle mark is a MILD YES now, not "I'd feel like an idiot", so it is not a goal.
    expect(goals).not.toContain('cunt');
    expect(goals).not.toContain('manwhore'); // a hard no is never a goal
  });

  it('ranks loved entries and never surfaces a boundary among them', () => {
    const lex = applyDirectionalMarks(
      seeded(),
      DIRTY_TALK.bank,
      { [GOOD_GIRL]: { hear: 'love', say: 'okay' } },
      'take:2',
      LATER,
    );
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
    expect(suppressedTexts(read)).toEqual(['manwhore']);
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
  it('matches a marked term literally and a THEME boundary by its content words', () => {
    // The literal half is a live mark; the themed half is the only kind of BOUNDARY RECORD left (§3.6.29).
    let lex = seeded();
    lex = addBoundary(lex, { text: 'anything about being used', kind: 'theme' }, NOW);
    // Literal.
    expect(violatesBoundary(lex, 'you filthy manwhore')).toBe(true);
    // Themed — no substring in common, which is exactly why a substring check isn't enough on its own.
    expect(violatesBoundary(lex, 'I love using you')).toBe(true);
    expect(violatesBoundary(lex, 'use me')).toBe(true);
    // …and it doesn't swallow everything: an unrelated line passes.
    expect(violatesBoundary(lex, 'good girl, just like that')).toBe(false);
  });
});

describe('74 §3.6.26 — the deck answers per direction, and its old answers are cleared', () => {
  it('carries a DECK term into the goal list — the signal the change exists to restore', () => {
    // Measured on the real vault before the change: every entry `derivedWantsToSay` fired for came from the
    // deck's 0–4 split, none from the names. Option B removes that scale, so unless the deck can express the
    // gap in MARKS the goal list, the practice sheet and the coach's "wants to say" material go empty.
    const lex = applyDirectionalMarks(
      emptyLexicon('p1', NOW),
      DIRTY_TALK.bank,
      { [CUNT]: { hear: 'love', say: 'okay' } },
      'take:1',
      NOW,
    );
    expect(CUNT.startsWith('names-')).toBe(false); // a deck term, not a pet name
    expect(derivedWantsToSay(lex)).toContain('cunt');
  });

  it('clears a pre-Option-B deck answer, and the boundary record behind it', () => {
    // The shape every real vault holds: ratings, no per-direction mark, plus the legacy `kind:'word'` record
    // a hard no used to write beside the entry.
    const legacy: EroticLexicon = {
      ...emptyLexicon('p1', NOW),
      entries: [
        {
          key: CUNT,
          text: 'cunt',
          kind: 'word',
          family: 'anatomy-her',
          tier: 4,
          // A rating with no mark behind it: the only shape the deck could write before §3.6.26.
          hear: 4,
          say: 1,
        },
      ],
      boundaries: [{ text: 'cunt', kind: 'word', at: NOW.toISOString() }],
    };
    // The reset clears the answer; the RECORD is taken by `dropLegacyWordBoundaries` on the same read
    // (74 §3.6.29). Both run inside `readLexicon`, which is the guarantee that matters — asserted below.
    const { lexicon, changed } = resetPreDirectionalDeckMarks(legacy, LATER);
    expect(changed).toBe(true);
    expect(lexicon.entries).toEqual([]);
    expect(dropLegacyWordBoundaries(lexicon, LATER).lexicon.boundaries).toEqual([]);
    expect(suppressedTexts(dropLegacyWordBoundaries(lexicon, LATER).lexicon)).toEqual([]);
  });

  it('clears an entry whose answer lived in the RETIRED whole-entry state, and its record', () => {
    // What an `okay`/`never` looks like once `state` leaves the schema: 0/0 with no mark, indistinguishable
    // from an unrated row. Measured on the real vault — one member had 12 of these — so a rule keyed on
    // "has a rating" would have left them behind as meaningless rows, with their word records dormant only
    // for as long as the empty rows happened to survive.
    const stripped: EroticLexicon = {
      ...emptyLexicon('p1', NOW),
      entries: [
        {
          key: CUNT,
          text: 'cunt',
          kind: 'word',
          family: 'anatomy-her',
          tier: 4,
          hear: 0,
          say: 0,
        },
      ],
      boundaries: [{ text: 'cunt', kind: 'word', at: NOW.toISOString() }],
    };
    const { lexicon, changed } = resetPreDirectionalDeckMarks(stripped, LATER);
    expect(changed).toBe(true);
    expect(lexicon.entries).toEqual([]);
    expect(dropLegacyWordBoundaries(lexicon, LATER).lexicon.boundaries).toEqual([]);
  });

  it('leaves the pet names alone — they were already answered this way', () => {
    const names = applyDirectionalMarks(
      emptyLexicon('p1', NOW),
      DIRTY_TALK.bank,
      { [GOOD_GIRL]: { hear: 'love', say: 'never' } },
      'take:1',
      NOW,
    );
    const { lexicon, changed } = resetPreDirectionalDeckMarks(names, LATER);
    expect(changed).toBe(false);
    expect(lexicon.entries.find((e) => e.key === GOOD_GIRL)).toMatchObject({
      hearState: 'love',
      sayState: 'never',
    });
  });

  it('keeps a word they typed themselves, and only clears its rating', () => {
    // A custom write-in is 0/0 with no state the moment it is added — the exact shape being purged — so
    // without the carve-out the migration would eat the word on the next read.
    const custom = addCustomEntry(
      emptyLexicon('p1', NOW),
      { text: 'my own line', family: 'sensation', kind: 'phrase' },
      'take:1',
      NOW,
    );
    const fresh = resetPreDirectionalDeckMarks(custom, LATER);
    expect(fresh.changed).toBe(false);
    expect(fresh.lexicon.entries).toHaveLength(1);

    const rated = {
      ...custom,
      entries: custom.entries.map((e) => ({ ...e, hear: 3, say: 3 })),
    };
    const { lexicon, changed } = resetPreDirectionalDeckMarks(rated, LATER);
    expect(changed).toBe(true);
    expect(lexicon.entries).toHaveLength(1);
    expect(lexicon.entries[0]).toMatchObject({ text: 'my own line', hear: 0, say: 0 });
  });

  it('is idempotent — it runs on every read, so a second pass must not write', () => {
    const legacy: EroticLexicon = {
      ...emptyLexicon('p1', NOW),
      entries: [
        {
          key: CUNT,
          text: 'cunt',
          kind: 'word',
          family: 'anatomy-her',
          tier: 4,
          hear: 4,
          say: 1,
        },
      ],
    };
    const once = resetPreDirectionalDeckMarks(legacy, LATER);
    expect(once.changed).toBe(true);
    expect(resetPreDirectionalDeckMarks(once.lexicon, LATER).changed).toBe(false);
  });
});

describe('74 §3.6.27 — a whole register the bank retired', () => {
  it('takes every mark in it, and the word records with them', () => {
    // Measured before writing this: the owner had 28 kinship entries, EVERY mark a `never`. Left behind they
    // would suppress app-wide off a register with no rows on any screen — the §3.2 preference nobody can
    // lift, reached by deleting the family instead of the entry.
    const gone: EroticLexicon = {
      ...emptyLexicon('p1', NOW),
      entries: [
        {
          key: 'names-kinship:sis',
          text: 'sis',
          kind: 'word',
          family: 'names-kinship',
          tier: 5,
          hear: 0,
          say: 0,
          hearState: 'never',
          sayState: 'never',
        },
        {
          key: GOOD_GIRL,
          text: 'good girl',
          kind: 'word',
          family: 'names-praise',
          tier: 2,
          hear: 4,
          say: 4,
          hearState: 'love',
          sayState: 'love',
        },
      ],
      boundaries: [{ text: 'sis', kind: 'word', at: NOW.toISOString() }],
    };
    const { lexicon, changed } = pruneUnshownMarks(gone, DIRTY_TALK.bank, OPEN_ORIENTATION, LATER);
    expect(changed).toBe(true);
    expect(lexicon.entries.map((e) => e.key)).toEqual([GOOD_GIRL]);
    // The record goes too, or removing the row is what STARTS the suppression — taken since §3.6.29 by
    // `dropLegacyWordBoundaries`, which runs on the same read and takes EVERY word record, not just this one.
    expect(dropLegacyWordBoundaries(lexicon, LATER).lexicon.boundaries).toEqual([]);
    expect(suppressedTexts(dropLegacyWordBoundaries(lexicon, LATER).lexicon)).toEqual([]);
  });

  it('MIGRATES a mark when the retired family names a survivor (74 §3.6.29)', () => {
    /*
     * `names-playful` was cut with somewhere to GO — its two survivors moved into `names-rough-mild` — which
     * is a combination neither mechanism had been exercised on: `retiredFamilies` (the family is gone) AND
     * `retiredInto` (this key has an heir). Retiring it outright would throw away a real answer.
     */
    expect(DIRTY_TALK.bank.retiredFamilies).toContain('names-playful');
    expect(DIRTY_TALK.bank.retiredInto?.['names-playful:freak']).toBe('names-rough-mild:freak');
    const marked: EroticLexicon = {
      ...emptyLexicon('p1', NOW),
      entries: [
        {
          key: 'names-playful:freak',
          text: 'freak',
          kind: 'word',
          family: 'names-playful',
          tier: 2,
          hear: 4,
          say: 0,
          hearState: 'love',
        },
      ],
    };
    const { lexicon } = pruneUnshownMarks(marked, DIRTY_TALK.bank, OPEN_ORIENTATION, LATER);
    const moved = lexicon.entries.find((e) => e.key === 'names-rough-mild:freak');
    expect(moved?.hearState).toBe('love');
    // …under the SURVIVOR's key, text and family, or the report shows a name the bank no longer has.
    expect(moved?.family).toBe('names-rough-mild');
    expect(lexicon.entries.some((e) => e.family === 'names-playful')).toBe(false);
  });

  it('is derived from the bank, so a register still in it is untouched', () => {
    expect(DIRTY_TALK.bank.retiredFamilies).toContain('names-kinship');
    expect(DIRTY_TALK.bank.retiredFamilies).toContain('names-agegap');
    // ...and neither has entries any more, which is what makes the retirement honest rather than a label.
    expect(DIRTY_TALK.bank.entries.some((e) => e.family === 'names-kinship')).toBe(false);
    expect(DIRTY_TALK.bank.entries.some((e) => e.family === 'names-agegap')).toBe(false);
    // `daddy`/`mommy` are D/s AUTHORITY terms in another register and stay (owner decision, §3.6.27).
    expect(DIRTY_TALK.bank.entries.some((e) => e.text === 'daddy')).toBe(true);
    expect(DIRTY_TALK.bank.entries.some((e) => e.text === 'mommy')).toBe(true);
  });
});

describe('a hard no is respected while set, and changeable (74 §3.2, amended 2026-08-19)', () => {
  it('is lifted by ANY later mark, and the suppression goes with it', () => {
    const lex = seeded();
    for (const mark of ['love', 'okay'] as const) {
      const after = applyDirectionalMarks(
        lex,
        DIRTY_TALK.bank,
        { [WHORE]: { hear: mark, say: mark } },
        'take:2',
        LATER,
      );
      expect(after.entries.find((e) => e.key === WHORE)?.hearState).not.toBe('never');
      expect(suppressedTexts(after)).not.toContain('manwhore');
    }
  });

  it('suppresses for exactly as long as it is set — the half that must not regress', () => {
    const lex = seeded();
    expect(violatesBoundary(lex, 'you filthy manwhore')).toBe(true);
    expect(suppressedTexts(lex)).toContain('manwhore');
  });

  it('never appears in the goal list, however it was marked', () => {
    // The path that used to leak: never → notYet put the word in `wantsToSay`, which reaches their own coach
    // prompt as something to PRACTISE, two lines under "never use this".
    const downgraded = applyDirectionalMarks(
      seeded(),
      DIRTY_TALK.bank,
      { [WHORE]: { hear: 'okay', say: 'okay' } },
      'e',
      LATER,
    );
    expect(derivedWantsToSay(downgraded)).not.toContain('manwhore');
  });

  it('matches a literal boundary on word boundaries, so a short word cannot suppress everything', () => {
    const lex = applyDirectionalMarks(
      emptyLexicon('p1', NOW),
      DIRTY_TALK.bank,
      { 'anatomy-her:ass': { hear: 'never', say: 'never' } },
      'take:1',
      NOW,
    );
    expect(violatesBoundary(lex, 'that ass')).toBe(true);
    expect(violatesBoundary(lex, 'pass me the water')).toBe(false);
    expect(violatesBoundary(lex, 'a class act')).toBe(false);
  });
});

describe('74 §3.6.6 — a side that was never asked is not a refusal', () => {
  // Loved to hear, only okay to say — the gap (74 §3.6.26). `sides` still records what was OFFERED, which is
  // a different question from what was ANSWERED and is what this section is about.
  const base = {
    key: 'names-praise:good-girl',
    text: 'good girl',
    kind: 'word' as const,
    family: 'names-power',
    tier: 2,
    hear: 4,
    say: 2,
    hearState: 'love' as const,
    sayState: 'okay' as const,
  };

  it('does NOT turn a loved HEAR-ONLY entry into a goal the person never declined', () => {
    // The failure this guards: goals reach their own coach prompt AND a partner-shared Insight fact, so a
    // fabricated one is not a cosmetic bug — it invents a want and then shares it.
    // Hear-only means the say side carries no MARK — there is nothing to be a gap against.
    const hearOnly = { ...base, say: 0, sides: ['hear' as const] };
    delete (hearOnly as { sayState?: unknown }).sayState;
    const lexicon = { ...emptyLexicon('p1', NOW), entries: [hearOnly] };
    expect(derivedWantsToSay(lexicon)).toEqual([]);
  });

  it('still derives the goal when BOTH sides were actually asked', () => {
    const lexicon = {
      ...emptyLexicon('p1', NOW),
      entries: [{ ...base, sides: ['hear' as const, 'say' as const] }],
    };
    expect(derivedWantsToSay(lexicon)).toEqual(['good girl']);
  });

  it('reads answeredness from the MARKS, not from `sides`', () => {
    // The two say different things: `sides` is what the deck OFFERED, a mark is what they ANSWERED. Only the
    // mark can decide whether a direction has a real answer behind it, so an entry carrying both marks is
    // answered both ways whatever `sides` happens to say.
    const lexicon = { ...emptyLexicon('p1', NOW), entries: [base] };
    expect(derivedWantsToSay(lexicon)).toEqual(['good girl']);
  });

  it('records the sides it showed, so the take is the record of what was asked', () => {
    const marked = applyDirectionalMarks(
      emptyLexicon('p1', NOW),
      DIRTY_TALK.bank,
      { 'names-praise:good-girl': { say: 'love' } },
      'test:r1',
      NOW,
      { 'names-praise:good-girl': ['say'] },
    );
    expect(marked.entries[0]?.sides).toEqual(['say']);
  });
});
/**
 * The limitation, pinned rather than left to be discovered: `mergeLexicons` cannot express a DELETION.
 *
 * Its one production caller folds a synthesis into a lexicon against a copy of itself, so both sides always
 * carry the same entries and nothing can trip this today; conflicted vault copies are surfaced for a person
 * to resolve, never merged. But `pruneUnshownMarks` does delete (74 §3.6.3), and a lifted `never` is a
 * deletion too — so if a real two-copy merge is ever wired, this is the test that says what it has to solve
 * first (a tombstone), instead of a hard no quietly coming back from an older device.
 */
describe('mergeLexicons cannot express a deletion — pinned, not endorsed', () => {
  const at = (updatedAt: string, entries: LexiconEntry[]): EroticLexicon => ({
    personId: 'p1',
    schemaVersion: 1,
    entries,
    registers: {},
    contexts: {},
    themes: [],
    wantsToSay: [],
    boundaries: [],
    updatedAt,
  });
  const good: LexiconEntry = {
    key: 'names-praise:good-girl',
    text: 'good girl',
    kind: 'word',
    family: 'names-praise',
    tier: 2,
    hear: 0,
    say: 0,
    hearState: 'never',
    source: 'test:t1',
  };

  it('brings back an entry the newer copy dropped', () => {
    const older = at('2026-08-01T00:00:00.000Z', [good]);
    const pruned = at('2026-08-19T00:00:00.000Z', []);
    // Not what anyone wants — recorded so the next person to wire a merge sees it before their users do.
    expect(mergeLexicons(older, pruned).entries.map((e) => e.key)).toEqual([good.key]);
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
        key: 'names-rough-heavy:anal-slut',
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
          key: 'names-rough-heavy:manwhore',
          text: 'manwhore',
          kind: 'word',
          family: 'names-degrading',
          tier: 4,
          hear: 0,
          say: 0,
          hearState: 'never' as const,
          sayState: 'never' as const,
          source: 'test:r0',
        },
      ],
      boundaries: [{ text: 'being used', kind: 'theme' as const, at: 'now' }],
    });
    for (const direction of ['hear', 'say'] as const) {
      expect(violatesBoundary(legacy, 'you filthy manwhore', direction)).toBe(true);
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
  const KEY = 'names-rough-heavy:anal-slut';

  it('writes each direction separately, and derives the ratings the rest of the app reads', () => {
    const lex = applyDirectionalMarks(
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
    const lex = applyDirectionalMarks(
      start(),
      DIRTY_TALK.bank,
      { [KEY]: { hear: 'never', say: 'love' } },
      'take:1',
      now,
    );
    expect(lex.boundaries).toEqual([]);
    expect(violatesBoundary(lex, 'take it, anal slut', 'hear')).toBe(true);
    expect(violatesBoundary(lex, 'take it, anal slut', 'say')).toBe(false);
  });

  it('lets a LATER take mark over a no, per direction — nothing is settled for good', () => {
    const first = applyDirectionalMarks(
      start(),
      DIRTY_TALK.bank,
      { [KEY]: { hear: 'never' } },
      'take:1',
      now,
    );
    const second = applyDirectionalMarks(
      first,
      DIRTY_TALK.bank,
      { [KEY]: { hear: 'love' } },
      'take:2',
      now,
    );
    expect(second.entries.find((e) => e.key === KEY)?.hearState).toBe('love');
    expect(violatesBoundary(second, 'take it, anal slut', 'hear')).toBe(false);
  });

  it('takes back ONE direction, leaving the other standing', () => {
    const lex = applyDirectionalMarks(
      start(),
      DIRTY_TALK.bank,
      { [KEY]: { hear: 'never', say: 'never' } },
      'take:1',
      now,
    );
    const cleared = clearDirectionalMarks(lex, { [KEY]: ['hear'] }, now);
    const entry = cleared.entries.find((e) => e.key === KEY);
    expect(entry?.hearState).toBeUndefined();
    expect(entry?.sayState).toBe('never');
    // The direction they took back stops suppressing; the one they left standing does not.
    expect(violatesBoundary(cleared, 'take it, anal slut', 'hear')).toBe(false);
    expect(violatesBoundary(cleared, 'take it, anal slut', 'say')).toBe(true);
  });

  it('lets a LATER sitting take back an earlier mark — a preference is not take-scoped', () => {
    const first = applyDirectionalMarks(
      start(),
      DIRTY_TALK.bank,
      { [KEY]: { say: 'never' } },
      'take:1',
      now,
    );
    const taken = clearDirectionalMarks(first, { [KEY]: ['say'] }, now);
    expect(taken.entries.find((e) => e.key === KEY)?.sayState).toBeUndefined();
    expect(violatesBoundary(taken, 'take it, anal slut', 'say')).toBe(false);
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
      hearState: 'never' as const,
      sayState: 'never' as const,
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
      ...lexiconWith(['manwhore']),
      entries: [
        {
          key: 'names-rough-heavy:manwhore',
          text: 'manwhore',
          kind: 'word',
          family: 'names-rough-heavy',
          tier: 4,
          hear: 0,
          say: 0,
          hearState: 'never',
          sayState: 'never',
        },
      ],
    };
    expect(violatesBoundary(lex, 'You filthy manwhore')).toBe(true);
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
          hearState: 'never',
          sayState: 'never',
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
          hearState: 'never',
          sayState: 'never',
        },
      ],
    };
    // Not a name family, so nothing is loosened: the word is off wherever it appears.
    expect(violatesBoundary(lex, 'you little slut of a thing')).toBe(true);
  });
});

describe('74 §3.6.31 — an explicit love outranks a substring no', () => {
  /**
   * Measured live on the owner's vault: the synthesis wrote seven paragraphs and the boundary filter kept
   * two. The one it lost that mattered most was the hear/say-gap paragraph — the actionable one — because it
   * quoted `finger my ass`, a line he LOVES to hear, and he had ruled out the bare name `my ass`, which a
   * multi-word term matches as a plain substring.
   */
  const lex = (): EroticLexicon => {
    const base = emptyLexicon('p1', new Date('2026-08-19T00:00:00.000Z'));
    return {
      ...base,
      entries: [
        // Ruled out as a NAME, both ways.
        {
          key: 'names-body:my-ass',
          text: 'my ass',
          kind: 'word',
          family: 'names-body',
          tier: 3,
          hear: 0,
          say: 0,
          hearState: 'never',
          sayState: 'never',
          source: 'take:1',
        },
        // …and LOVED as a line that contains it.
        {
          key: 'anal:finger-my-ass',
          text: 'finger my ass',
          kind: 'phrase',
          family: 'anal',
          tier: 3,
          hear: 3,
          say: 0,
          hearState: 'love',
          sayState: 'never',
          source: 'take:1',
        },
      ],
    };
  };

  it('keeps prose that quotes a line they love, even though a ruled-out term sits inside it', () => {
    const para =
      "The hear/say gap is sharp: 'finger my ass' sits in your high-love column and your low-comfort-saying one.";
    expect(violatesBoundary(lex(), para, 'hear')).toBe(false);
  });

  it('still refuses the ruled-out term itself, and any line they have NOT said yes to', () => {
    // The whole guarantee: nothing they actually ruled out is loosened.
    expect(violatesBoundary(lex(), 'my ass')).toBe(true);
    expect(violatesBoundary(lex(), 'I want to slap my ass hard')).toBe(true);
  });

  it('respects direction — loved to hear, ruled out to say', () => {
    expect(violatesBoundary(lex(), 'finger my ass', 'hear')).toBe(false);
    expect(violatesBoundary(lex(), 'finger my ass', 'say')).toBe(true);
  });
});

describe('74 §3.6.31 — the vocative rule only fires where the word ENDS the phrase', () => {
  const lex = (): EroticLexicon => {
    const base = emptyLexicon('p1', new Date('2026-08-19T00:00:00.000Z'));
    return {
      ...base,
      entries: [
        {
          key: 'names-warm:beautiful',
          text: 'beautiful',
          kind: 'word',
          family: 'names-warm',
          tier: 1,
          hear: 0,
          say: 0,
          hearState: 'never',
          sayState: 'never',
          source: 'take:1',
        },
      ],
    };
  };

  it('allows an adjective in front of a noun', () => {
    // `([^a-z0-9]|$)` accepted the following space, so this read as being CALLED beautiful.
    expect(violatesBoundary(lex(), 'my beautiful cock')).toBe(false);
  });

  it('still catches being addressed by it', () => {
    expect(violatesBoundary(lex(), 'my beautiful')).toBe(true);
    expect(violatesBoundary(lex(), 'come here, beautiful')).toBe(true);
  });

  it('still allows the ordinary sense — the §3.6.13 relaxation is untouched', () => {
    expect(violatesBoundary(lex(), 'you look beautiful today')).toBe(false);
  });
});

describe('74 §3.6.29 — the legacy word-boundary records are gone', () => {
  /*
   * The defect this closes, measured on the real vault: 999 `kind:'word'` records, 382 of them ORPHANED by
   * earlier bank purges. `suppressedTexts` honours an orphan (it ignores a word record only while an entry
   * with that text exists), and `violatesBoundary`'s everyday-word relaxation is derived from the person's
   * live ENTRIES — so an orphan also loses the relaxation and degrades to a plain substring match on words
   * like `love`. Result: 27% of ordinary intimate lines discarded app-wide, with no row anywhere to lift one.
   */
  const orphaned: EroticLexicon = {
    ...emptyLexicon('p1', NOW),
    entries: [],
    boundaries: [
      { text: 'love', kind: 'word', at: NOW.toISOString() },
      { text: 'anything about being used', kind: 'theme', at: NOW.toISOString() },
    ],
  };

  it('drops every word record and keeps every theme', () => {
    const { lexicon, changed } = dropLegacyWordBoundaries(orphaned, LATER);
    expect(changed).toBe(true);
    expect(lexicon.boundaries.map((b) => b.kind)).toEqual(['theme']);
  });

  it('is idempotent, so it never writes on a read', () => {
    const once = dropLegacyWordBoundaries(orphaned, LATER).lexicon;
    expect(dropLegacyWordBoundaries(once, LATER).changed).toBe(false);
  });

  it('stops an orphaned record rejecting an ordinary line — the whole point', () => {
    // Before: no entry backs the record, so it suppresses AND loses the everyday-word relaxation.
    expect(suppressedTexts(orphaned)).toContain('love');
    expect(violatesBoundary(orphaned, 'I love the way you look at me')).toBe(true);
    const cleaned = dropLegacyWordBoundaries(orphaned, LATER).lexicon;
    expect(suppressedTexts(cleaned)).not.toContain('love');
    expect(violatesBoundary(cleaned, 'I love the way you look at me')).toBe(false);
    // The theme still bites, so this narrows the legacy SHAPE and not enforcement.
    expect(violatesBoundary(cleaned, 'I love using you')).toBe(true);
  });

  it('a live mark still suppresses — the record was never the source of truth', () => {
    const marked = applyDirectionalMarks(
      emptyLexicon('p1', NOW),
      DIRTY_TALK.bank,
      { [WHORE]: { hear: 'never', say: 'never' } },
      'take:1',
      NOW,
    );
    const cleaned = dropLegacyWordBoundaries(marked, LATER).lexicon;
    expect(suppressedTexts(cleaned)).toContain('manwhore');
    expect(violatesBoundary(cleaned, 'you filthy manwhore')).toBe(true);
  });

  it('heals a stored vault on the very next read, with no migration step', async () => {
    const fs = memFileSystem();
    await writeLexicon(fs, KEY, orphaned);
    const read = await readLexicon(fs, KEY, 'p1', LATER);
    expect(read.boundaries.map((b) => b.kind)).toEqual(['theme']);
    expect(violatesBoundary(read, 'I love the way you look at me')).toBe(false);
  });
});

describe('74 §3.6.40 — the traffic-light rows, and what happens to a mark on one', () => {
  const COLOUR = 'consent:colour';
  const LIGHTS = 'consent:green-amber-red';

  /**
   * A lexicon written BEFORE the cut: the entries existed, so they were marked like any other row. Built by
   * hand rather than through `applyDirectionalMarks`, because the bank no longer has them to mark — which is
   * exactly the state every existing vault is in.
   */
  function marked(): EroticLexicon {
    const rows: LexiconEntry[] = [
      {
        key: COLOUR,
        text: 'colour?',
        kind: 'phrase',
        family: 'consent',
        tier: 2,
        hear: 4,
        say: 4,
        hearState: 'love',
        sayState: 'love',
        source: 'test:old',
      },
      {
        key: LIGHTS,
        text: 'green / amber / red',
        kind: 'phrase',
        family: 'consent',
        tier: 2,
        hear: 0,
        say: 0,
        hearState: 'never',
        sayState: 'never',
        source: 'test:old',
      },
    ];
    return { ...seeded(), entries: [...seeded().entries, ...rows] };
  }

  it('retires both marks outright, because the family is still in the bank and the keys are not', () => {
    const { lexicon, changed } = retireDeadKeys(marked());
    expect(changed).toBe(true);
    expect(lexicon.entries.map((e) => e.key)).not.toContain(COLOUR);
    expect(lexicon.entries.map((e) => e.key)).not.toContain(LIGHTS);
    // Nothing else moved: this is a cut with no survivor, so no mark migrates anywhere (74 §3.6.25).
    expect(lexicon.entries.map((e) => e.key)).toContain(GOOD_GIRL);
    expect(lexicon.entries.map((e) => e.key)).toContain(CUNT);
  });

  it('releases the suppression the `never` was carrying, so nothing is left suppressing a word no row can lift', () => {
    expect(suppressedTexts(marked())).toContain('green / amber / red');
    const { lexicon } = retireDeadKeys(marked());
    expect(suppressedTexts(lexicon)).not.toContain('green / amber / red');
    // The other person's real boundaries are untouched.
    expect(suppressedTexts(lexicon)).toContain('manwhore');
  });

  it('cleans it on the ONE read every consumer goes through, not just on the Tests screens', async () => {
    /*
     * The point of the §3.6.34 placement: `chatService`, the books, the emails, questionnaires, challenges
     * and the steer all call `readLexicon` directly. If the cleaning only ran in `pruneUnshownMarks` they
     * would each keep reading the retired rows out of the raw file.
     */
    const fs: FileSystem = memFileSystem();
    await writeLexicon(fs, KEY, marked());
    const read = await readLexicon(fs, KEY, 'p1', LATER);
    expect(read.entries.map((e) => e.key)).not.toContain(COLOUR);
    expect(read.entries.map((e) => e.key)).not.toContain(LIGHTS);
  });

  it('also clears the model-written prose the bank cut cannot reach', () => {
    /*
     * `wantsToSay` is the one that matters: it feeds `goalSuggestService` and becomes a `wants-to-say` fact
     * on the derived Insight, and NO control in the app can remove an item from it — the only edits offered
     * are `removeBoundary`, `clearNameSide` and the nuclear delete-all. Left alone it is the §3.2
     * un-gettable-rid-of preference reached through the synthesis instead of through the bank.
     */
    const withProse: EroticLexicon = {
      ...marked(),
      themes: ['being asked', 'colour checks'],
      wantsToSay: ['cock', 'green / amber / red'],
    };
    const resolved = resolveLexicon(withProse, LATER);
    expect(resolved.changed).toBe(true);
    expect(resolved.lexicon.wantsToSay).toEqual(['cock']);
    expect(resolved.lexicon.themes).toEqual(['being asked']);
  });
});

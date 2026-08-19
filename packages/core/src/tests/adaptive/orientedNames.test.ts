import { describe, expect, it } from 'vitest';
import { DIRTY_TALK_NAMES } from './instruments/dirtyTalkNames';
import { DIRTY_TALK_BANK } from './instruments/dirtyTalkBank';
import { bankEntry, type Bank, type BankEntry } from './bank';
import { OPEN_ORIENTATION, shownSides, type Orientation } from './orientation';
import { applyNameMarks, pruneUnshownMarks, suppressedTexts } from './lexicon';
import type { EroticLexicon } from '../../schemas';

/**
 * 74 §3.6.3 — pet names are oriented (owner-directed, 2026-08-19), reversing §3.6.8's carve-out.
 *
 * The reported bug: a man being asked whether he calls his girlfriend "my man". These guard the fix AND the
 * two things the fix must not break — the convention-coded words stay open to everyone, and nothing a person
 * already answered is left suppressing from a side they can no longer see.
 */

/** A straight man: he is a man, she is a woman. The configuration the bug was reported on. */
const STRAIGHT_MAN: Orientation = {
  selfAddress: 'man',
  partnerAddress: 'girl',
  selfBody: 'penis',
  partnerBody: 'vulva',
};

const entry = (bank: Bank, key: string): BankEntry => {
  const found = bankEntry(bank, key);
  // Throwing beats `!`: a retired key otherwise fails deep inside the resolver with "cannot read
  // 'includes'" instead of naming the key that moved (the 2026-08-17 lesson, §4 forbids `!` anyway).
  if (!found) throw new Error(`no bank entry for ${key}`);
  return found;
};

const name = (key: string): BankEntry => entry(DIRTY_TALK_NAMES, key);

describe('names are oriented per direction', () => {
  it('offers a gendered name only in the direction it can land', () => {
    // THE REPORTED BUG: "my man" as something he calls her.
    expect(shownSides(name('names-yours:my-man'), STRAIGHT_MAN)).toEqual(['hear']);
    // ...and its mirror, which is the half that must SURVIVE: he can still call her "my girl".
    expect(shownSides(name('names-yours:my-girl'), STRAIGHT_MAN)).toEqual(['say']);
    expect(shownSides(name('names-praise:good-girl'), STRAIGHT_MAN)).toEqual(['say']);
    expect(shownSides(name('names-praise:good-boy'), STRAIGHT_MAN)).toEqual(['hear']);
  });

  it('keeps a convention-coded word open to everyone', () => {
    // #62: never infer a preference from gender. A man may absolutely want these, so they stay both ways —
    // deciding for himself is the entire point of the phase.
    for (const key of [
      'names-rough-heavy:slut',
      'names-warm:angel',
      'names-warm:baby',
      'names-soft-power:my-kitten',
    ]) {
      expect(shownSides(name(key), STRAIGHT_MAN)).toEqual(['hear', 'say']);
    }
  });

  it('leaves the feminising register asked both ways', () => {
    // Its whole premise is a feminine name aimed at a man, so `either` IS the correct answer to "who must
    // this person be?" — it is not an exemption, and tagging it would delete the register for its audience.
    const feminising = DIRTY_TALK_NAMES.entries.filter((e) => e.family === 'names-feminising');
    expect(feminising.length).toBeGreaterThan(50);
    for (const e of feminising) {
      expect(e.addresses).toBeUndefined();
      expect(shownSides(e, STRAIGHT_MAN)).toEqual(['hear', 'say']);
    }
  });

  it('names anatomy only where the name IS the body part', () => {
    // "my cock" names his own body; "cock sleeve" names a use for someone ELSE's, so tagging it would
    // demand the wrong person's anatomy.
    expect(name('names-body:my-cock').body).toBe('penis');
    expect(name('names-body:my-pussy').body).toBe('vulva');
    expect(shownSides(name('names-body:my-pussy'), STRAIGHT_MAN)).toEqual(['say']);
    expect(name('names-object:cock-sleeve').body).toBeUndefined();
    expect(name('names-rough-heavy:dick-sucker').body).toBeUndefined();
  });

  it('reads the head noun, not the possessor', () => {
    // "daddy's girl" is a girl; "my daddy's slut" is a slut of any gender.
    expect(name('names-kinship:daddy-s-girl').addresses).toBe('girl');
    expect(name('names-kinship:mommy-s-boy').addresses).toBe('man');
    expect(name('names-rough-heavy:my-daddy-s-slut').addresses).toBeUndefined();
  });

  it('leaves everything open when either axis is unanswered', () => {
    // The resolver fails OPEN (§3.6.5): someone who declined to answer never gets a thinner test.
    expect(shownSides(name('names-yours:my-man'), OPEN_ORIENTATION)).toEqual(['hear', 'say']);
  });
});

describe('the deck’s gendered vocatives', () => {
  it('orients the role-name lines, which were 18 of 18 untagged', () => {
    const roleLines = DIRTY_TALK_BANK.entries.filter((e) => e.family === 'role-lines');
    expect(roleLines.every((e) => e.addresses !== undefined)).toBe(true);
    expect(shownSides(entry(DIRTY_TALK_BANK, 'role-lines:yes-ma-am'), STRAIGHT_MAN)).toEqual([
      'say',
    ]);
    expect(shownSides(entry(DIRTY_TALK_BANK, 'role-lines:yes-sir'), STRAIGHT_MAN)).toEqual([
      'hear',
    ]);
  });

  it('leaves a self-label alone, because the axis is inverted for it', () => {
    // `addresses` is checked against the person RECEIVING the line, but "I'm your good girl" describes the
    // person SAYING it. Tagging it would hide it from him on the side where it fits.
    expect(entry(DIRTY_TALK_BANK, 'self-labelling:i-m-your-good-girl').addresses).toBeUndefined();
  });
});

describe('a mark on a side nobody is asked about', () => {
  const lexicon = (entries: EroticLexicon['entries']): EroticLexicon => ({
    schemaVersion: 1,
    personId: 'p1',
    entries,
    boundaries: [],
    registers: {},
    contexts: {},
    themes: [],
    wantsToSay: [],
    updatedAt: '2026-08-19T00:00:00.000Z',
  });

  it('stops suppressing, because it is removed', () => {
    // THE TRAP this exists to close: `suppressedTexts` derives suppression from the LIVE state, so a `never`
    // on a hidden side kept that word out of every generated line app-wide with no control left to lift it.
    const before = lexicon([
      {
        key: 'names-yours:my-man',
        text: 'my man',
        kind: 'word',
        family: 'names-yours',
        tier: 1,
        hear: 0,
        say: 0,
        sayState: 'never',
        source: 'test:r1',
      },
    ]);
    expect(suppressedTexts(before)).toContain('my man');

    const after = pruneUnshownMarks(before, DIRTY_TALK_NAMES, STRAIGHT_MAN, new Date());
    expect(after.changed).toBe(true);
    expect(suppressedTexts(after.lexicon)).not.toContain('my man');
  });

  it('keeps the side they ARE asked about', () => {
    const before = lexicon([
      {
        key: 'names-praise:good-girl',
        text: 'good girl',
        kind: 'word',
        family: 'names-praise',
        tier: 1,
        hear: 4,
        say: 4,
        hearState: 'love',
        sayState: 'love',
        source: 'test:r1',
      },
    ]);
    const after = pruneUnshownMarks(before, DIRTY_TALK_NAMES, STRAIGHT_MAN, new Date());
    const kept = after.lexicon.entries[0];
    // He is not asked whether HE wants to be called it; he is still asked whether he calls her it.
    expect(kept?.hearState).toBeUndefined();
    expect(kept?.hear).toBe(0);
    expect(kept?.sayState).toBe('love');
    expect(kept?.sides).toEqual(['say']);
  });

  it('never touches a key the bank does not know', () => {
    // A custom write-in has no sides to resolve, and guessing would delete something they typed themselves.
    const before = lexicon([
      {
        key: 'custom:their-own-word',
        text: 'their own word',
        kind: 'word',
        family: 'custom',
        tier: 1,
        hear: 4,
        say: 0,
        hearState: 'love',
        source: 'edit',
      },
    ]);
    const after = pruneUnshownMarks(before, DIRTY_TALK_NAMES, STRAIGHT_MAN, new Date());
    expect(after.changed).toBe(false);
    expect(after.lexicon.entries[0]?.hearState).toBe('love');
  });

  it('is a no-op when nothing is withheld', () => {
    const before = lexicon([
      {
        key: 'names-warm:baby',
        text: 'baby',
        kind: 'word',
        family: 'names-warm',
        tier: 1,
        hear: 4,
        say: 4,
        hearState: 'love',
        sayState: 'love',
        sides: ['hear', 'say'],
        source: 'test:r1',
      },
    ]);
    expect(pruneUnshownMarks(before, DIRTY_TALK_NAMES, STRAIGHT_MAN, new Date()).changed).toBe(
      false,
    );
  });
});

describe('a name pass records what was actually offered', () => {
  it('stores the shown sides, not both', () => {
    // Hardcoding `['hear','say']` was true before names were oriented and became a lie the moment they
    // were: a `0` on a side never offered reads as a refusal (§3.6.6).
    const base: EroticLexicon = {
      schemaVersion: 1,
      personId: 'p1',
      entries: [],
      boundaries: [],
      registers: {},
      contexts: {},
      themes: [],
      wantsToSay: [],
      updatedAt: '2026-08-19T00:00:00.000Z',
    };
    const next = applyNameMarks(
      base,
      DIRTY_TALK_NAMES,
      { 'names-yours:my-man': { hear: 'love' } },
      'test:r1',
      new Date(),
      { 'names-yours:my-man': ['hear'] },
    );
    expect(next.entries[0]?.sides).toEqual(['hear']);
  });
});

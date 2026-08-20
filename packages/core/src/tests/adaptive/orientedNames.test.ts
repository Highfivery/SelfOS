import { describe, expect, it } from 'vitest';
import { DIRTY_TALK_NAMES } from './instruments/dirtyTalkNames';
import { DIRTY_TALK_BANK } from './instruments/dirtyTalkBank';
import { bankEntry, type Bank, type BankEntry } from './bank';
import { OPEN_ORIENTATION, shownSides, type Orientation } from './orientation';
import { applyDirectionalMarks, pruneUnshownMarks, suppressedTexts } from './lexicon';
import { DIRTY_TALK } from './instruments/dirtyTalk';
import type { EroticLexicon, LexiconEntry } from '../../schemas';

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

describe('74 §3.6.28 — the WORDS are oriented by body too', () => {
  const deck = (key: string): BankEntry => entry(DIRTY_TALK_BANK, key);

  it('never offers a man "cum in me" to SAY (owner-reported)', () => {
    // The reported bug. "cum in me" names no organ of the SPEAKER's — it needs the LISTENER to have a penis
    // — so it is an ordinary listener-bodied line that simply had no tag, and was offered both ways to
    // everyone. He can want to HEAR it; he cannot say it to a partner with no penis.
    const sides = shownSides(deck('demands-receiving:cum-in-me'), STRAIGHT_MAN);
    expect(sides).toContain('hear');
    expect(sides).not.toContain('say');
  });

  it('never offers a man "stretch my pussy" to SAY, and never offers it to HEAR from a man', () => {
    // The other half, and the one the model could not express: this names the SPEAKER's own body, so the
    // axis has to flip. Without `bodyOf` the resolver checks his PARTNER's body for the say side and
    // happily offers a man a line about his own pussy.
    const sides = shownSides(deck('demands-receiving:stretch-my-pussy'), STRAIGHT_MAN);
    expect(sides).toContain('hear'); // she says it to him
    expect(sides).not.toContain('say');
  });

  it('offers a speaker-bodied line the OTHER way round for the other partner', () => {
    const STRAIGHT_WOMAN: Orientation = {
      selfAddress: 'girl',
      partnerAddress: 'man',
      selfBody: 'vulva',
      partnerBody: 'penis',
    };
    const sides = shownSides(deck('demands-receiving:stretch-my-pussy'), STRAIGHT_WOMAN);
    expect(sides).toContain('say');
    expect(sides).not.toContain('hear');
  });

  it('leaves a line whose anatomy decides nothing open to everyone', () => {
    // The resolver fails OPEN by design (§3.6.5). "make me come" and "come with me" name nobody's anatomy,
    // so tagging them would give someone a quietly thinner test for no reason.
    for (const key of ['cum:make-me-cum', 'cum:cum-with-me']) {
      expect(shownSides(deck(key), STRAIGHT_MAN)).toEqual(['hear', 'say']);
    }
  });
});

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
      'names-warm:beautiful',
      'names-warm:baby',
      'names-soft-power:kitten',
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
    // A gendered head is read…
    expect(name('names-praise:good-girl').addresses).toBe('girl');
    // …and a MALE possessor over a genderless head decides nothing, which is the half that can actually go
    // wrong: "my daddy's slut" is a slut of any gender. (The gendered-possessive examples this also used —
    // "daddy's girl", "mommy's boy" — left with the kinship register in §3.6.27.)
    expect(name('names-rough-heavy:my-daddy-s-slut').addresses).toBeUndefined();
    expect(name('names-rough-heavy:my-master-s-slut').addresses).toBeUndefined();
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
    const next = applyDirectionalMarks(
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

/**
 * 74 §3.6.3 — the tagging rule is "who must the person being CALLED this be?", grammatical gender only.
 *
 * These are the entries where a family already answers that question for a sibling, so leaving one untagged
 * is a drift rather than a judgment call — and each is the reported bug one word over ("do you want to be
 * called ma'am?" put to a man). They were all found by sweeping the bank for gendered nouns whose family
 * neighbours carry a tag, which is the check this pins.
 */
describe('a gendered role noun is tagged wherever its family already tags its siblings', () => {
  const tag = (key: string): string | undefined => name(key).addresses;

  it('tags an honorific the same way as its counterpart', () => {
    // `sir` was tagged and `ma'am` — the female form of the same word — was not. (`my sir` / `my ma'am`
    // carried the same tags and were cut with the 184 other bare/"my" pairs.)
    expect(tag('names-hard-power:sir')).toBe('man');
    expect(tag('names-hard-power:ma-am')).toBe('girl');
    // The neutral form of the same role stays open — it is the tagging criterion, not the topic, that decides.
    expect(tag('names-hard-power:my-dominant')).toBeUndefined();
    expect(tag('names-hard-power:dominatrix')).toBe('girl');
  });

  it('tags an occupational -ess/-maid form, whose neutral sibling stays open', () => {
    expect(tag('names-roleplay:my-waitress')).toBe('girl');
    expect(tag('names-roleplay:my-stewardess')).toBe('girl');
    expect(tag('names-roleplay:my-barmaid')).toBe('girl');
    // Adjacent in the bank, the clearest pair in it, and both were missed.
    expect(tag('names-roleplay:my-schoolmaster')).toBe('man');
    expect(tag('names-roleplay:my-schoolmistress')).toBe('girl');
    // Genuinely neutral job titles are NOT swept up by the rule.
    for (const key of [
      'names-roleplay:my-flight-attendant',
      'names-roleplay:my-bartender',
      'names-roleplay:my-tutor',
    ]) {
      expect(tag(key)).toBeUndefined();
    }
  });

  it('leaves a word gendered only by convention open, however feminine it reads', () => {
    // #62 again, and the owner's line: `queen` as an intensifier is not the honorific, `whore` and `slut`
    // are conventions, and a gendered POSSESSOR does not constrain the person being called it.
    for (const key of [
      'names-rough-heavy:size-queen',
      'names-rough-heavy:whore',
      'names-rough-heavy:my-daddy-s-slut',
      'names-rough-heavy:my-sir-s-slut',
    ]) {
      expect(tag(key)).toBeUndefined();
    }
  });
});

/**
 * `addresses` is checked against the person RECEIVING the line, and a self-label inverts that — "I'm your
 * good girl" is said BY the girl. Tagging one would hide it from a straight man on the side where it fits him
 * and keep it on the side where it doesn't. This is the part that fails if someone "completes" it anyway.
 *
 * 74 §3.6.29 narrowed this to `addresses`, which is the axis the inversion is actually about. `body` names
 * whose ANATOMY a line mentions, and a self-label can perfectly well name the other person's: "I exist for
 * your cock" is a self-label whose anatomy is the LISTENER's, so the ordinary mapping applies and leaving it
 * untagged asks a woman whether she wants to hear a line about her own cock. If a self-label ever names the
 * SPEAKER's anatomy, `bodyOf: 'speaker'` (which did not exist when this guard was written) is how it says so.
 */
describe('the self-label family stays un-oriented', () => {
  it('carries no ADDRESS on any entry, and body only where it names the other person', () => {
    const selfLabels = DIRTY_TALK_BANK.entries.filter((e) => e.family === 'self-labelling');
    expect(selfLabels.length).toBeGreaterThan(0);
    for (const entry of selfLabels) {
      expect(entry.addresses).toBeUndefined();
      // A body tag here must be about the LISTENER; a speaker-bodied self-label would need `bodyOf`.
      if (entry.body) expect(entry.bodyOf).toBeUndefined();
    }
    // ...so it reaches everyone both ways, which is the point: for a straight man "I'm your good girl" is
    // right to hear from her AND is the feminising register to say.
    expect(
      shownSides(entry(DIRTY_TALK_BANK, 'self-labelling:i-m-your-good-girl'), STRAIGHT_MAN),
    ).toEqual(['hear', 'say']);
  });
});

/**
 * 74 §3.6.25 — a mark on a name the bank has RETIRED.
 *
 * Cutting a name does not cut it from anyone's lexicon: every consumer reads the person's own store, so
 * nobody loses an answer to a purge (#534). Right for the answer, wrong for the CONTROL — the row that
 * could change it goes with the entry while `suppressedTexts` keeps reading the mark, so a `never` on a
 * retired name kept that word out of every generated line with nothing left on any screen to lift it.
 *
 * Measured on the real vault before this shipped: 173 of one person's 1,110 entries were retired names,
 * 169 of them still suppressing. The other account had none.
 */
describe('a mark on a name the bank retired', () => {
  const lex = (entries: LexiconEntry[]): EroticLexicon => ({
    personId: 'p1',
    schemaVersion: 1,
    entries,
    registers: {},
    contexts: {},
    themes: [],
    wantsToSay: [],
    boundaries: [],
    updatedAt: '2026-08-19T00:00:00.000Z',
  });
  const mark = (key: string, family: string, over: Partial<LexiconEntry> = {}): LexiconEntry => ({
    key,
    text: key.split(':')[1] ?? key,
    kind: 'word',
    family,
    tier: 3,
    hear: 0,
    say: 0,
    ...over,
  });

  it('stops suppressing a word whose name was cut with nowhere to go', () => {
    const before = lex([
      mark('names-object:my-paperweight', 'names-object', { hearState: 'never' }),
    ]);
    expect(suppressedTexts(before)).toContain('my-paperweight');
    const after = pruneUnshownMarks(before, DIRTY_TALK.bank, OPEN_ORIENTATION, new Date());
    expect(after.changed).toBe(true);
    expect(after.lexicon.entries).toEqual([]);
  });

  it('MOVES the mark when the name was retired into another that says the same thing', () => {
    // "my daddy" went because "daddy" says it; the answer is the same answer, so it survives the word.
    // (Was the warm my-love/love pair until §3.6.30 cut `love` — a migration test needs a LIVE target.)
    const after = pruneUnshownMarks(
      lex([mark('names-hard-power:my-daddy', 'names-hard-power', { hearState: 'love', hear: 3 })]),
      DIRTY_TALK.bank,
      OPEN_ORIENTATION,
      new Date(),
    );
    const moved = after.lexicon.entries.find((e) => e.key === 'names-hard-power:daddy');
    expect(moved?.hearState).toBe('love');
    // Under the SURVIVOR's own text, or the report shows them a name the bank no longer has.
    expect(moved?.text).toBe('daddy');
    expect(after.lexicon.entries.some((e) => e.key === 'names-hard-power:my-daddy')).toBe(false);
  });

  it('never overwrites what they said about the survivor', () => {
    // The whole risk of a migration. Their answer on the surviving name wins; the retired one only fills
    // a side they left genuinely blank.
    const after = pruneUnshownMarks(
      lex([
        mark('names-hard-power:daddy', 'names-hard-power', { hearState: 'never' }),
        mark('names-hard-power:my-daddy', 'names-hard-power', {
          hearState: 'love',
          sayState: 'love',
          say: 3,
        }),
      ]),
      DIRTY_TALK.bank,
      OPEN_ORIENTATION,
      new Date(),
    );
    const kept = after.lexicon.entries.find((e) => e.key === 'names-hard-power:daddy');
    expect(kept?.hearState).toBe('never'); // theirs, untouched
    expect(kept?.sayState).toBe('love'); // the side they had left blank
  });

  it('retires the mark outright when the name it was retired INTO has since been cut', () => {
    /*
     * 74 §3.6.32 — the frozen `retiredInto` map now holds rows whose TARGET no longer exists: the
     * `names-masculine:my-X → names-masculine:X` rows (the register was retired whole in §3.6.30), and
     * `my-broodmare → broodmare` (cut here as an animal-sex leftover). The map is frozen by design, so those
     * rows stay — and this pins what they do: `bankEntry` cannot resolve the target, so the mark is retired
     * outright rather than migrating to a key with no row on any screen, which is the un-gettable-rid-of
     * preference §3.2 abolished.
     */
    const after = pruneUnshownMarks(
      lex([mark('names-breeding:my-broodmare', 'names-breeding', { hearState: 'love', hear: 3 })]),
      DIRTY_TALK.bank,
      OPEN_ORIENTATION,
      new Date(),
    );
    expect(after.changed).toBe(true);
    expect(after.lexicon.entries).toEqual([]);
  });

  it('never touches a custom write-in or another instrument’s entry', () => {
    const before = lex([
      mark('custom:names-warm:my-own-word', 'names-warm', { custom: true, hearState: 'never' }),
      mark('fantasy-scenes:some-scene', 'fantasy-scenes', { hearState: 'never' }),
    ]);
    const after = pruneUnshownMarks(before, DIRTY_TALK.bank, OPEN_ORIENTATION, new Date());
    expect(after.changed).toBe(false);
    expect(after.lexicon.entries).toHaveLength(2);
  });
});

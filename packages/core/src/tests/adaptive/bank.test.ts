import { describe, expect, it } from 'vitest';

import {
  bankByFamily,
  bankEntry,
  bankFamily,
  bankSlug,
  deckFamilies,
  nameFamilies,
  toLexiconEntry,
} from './bank';
import { DIRTY_TALK_BANK } from './instruments/dirtyTalkBank';
import { DIRTY_TALK } from './instruments/dirtyTalk';

/** A throwaway family for testing the key scheme itself. */
const FAM = { label: 'x', kind: 'phrase', directions: ['hear', 'say'] } as const;

describe('the dirty-talk bank (74 §13)', () => {
  it('is comprehensive — hundreds of entries across every family', () => {
    expect(DIRTY_TALK_BANK.entries.length).toBeGreaterThan(600);
    expect(DIRTY_TALK_BANK.families.length).toBeGreaterThanOrEqual(33);
    // Every declared family actually has entries — a family header with nothing under it is a bug.
    const byFamily = bankByFamily(DIRTY_TALK_BANK);
    for (const family of DIRTY_TALK_BANK.families) {
      expect(byFamily.get(family.id)?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('has unique, stable keys — a rating can never be orphaned by a relabel', () => {
    const keys = DIRTY_TALK_BANK.entries.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
    // The key is derived from the text, but it is the KEY that a rating is stored against (46 §4.2).
    expect(bankSlug('Pound my pussy')).toBe('pound-my-pussy');
    expect(bankSlug("don't stop")).toBe('don-t-stop');
  });

  it('scopes keys by family, so two families CAN hold the same phrase without colliding', () => {
    // The property is the key scheme's, not the content's — `bankFamily` prefixes every key with its family.
    // It used to be demonstrated with "taste me", which lived in three families until 74 §3.6.29 deduped
    // them; the mechanism still has to hold, because a future family may legitimately reuse a phrase.
    const [a, b] = [
      bankFamily({ ...FAM, id: 'fam-a' }, { 3: ['taste me'] }),
      bankFamily({ ...FAM, id: 'fam-b' }, { 3: ['taste me'] }),
    ];
    expect(a.entries[0]?.key).toBe('fam-a:taste-me');
    expect(b.entries[0]?.key).toBe('fam-b:taste-me');
    expect(a.entries[0]?.key).not.toBe(b.entries[0]?.key);
  });

  it('holds each line exactly once — no duplicates and no near-duplicates (74 §3.6.29)', () => {
    /*
     * 82 lines used to appear in two or three families ("taste me" in demands-receiving, oral AND taste), so
     * a person marked the same words up to three times — 92 redundant rows, 184 taps — and, worse, the copies
     * could disagree: `suppressedTexts` keys on TEXT, so a `never` on one copy suppressed the word everywhere,
     * including where another copy was loved.
     */
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const entry of DIRTY_TALK.bank.entries) {
      const text = entry.text.trim().toLowerCase();
      const prior = seen.get(text);
      if (prior) clashes.push(`"${entry.text}" in ${prior} and ${entry.family}`);
      else seen.set(text, entry.family);
    }
    expect(clashes).toEqual([]);
    // …and the keys stay unique, which is what a rating is actually stored against (46 §4.2).
    expect(new Set(DIRTY_TALK.bank.entries.map((e) => e.key)).size).toBe(
      DIRTY_TALK.bank.entries.length,
    );
  });

  it('tiers every entry 1..5 and carries both directions', () => {
    for (const entry of DIRTY_TALK_BANK.entries) {
      expect(entry.tier).toBeGreaterThanOrEqual(1);
      expect(entry.tier).toBeLessThanOrEqual(5);
      expect(entry.text.trim()).not.toBe('');
      expect(entry.directions).toEqual(['hear', 'say']);
    }
  });

  it('spans tame to extreme — every tier is represented', () => {
    const tiers = new Set(DIRTY_TALK_BANK.entries.map((entry) => entry.tier));
    expect([...tiers].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('carries the phrases people actually say, not just words', () => {
    const texts = new Set(DIRTY_TALK_BANK.entries.map((entry) => entry.text));
    for (const phrase of [
      'pound my pussy',
      'fuck me in the ass',
      'finger my asshole',
      'choke me',
      'suck that cock',
      'I can feel you throb',
      'stretch my ass',
      'cum in my mouth',
      'fill all my holes',
      'your dick is huge',
      'I wanna squirt all over you',
      'oh daddy',
      "I'm your little slut",
    ]) {
      expect(texts.has(phrase), `missing: ${phrase}`).toBe(true);
    }
  });

  it('keeps the taboo family framed as pre-agreed roleplay (74 §8.1)', () => {
    const taboo = DIRTY_TALK_BANK.families.find((family) => family.id === 'taboo');
    expect(taboo?.note).toMatch(/PRE-AGREED, SAFEWORDED ROLEPLAY/);
    expect(taboo?.note).toMatch(/minors, real non-consent, or anything illegal/i);
    const entries = bankByFamily(DIRTY_TALK_BANK).get('taboo') ?? [];
    // The whole family is tier 5, and each entry names the scene it belongs to so it can never read as a
    // description of anything real.
    for (const entry of entries) {
      expect(entry.tier).toBe(5);
      expect(entry.text).toMatch(/roleplay|fantasy|cuckold|hotwife|breeding|primal|CNC/i);
    }
  });

  it('builds an unrated lexicon entry from a bank entry', () => {
    const spec = bankEntry(DIRTY_TALK.bank, 'names-praise:good-girl');
    expect(spec).toBeDefined();
    const entry = toLexiconEntry(spec!, 'test:1');
    expect(entry).toMatchObject({
      key: spec!.key,
      text: 'good girl',
      hear: 0,
      say: 0,
      source: 'test:1',
    });
    expect(entry.hearState).toBeUndefined();
    expect(entry.sayState).toBeUndefined();
  });
});

describe('74 §3.6.1 #1 — the examples', () => {
  it('gives every WORD entry a hand-written example, since a bare word cannot be reacted to', () => {
    const words = DIRTY_TALK_BANK.entries.filter((e) => e.kind === 'word');
    const missing = words.filter((e) => !e.example || e.example.trim() === '');
    // ~200 hand-authored lines rot silently otherwise: nothing else in the app would notice one going away.
    expect(missing.map((e) => e.key)).toEqual([]);
  });

  it('examples every entry that is NOT already a whole line — the real rule, not just `kind`', () => {
    // `kind: 'word'` was the wrong denominator: a "phrase" family also holds bare fragments ("mine"), and a
    // delivery entry is a manner of speaking rather than a line at all. The test says what it means: an entry
    // you could not say ON ITS OWN needs the example, whatever family it happens to live in.
    const notAWholeLine = (e: { text: string; family: string; example?: string }): boolean => {
      if (e.family === 'delivery') return true; // "whispered" is a how, not a what
      // A scenario LABEL carries no spoken line of its own. `rape me (CNC roleplay)` is excluded on purpose:
      // it already IS the line, and its parenthetical is the frame.
      if (/roleplay( \(adults\))?$|\(fantasy roleplay\)$/.test(e.text)) return true;
      // A single bare noun/possessive with no verb — "mine", "all mine" — reads as a vocabulary item.
      return /^(mine|all mine|say it|both holes|one more)$/.test(e.text);
    };
    const missing = DIRTY_TALK_BANK.entries.filter((e) => notAWholeLine(e) && !e.example);
    expect(missing.map((e) => e.key)).toEqual([]);
  });

  it('gives every area a one-line description — the deck renders one per screen', () => {
    // 74 §3.6.4: the deck shows ONE area at a time, so the area has to say what it is and that skipping is
    // fine. 31 of 36 shipped blank the first time; nothing on screen would have told anyone.
    const noteless = DIRTY_TALK_BANK.families.filter((f) => !f.note || f.note.trim() === '');
    expect(noteless.map((f) => f.id)).toEqual([]);
  });

  it('never lets an example just restate the entry — it has to show it in use', () => {
    const lazy = DIRTY_TALK_BANK.entries.filter(
      (e) => e.example !== undefined && e.example.trim().toLowerCase() === e.text.toLowerCase(),
    );
    expect(lazy.map((e) => e.key)).toEqual([]);
  });

  it('keeps every example inside the boundary the bank itself sets', () => {
    // The content standard is the same one the entries carry (74 §8.1) — the examples are not an exception.
    const forbidden = /\b(child|kid|minor|teen|underage)\b/i;
    const bad = DIRTY_TALK_BANK.entries.filter((e) => e.example && forbidden.test(e.example));
    expect(bad.map((e) => e.key)).toEqual([]);
  });
});
describe('§3.6.3 — the identity preview only promises lines the bank actually has', () => {
  it('contains both example lines the preview shows', () => {
    // One of these was INVENTED and shipped, inside a comment claiming it came from the bank — so the
    // identity screen promised a line the deck could never show. Pinned here rather than trusted.
    const examples = DIRTY_TALK_BANK.entries.map((entry) => entry.example).filter(Boolean);
    expect(examples).toContain('your pussy is so wet for me');
    expect(examples).toContain('I can feel your hard cock through your jeans');
  });
});

describe('74 §3.6.8 — the pet-name bank', () => {
  const names = nameFamilies(DIRTY_TALK.bank);
  const deck = deckFamilies(DIRTY_TALK.bank);
  const nameEntries = DIRTY_TALK.bank.entries.filter((e) => names.some((f) => f.id === e.family));

  it('splits every family into exactly one phase — never both, never neither', () => {
    expect(names.length + deck.length).toBe(DIRTY_TALK.bank.families.length);
    expect(names.some((f) => deck.some((d) => d.id === f.id))).toBe(false);
    // 19 since §3.6.33 retired `names-breeding` (20 after §3.6.30's `names-masculine`). A floor, not a
    // target — the phase has to stay substantial, and a retirement that halved it should fail here rather
    // than pass quietly. It did exactly that on the breeding retirement, which is the point: each step down
    // is a deliberate, owner-approved edit, never a quiet drift.
    expect(names.length).toBeGreaterThanOrEqual(19);
  });

  it('gives every name a line showing it in use — a bare word is never the whole row', () => {
    const bare = nameEntries.filter((e) => !e.example || e.example.trim() === '');
    expect(bare).toEqual([]);
  });

  it("puts the name inside its own example, so the row's bolding always has something to bold", () => {
    const missing = nameEntries.filter(
      (e) => !e.example?.toLowerCase().includes(e.text.toLowerCase()),
    );
    expect(missing).toEqual([]);
  });

  it('keys every name uniquely, and says the same thing only once', () => {
    const keys = nameEntries.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    /*
     * The key is scoped by FAMILY, which is what lets the same word mean different things in two
     * registers -- and is why a cut must be by (family, text): "my gifted girl" is achievement praise
     * in names-praise and a girl who was GIVEN AWAY in names-sharing, so a text-keyed cut would have
     * taken the on-register one with it.
     *
     * That scoping is a licence for a genuine second MEANING, never for the same name twice. `papi`
     * was in masculine and other-tongues meaning exactly the same thing, so it was marked twice, and
     * one copy could hold a love while the other held a no -- the same defect the deck/names overlap
     * had (#534). Both halves are pinned: keys stay unique, and no text repeats.
     */
    const texts = nameEntries.map((e) => e.text.trim().toLowerCase());
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('renders every example as grammatical English (74 §3.6.33)', () => {
    /*
     * 61 names carried an example built from a BARE-NOUN template applied to a name that already owns a
     * possessive: "you're such a my cock queen", "someone's been a my sassy girl", "you filthy my greedy
     * slut", "you pathetic my imbecile". Broken English, on the one screen a person reads several hundred
     * rows of. The tell is an article or a bare modifier sitting immediately before `my`/`your`/`our`.
     */
    const broken = DIRTY_TALK.bank.entries.filter((e) =>
      /\b(a|an|little|filthy|pretty|pathetic|good)\s+(my|your|our)\b/i.test(e.example ?? ''),
    );
    expect(broken.map((e) => `${e.family}:${e.text} — ${e.example}`)).toEqual([]);
  });

  it('never ships a double-encoded dash or ellipsis (74 §3.6.33)', () => {
    // Four examples stored the mojibake ESCAPED (`\u00e2\u0080\u0094`), so it read as ASCII in the source
    // and only became U+00E2 + a C1 control at runtime — invisible to a decoded-text scan of the file.
    const mojibake = DIRTY_TALK.bank.entries.filter((e) =>
      /[\u00e2][\u0080-\u009f]/.test(`${e.text}${e.example ?? ''}`),
    );
    expect(mojibake.map((e) => `${e.family}:${e.text}`)).toEqual([]);
  });

  it('never lets an example flip the direction its own text names (74 §3.6.33)', () => {
    // `anatomy-her: your fuckhole` illustrated itself with "you're just MY fuckhole tonight" — the opposite
    // person's body from the one the entry names, on a screen whose whole job is hear-vs-say.
    const flipped = DIRTY_TALK.bank.entries.filter((e) => {
      const m = /^your\s+(.+)$/i.exec(e.text.trim());
      return m ? new RegExp(`\\bmy\\s+${m[1]}\\b`, 'i').test(e.example ?? '') : false;
    });
    expect(flipped.map((e) => `${e.family}:${e.text} — ${e.example}`)).toEqual([]);
  });

  it('never carries a name and its bare form as two rows', () => {
    // "my love" beside "love" is one name asked twice: the possessive changes nothing about what is
    // being decided, so it doubled the taps for nothing (owner, 2026-08-19). 184 pairs were cut.
    const byFamily = new Map<string, Set<string>>();
    for (const entry of nameEntries) {
      const set = byFamily.get(entry.family) ?? new Set<string>();
      set.add(entry.text.trim());
      byFamily.set(entry.family, set);
    }
    const pairs: string[] = [];
    for (const [family, texts] of byFamily) {
      for (const text of texts) {
        if (text.startsWith('my ') && texts.has(text.slice(3))) pairs.push(`${family}: ${text}`);
      }
    }
    expect(pairs).toEqual([]);
  });

  it('asks every name BOTH ways — the whole point of the phase', () => {
    expect(
      nameEntries.every((e) => e.directions.includes('hear') && e.directions.includes('say')),
    ).toBe(true);
  });

  it('carries the roleplay framing on every register that needs it', () => {
    for (const id of ['names-roleplay', 'names-innocence']) {
      const family = names.find((f) => f.id === id);
      expect(family?.note?.toLowerCase()).toMatch(/adult|roleplay/);
    }
  });

  it('never names a minor in any roleplay register', () => {
    const forbidden =
      /\b(child|kid|kids|minor|teen|teenage|schoolgirl|schoolboy|underage|toddler|infant)\b/i;
    const offenders = nameEntries.filter(
      (e) => forbidden.test(e.text) || forbidden.test(e.example ?? ''),
    );
    expect(offenders.map((e) => e.text)).toEqual([]);
  });
});

describe('§3.6.9 — the deck and the pet-name phase never ask the same thing twice', () => {
  it('shares no term between the two phases', () => {
    // Nine did, when the names phase landed: "good girl", "mine", "my girl", "dirty little slut" and the rest
    // were in a deck family AND a name register. They are two different lexicon keys, so the person marked the
    // same words twice and the profile could hold both a loved-to-hear and a hard no for one term. The names
    // phase asks each of them in BOTH directions, which is strictly better, so the deck gave them up.
    const nameIds = new Set(nameFamilies(DIRTY_TALK.bank).map((family) => family.id));
    const deckIds = new Set(deckFamilies(DIRTY_TALK.bank).map((family) => family.id));
    const inNames = new Set(
      DIRTY_TALK.bank.entries
        .filter((entry) => nameIds.has(entry.family))
        .map((entry) => entry.text.toLowerCase()),
    );
    const twice = DIRTY_TALK.bank.entries
      .filter((entry) => deckIds.has(entry.family) && inNames.has(entry.text.toLowerCase()))
      .map((entry) => `${entry.family}:${entry.text}`);
    expect(twice).toEqual([]);
  });
});

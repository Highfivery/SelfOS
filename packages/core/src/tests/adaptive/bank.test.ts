import { describe, expect, it } from 'vitest';

import {
  bankByFamily,
  bankEntry,
  bankSlug,
  deckFamilies,
  nameFamilies,
  toLexiconEntry,
} from './bank';
import { DIRTY_TALK_BANK } from './instruments/dirtyTalkBank';
import { DIRTY_TALK } from './instruments/dirtyTalk';

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

  it('scopes keys by family, so the same phrase can appear in two families', () => {
    // "taste me" is both a demand and a taste-family entry; they must not collide.
    const demand = bankEntry(DIRTY_TALK_BANK, 'demands-receiving:taste-me');
    const taste = bankEntry(DIRTY_TALK_BANK, 'taste:taste-me');
    expect(demand?.text).toBe('taste me');
    expect(taste?.text).toBe('taste me');
    expect(demand?.family).not.toBe(taste?.family);
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
    expect(entry.state).toBeUndefined();
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
  const nameEntries = DIRTY_TALK.bank.entries.filter((e) =>
    names.some((f) => f.id === e.family),
  );

  it('splits every family into exactly one phase — never both, never neither', () => {
    expect(names.length + deck.length).toBe(DIRTY_TALK.bank.families.length);
    expect(names.some((f) => deck.some((d) => d.id === f.id))).toBe(false);
    expect(names.length).toBeGreaterThan(20);
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

  it('keys every name uniquely, including the ones that appear in two registers', () => {
    const keys = nameEntries.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    // "my everything" is warm AND worship; each copy is its own row with its own line.
    expect(keys.filter((k) => k.endsWith(':my-everything')).length).toBeGreaterThan(1);
  });

  it('asks every name BOTH ways — the whole point of the phase', () => {
    expect(nameEntries.every((e) => e.directions.includes('hear') && e.directions.includes('say'))).toBe(
      true,
    );
  });

  it('carries the roleplay framing on every register that needs it', () => {
    for (const id of ['names-kinship', 'names-roleplay', 'names-innocence', 'names-agegap']) {
      const family = names.find((f) => f.id === id);
      expect(family?.note?.toLowerCase()).toMatch(/adult|roleplay/);
    }
  });

  it('never names a minor in any roleplay register', () => {
    const forbidden = /\b(child|kid|kids|minor|teen|teenage|schoolgirl|schoolboy|underage|toddler|infant)\b/i;
    const offenders = nameEntries.filter(
      (e) => forbidden.test(e.text) || forbidden.test(e.example ?? ''),
    );
    expect(offenders.map((e) => e.text)).toEqual([]);
  });
})

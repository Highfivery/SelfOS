import { describe, expect, it } from 'vitest';

import { bankByFamily, bankEntry, bankSlug, toLexiconEntry } from './bank';
import { DIRTY_TALK_BANK } from './instruments/dirtyTalkBank';

describe('the dirty-talk bank (74 §13)', () => {
  it('is comprehensive — hundreds of entries across every family', () => {
    expect(DIRTY_TALK_BANK.entries.length).toBeGreaterThan(600);
    expect(DIRTY_TALK_BANK.families.length).toBeGreaterThanOrEqual(36);
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
    const spec = bankEntry(DIRTY_TALK_BANK, 'names-power:good-girl');
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

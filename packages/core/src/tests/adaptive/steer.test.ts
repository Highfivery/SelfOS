import { describe, expect, it } from 'vitest';

import { memFileSystem } from '../../host/memFileSystem';
import type { FileSystem } from '../../host';
import { upsertPerson } from '../../people/peopleService';
import { upsertRelationship } from '../../people/relationshipService';
import { DIRTY_TALK_BANK } from './instruments/dirtyTalkBank';
import { applyBankMarks, applyDirections, emptyLexicon, writeLexicon } from './lexicon';
import {
  buildOwnLexiconBlock,
  buildPartnerSteer,
  buildSuppressionBlock,
  livePartnerOf,
} from './steer';

const NOW = new Date('2026-08-16T12:00:00.000Z');
const KEY = new Uint8Array(32).fill(5);

async function seedPair(): Promise<{ fs: FileSystem; ben: string; angel: string; relId: string }> {
  const fs = memFileSystem();
  const ben = (await upsertPerson(fs, KEY, { displayName: 'Ben', isSubject: true, tags: [] })).id;
  const angel = (await upsertPerson(fs, KEY, { displayName: 'Angel', isSubject: true, tags: [] }))
    .id;
  const rel = await upsertRelationship(fs, KEY, {
    fromPersonId: ben,
    toPersonId: angel,
    type: 'partner',
  });
  // Angel's lexicon: loves being claimed, one hard no, one theme.
  let lex = applyBankMarks(
    emptyLexicon(angel, NOW),
    DIRTY_TALK_BANK,
    { 'names-power:good-girl': 'love', 'claiming:mine': 'love', 'names-degrading:whore': 'never' },
    'take:1',
    NOW,
  );
  lex = applyDirections(lex, { 'names-power:good-girl': { hear: 4, say: 0 } }, NOW);
  lex = { ...lex, themes: ['being claimed, not degraded'], voice: 'low, close, certain.' };
  await writeLexicon(fs, KEY, lex);
  return { fs, ben, angel, relId: rel.id };
}

describe('the lexicon steer (74 §5.7/§8.4)', () => {
  it('gives a person their OWN words back, hard limits included', async () => {
    const { fs, angel } = await seedPair();
    const { readLexicon } = await import('./lexicon');
    const block = buildOwnLexiconBlock(await readLexicon(fs, KEY, angel));
    expect(block).toContain('good girl');
    expect(block).toContain('NEVER use');
    expect(block).toContain('whore');
    // The gap is framed as something to practise, never a failing.
    expect(block).toContain('PRACTISE');
  });

  it('steers a partner SILENTLY — their words, never the source', async () => {
    const { fs, ben } = await seedPair();
    const partnerId = await livePartnerOf(fs, KEY, ben);
    expect(partnerId).toBeTruthy();
    const steer = await buildPartnerSteer(fs, KEY, ben, partnerId!, true);
    // The owner chose full fidelity: her actual words reach his coach (74 §8.4).
    expect(steer).toContain('good girl');
    expect(steer).toContain('being claimed, not degraded');
    expect(steer).toContain('low, close, certain.');
    // …but never attributed, and never explained.
    expect(steer).toContain('NEVER say it came from their partner');
    expect(steer).not.toMatch(/Angel/);
  });

  it('drops the steer when either 18+ ack is missing', async () => {
    const { fs, ben, angel } = await seedPair();
    expect(await buildPartnerSteer(fs, KEY, ben, angel, false)).toBe('');
  });

  it('drops the steer the moment the partner edge is removed', async () => {
    const { fs, ben, angel, relId } = await seedPair();
    expect(await buildPartnerSteer(fs, KEY, ben, angel, true)).not.toBe('');
    const { deleteRelationship } = await import('../../people/relationshipService');
    await deleteRelationship(fs, relId);
    expect(await buildPartnerSteer(fs, KEY, ben, angel, true)).toBe('');
    expect(await livePartnerOf(fs, KEY, ben)).toBeNull();
  });

  it('SUPPRESSES her hard nos in his prompt with or without any steer, and never says why', async () => {
    const { fs, ben, angel } = await seedPair();
    const block = await buildSuppressionBlock(fs, KEY, ben, angel);
    expect(block).toContain('whore');
    expect(block).toContain('NEVER suggest');
    expect(block).toContain('never say why');
    // It carries the boundary and NOTHING else about her — not what she likes, not that a test exists.
    expect(block).not.toContain('good girl');
  });

  it('never steers or suppresses toward yourself', async () => {
    const { fs, ben } = await seedPair();
    expect(await buildPartnerSteer(fs, KEY, ben, ben, true)).toBe('');
    expect(await buildSuppressionBlock(fs, KEY, ben, ben)).toBe('');
  });
});

describe('the couples block (74 §5.8)', () => {
  it('is NAME-FREE and never attributes a preference to one partner', async () => {
    const { fs, ben, angel } = await seedPair();
    const { buildCouplesLexiconBlock } = await import('./steer');
    const block = await buildCouplesLexiconBlock(fs, KEY, [ben, angel]);
    // Both partners READ this conversation, so a named block is one person's file read aloud.
    expect(block).not.toMatch(/Angel|Ben/);
    expect(block).toContain('NEVER say which of them likes what');
    // The union of both hard-no lists rides along — a limit either drew is never suggested to either.
    expect(block).toContain('whore');
    // …and the goal list (the shame material) never appears in the shared room at all.
    expect(block).not.toMatch(/freezes|PRACTISE/);
  });
});

describe('the middle mark is not write-only (74 §3.6.2)', () => {
  it('names what they marked "It\'s okay" as usable, and keeps it out of the loved list', async () => {
    const { fs, angel } = await seedPair();
    const { readLexicon } = await import('./lexicon');
    const lex = await readLexicon(fs, KEY, angel);
    await writeLexicon(fs, KEY, {
      ...lex,
      entries: [
        ...lex.entries,
        {
          key: 'taboo:filthy',
          text: 'filthy',
          kind: 'word' as const,
          family: 'taboo',
          tier: 3 as const,
          hear: 0,
          say: 0,
          state: 'okay' as const,
        },
      ],
    });
    const block = buildOwnLexiconBlock(await readLexicon(fs, KEY, angel));
    expect(block).toContain('filthy');
    // Second-tier by construction — a mild yes must never read as a want.
    expect(block).toMatch(/not favourites/i);
    const loved = block.slice(block.indexOf('Loves to hear'), block.indexOf('Fine with'));
    expect(loved).not.toContain('filthy');
  });

  it('builds a block for someone whose ONLY answers were "It\'s okay"', async () => {
    // The early return used to check loved + banned only, so a person who marked nothing else got nothing.
    const fs = memFileSystem();
    const lex = {
      ...emptyLexicon('solo', NOW),
      entries: [
        {
          key: 'taboo:filthy',
          text: 'filthy',
          kind: 'word' as const,
          family: 'taboo',
          tier: 3 as const,
          hear: 0,
          say: 0,
          state: 'okay' as const,
        },
      ],
    };
    await writeLexicon(fs, KEY, lex);
    expect(buildOwnLexiconBlock(lex)).toContain('filthy');
  });

  it('keeps the mild yes OUT of the partner steer — it is not what lands', async () => {
    const { fs, ben, angel } = await seedPair();
    const { readLexicon } = await import('./lexicon');
    const lex = await readLexicon(fs, KEY, angel);
    await writeLexicon(fs, KEY, {
      ...lex,
      entries: [
        ...lex.entries,
        {
          key: 'taboo:filthy',
          text: 'filthy',
          kind: 'word' as const,
          family: 'taboo',
          tier: 3 as const,
          hear: 0,
          say: 0,
          state: 'okay' as const,
        },
      ],
    });
    const steer = await buildPartnerSteer(fs, KEY, ben, angel, true);
    expect(steer).toContain('good girl');
    expect(steer).not.toContain('filthy');
  });
});

describe('the hard-no list is never truncated (74 §8.4)', () => {
  it('carries EVERY boundary, however many there are — no cap, deliberately', async () => {
    // Every other list here is capped at 20 to keep the prompt cheap. The boundary list is the one that must
    // not be: a dropped hard no is not a smaller prompt, it is a limit the coach never learns. This is the
    // tripwire for someone "tidying up" by giving `banned` the same `.slice(0, CAP)` as its neighbours.
    const many = Array.from({ length: 120 }, (_, i) => `never-word-${i}`);
    const lex = {
      ...emptyLexicon('solo', NOW),
      boundaries: many.map((text) => ({ text, kind: 'word' as const, at: NOW.toISOString() })),
    };
    const block = buildOwnLexiconBlock(lex);
    for (const text of many) expect(block).toContain(text);
  });
});
describe('§3.6.2 — REGISTER steers generation, which the word list cannot', () => {
  it('names the register that lands and the one that does not, in both blocks', async () => {
    // The owner's case: "fuck your pussy" lands, "beat that pussy" does not. Same word — the difference is
    // register, and the synthesis has been scoring it on every take while nothing read the result.
    const { fs, ben, angel } = await seedPair();
    const { readLexicon } = await import('./lexicon');
    const lex = await readLexicon(fs, KEY, angel);
    await writeLexicon(fs, KEY, {
      ...lex,
      registers: { claiming: 0.9, praise: 0.7, degradation: 0.1, command: 0.45 },
    });

    const own = buildOwnLexiconBlock(await readLexicon(fs, KEY, angel));
    expect(own).toMatch(/register that lands/i);
    expect(own).toContain('claiming / possession');
    expect(own).toMatch(/do NOT land/i);
    expect(own).toContain('degradation');
    // A middling score says nothing useful, so it is named in neither list.
    expect(own).not.toContain('command');

    // It matters MORE in the partner steer — that is the half handing them words to say.
    const steer = await buildPartnerSteer(fs, KEY, ben, angel, true);
    expect(steer).toContain('claiming / possession');
    expect(steer).toMatch(/avoid this framing/i);
  });

  it('is honest that a register miss is not a boundary', async () => {
    // A low register score must not read as a hard no — their hard nos are the separate, absolute list.
    const { fs, angel } = await seedPair();
    const { readLexicon } = await import('./lexicon');
    const lex = await readLexicon(fs, KEY, angel);
    await writeLexicon(fs, KEY, { ...lex, registers: { degradation: 0.05 } });
    const own = buildOwnLexiconBlock(await readLexicon(fs, KEY, angel));
    expect(own).toMatch(/even with words they like/i);
    // The absolute list is still its own, separately-worded thing.
    expect(own).toMatch(/NEVER use, in any form/i);
  });
});

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

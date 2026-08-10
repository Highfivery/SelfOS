import { describe, expect, it } from 'vitest';

import { generateMasterKey } from '../crypto';
import type { FileSystem } from '../host';
import { memFileSystem } from '../host/memFileSystem';
import { upsertPerson } from '../people/peopleService';
import { upsertRelationship } from '../people/relationshipService';

import { addPartnerWish, writeProfile, emptyProfile } from './personalizationProfile';
import { buildPartnerWishGuidance } from './partnerWishes';

const key = generateMasterKey();
const at = new Date('2026-08-09T00:00:00.000Z');

/** Two people; `partner` when `link` — returns their ids. */
async function seed(link: boolean): Promise<{ fs: FileSystem; a: string; b: string }> {
  const fs = memFileSystem();
  const ana = await upsertPerson(fs, key, { displayName: 'Ana', isSubject: true, tags: [] });
  const ben = await upsertPerson(fs, key, { displayName: 'Ben', isSubject: true, tags: [] });
  if (link) {
    await upsertRelationship(fs, key, {
      fromPersonId: ana.id,
      toPersonId: ben.id,
      type: 'partner',
    });
  }
  return { fs, a: ana.id, b: ben.id };
}

describe('buildPartnerWishGuidance', () => {
  it('surfaces a live partner’s wishes to steer generation, and NEVER attributes them (silent)', async () => {
    const { fs, a, b } = await seed(true);
    await writeProfile(
      fs,
      key,
      addPartnerWish(emptyProfile(a), { partnerPersonId: b, note: 'try a weekend away' }, at),
    );
    const block = await buildPartnerWishGuidance(fs, key, a, b, false);
    expect(block).toContain('try a weekend away'); // the topic reaches generation
    // Silent: the model is told NEVER to attribute it — the wording forbids "someone requested" / partner framing.
    expect(block).toMatch(/NEVER/);
    expect(block).toMatch(/never say these came from anyone/i);
    // The block is a topic STEER, not an attributed disclosure — it presents the wish as the model's own curiosity.
    expect(block).toMatch(/as YOUR OWN questions/i);
  });

  it('returns "" without a LIVE partner edge (a removed edge drops the steer — the re-gate)', async () => {
    const { fs, a, b } = await seed(false); // no partner edge
    await writeProfile(
      fs,
      key,
      addPartnerWish(emptyProfile(a), { partnerPersonId: b, note: 'a wish' }, at),
    );
    expect(await buildPartnerWishGuidance(fs, key, a, b, true)).toBe('');
  });

  it('an intimacy wish steers only when BOTH partners have acked 18+ (§8)', async () => {
    const { fs, a, b } = await seed(true);
    let profile = addPartnerWish(emptyProfile(a), { partnerPersonId: b, note: 'a plain wish' }, at);
    profile = addPartnerWish(
      profile,
      { partnerPersonId: b, note: 'an intimate wish', intimacy: true },
      at,
    );
    await writeProfile(fs, key, profile);
    // Not both-acked: the intimacy wish is withheld, the plain one steers.
    const gated = await buildPartnerWishGuidance(fs, key, a, b, false);
    expect(gated).toContain('a plain wish');
    expect(gated).not.toContain('an intimate wish');
    // Both-acked: both steer.
    const acked = await buildPartnerWishGuidance(fs, key, a, b, true);
    expect(acked).toContain('a plain wish');
    expect(acked).toContain('an intimate wish');
  });

  it('a self target (requester === partner) returns ""', async () => {
    const { fs, a } = await seed(true);
    await writeProfile(
      fs,
      key,
      addPartnerWish(emptyProfile(a), { partnerPersonId: a, note: 'x' }, at),
    );
    expect(await buildPartnerWishGuidance(fs, key, a, a, true)).toBe('');
  });
});

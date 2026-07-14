import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { FileSystem } from '../host';
import {
  listStandingAgreementsForViewer,
  saveAgreement,
  standingAgreements,
} from './agreementService';
import { pairKeyFor } from './togetherService';

const key = generateMasterKey();
const BEN = 'ben';
const ANGEL = 'angel';
const CASS = 'cass';
const NOW = new Date('2026-07-14T12:00:00.000Z');

async function seed(
  fs: FileSystem,
  a: string,
  b: string,
  text: string,
  status: 'standing' | 'done' | 'retired',
  sessionId = 'sess-1',
): Promise<void> {
  await saveAgreement(fs, key, a, b, { text, status, sessionId }, NOW);
}

describe('listStandingAgreementsForViewer (spec 61)', () => {
  it('returns only the viewer’s pairs’ STANDING agreements, with the partner id resolved', async () => {
    const fs = memFileSystem();
    await seed(fs, BEN, ANGEL, 'Date night Fridays', 'standing');
    await seed(fs, BEN, ANGEL, 'A retired one', 'retired');
    await seed(fs, ANGEL, BEN, 'Text before bed', 'standing'); // same pair, other order
    await seed(fs, BEN, CASS, 'Weekly walk', 'standing'); // a different partner
    await seed(fs, ANGEL, CASS, 'Not Ben’s pair', 'standing'); // a pair Ben is NOT in

    const rows = await listStandingAgreementsForViewer(fs, key, BEN);
    const texts = rows.map((r) => r.agreement.text).sort();

    expect(texts).toEqual(['Date night Fridays', 'Text before bed', 'Weekly walk']);
    // Not the retired one, not the angel~cass pair Ben isn't a member of.
    expect(texts).not.toContain('A retired one');
    expect(texts).not.toContain('Not Ben’s pair');

    // The partner id is the OTHER member of each pair.
    const angel = rows.find((r) => r.agreement.text === 'Date night Fridays');
    const cass = rows.find((r) => r.agreement.text === 'Weekly walk');
    expect(angel?.partnerPersonId).toBe(ANGEL);
    expect(cass?.partnerPersonId).toBe(CASS);
  });

  it('returns [] when the viewer has no pairs, and skips a corrupt entry without failing', async () => {
    const fs = memFileSystem();
    expect(await listStandingAgreementsForViewer(fs, key, BEN)).toEqual([]);

    await seed(fs, BEN, ANGEL, 'Real one', 'standing');
    // A corrupt file in the agreements dir — must be skipped, not throw.
    await fs.writeAtomic(
      `together/pairs/${pairKeyFor(BEN, ANGEL)}/agreements/bad.enc`,
      new TextEncoder().encode('not json'),
    );
    const rows = await listStandingAgreementsForViewer(fs, key, BEN);
    expect(rows.map((r) => r.agreement.text)).toEqual(['Real one']);
  });

  it('standingAgreements filters to standing only', () => {
    const base = {
      id: 'x',
      schemaVersion: 1 as const,
      pairKey: 'a~b',
      text: 't',
      provenance: { sessionId: 's', at: '' },
      createdAt: '',
      updatedAt: '',
    };
    const list = [
      { ...base, id: '1', status: 'standing' as const },
      { ...base, id: '2', status: 'done' as const },
      { ...base, id: '3', status: 'retired' as const },
    ];
    expect(standingAgreements(list).map((a) => a.id)).toEqual(['1']);
  });
});

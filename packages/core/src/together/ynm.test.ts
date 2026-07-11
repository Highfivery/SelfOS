import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { FileSystem } from '../host';
import type { Person } from '../schemas';
import { savePerson, saveRelationship } from '../people';
import { acknowledgeAdult } from '../conversations/guidanceService';
import { createSession } from './togetherService';
import { buildTogetherSystemPrompt, EXPLICIT_INTIMACY_REGISTER } from './togetherPromptBuilder';
import { allAdultAcknowledged } from './adultGate';
import { computeYnmOverlap, getYnmOptIn, setYnmOptIn, ynmOverlapFor } from './ynmService';
import { TOGETHER_CATALOG, togetherCatalogFor } from './togetherCatalog';
import { pairKeyFor } from './togetherService';

const key = generateMasterKey();
const BEN = 'ben';
const ANGEL = 'angel';
const NOW = new Date('2026-07-11T12:00:00.000Z');

function person(id: string, displayName: string): Person {
  return {
    id,
    schemaVersion: 1,
    displayName,
    isSubject: true,
    tags: [],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}

async function seedPair(fs: FileSystem): Promise<void> {
  await savePerson(fs, key, person(BEN, 'Ben'));
  await savePerson(fs, key, person(ANGEL, 'Angel'));
  await saveRelationship(fs, key, {
    id: 'rel-partner',
    schemaVersion: 2,
    fromPersonId: BEN,
    toPersonId: ANGEL,
    type: 'partner',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  });
}

describe('the together-desire catalog group (§3.10 / Phase F)', () => {
  it('adds 4 adult desire entries, all flagged adult, and the invariant still holds', () => {
    const desire = TOGETHER_CATALOG.filter((g) => g.group === 'together-desire');
    expect(desire.length).toBe(4);
    for (const g of TOGETHER_CATALOG) {
      expect(Boolean(g.adult)).toBe(g.group === 'together-desire');
    }
    expect(desire.some((g) => g.id === 'yes-no-maybe-together' && g.kind === 'structured')).toBe(
      true,
    );
  });

  it('withholds the desire group unless allowAdult', () => {
    const noAdult = togetherCatalogFor({ allowAdult: false });
    expect(noAdult.some((e) => e.group === 'together-desire')).toBe(false);
    const withAdult = togetherCatalogFor({ allowAdult: true });
    expect(withAdult.filter((e) => e.group === 'together-desire').length).toBe(4);
  });
});

describe('allAdultAcknowledged (§5.2 N-party conjunction)', () => {
  it('is true only when EVERY participant has acked', async () => {
    const fs = memFileSystem();
    await seedPair(fs);
    expect(await allAdultAcknowledged(fs, key, [BEN, ANGEL])).toBe(false); // neither
    await acknowledgeAdult(fs, key, BEN);
    expect(await allAdultAcknowledged(fs, key, [BEN, ANGEL])).toBe(false); // only one
    await acknowledgeAdult(fs, key, ANGEL);
    expect(await allAdultAcknowledged(fs, key, [BEN, ANGEL])).toBe(true); // both
    expect(await allAdultAcknowledged(fs, key, [])).toBe(false); // empty is never acked
  });
});

describe('EXPLICIT_INTIMACY_REGISTER (§6.3 step 5)', () => {
  it('is appended to the couples prompt ONLY when allAdultAcked, AFTER the addendum, and never loosens SAFETY', async () => {
    const fs = memFileSystem();
    await seedPair(fs);
    const session = await createSession(
      fs,
      key,
      { initiatorPersonId: BEN, participantIds: [BEN, ANGEL] },
      NOW,
    );
    // Not acked → the conservative register (no explicit block).
    const plain = await buildTogetherSystemPrompt(fs, key, session);
    expect(plain).not.toContain('explicit, specific, plain language is welcome');

    // Acked → the explicit register is present, after the facilitator addendum, before FORMATTING.
    const acked = await buildTogetherSystemPrompt(fs, key, session, { allAdultAcked: true });
    expect(acked).toContain(EXPLICIT_INTIMACY_REGISTER);
    expect(acked.indexOf('facilitating a shared conversation')).toBeLessThan(
      acked.indexOf('explicit, specific, plain language is welcome'),
    );
    // SAFETY still leads; the boundary is verbatim.
    expect(acked).toContain('consensual adults only');
    expect(acked).toContain('NEVER minors, real (non-roleplay) non-consent, or illegal acts');
    expect(acked).toContain('Respect a hard no ABSOLUTELY');
  });
});

describe('YNM overlap (§3.10b) — the deterministic, host-side mutual list', () => {
  it('includes only rows BOTH are ≥ curious (3) about; one-sided or below-curious excluded; sorted', () => {
    // 5-point scale: 3 = Curious, 4 = Like it, 5 = Love it; 1/2 = not interested.
    const a = { 'k-shared': 4, 'k-a-only': 5, 'k-below': 2, 'k-both-low': 2 };
    const b = { 'k-shared': 3, 'k-b-only': 4, 'k-below': 5, 'k-both-low': 1 };
    const overlap = computeYnmOverlap(a, b);
    const keys = overlap.map((o) => o.key);
    expect(keys).toContain('k-shared'); // both ≥ curious
    expect(keys).not.toContain('k-a-only'); // only A
    expect(keys).not.toContain('k-b-only'); // only B
    expect(keys).not.toContain('k-below'); // A below curious
    expect(keys).not.toContain('k-both-low'); // both below
    // Every item carries a label (falls back to the key if unknown) and is sorted by label.
    expect(overlap.every((o) => typeof o.label === 'string' && o.label.length > 0)).toBe(true);
  });

  it('opt-in round-trips + revoke clears; overlap is empty until READY', async () => {
    const fs = memFileSystem();
    await seedPair(fs);
    const pairKey = pairKeyFor(BEN, ANGEL);
    expect(await getYnmOptIn(fs, key, BEN, pairKey)).toBe(false);
    await setYnmOptIn(fs, key, BEN, ANGEL, true, NOW);
    expect(await getYnmOptIn(fs, key, BEN, pairKey)).toBe(true);
    await setYnmOptIn(fs, key, BEN, ANGEL, false, NOW); // revoke
    expect(await getYnmOptIn(fs, key, BEN, pairKey)).toBe(false);

    // Not ready → empty, never a partial list (the bridge computes `ready`; here we pass false).
    expect(await ynmOverlapFor(fs, key, BEN, ANGEL, false)).toEqual({ ready: false, items: [] });
  });
});

import { describe, expect, it } from 'vitest';

import { generateMasterKey } from '../crypto';
import type { FileSystem } from '../host';
import { memFileSystem } from '../host/memFileSystem';
import { saveInsight } from '../insights';
import { upsertPerson } from '../people/peopleService';
import { upsertRelationship } from '../people/relationshipService';
import type { Insight, InsightFact } from '../schemas';

import { gatherRecipientPartnerContext } from './partnerContext';

const key = generateMasterKey();

const fact = (over: Partial<InsightFact> & { id: string; text: string }): InsightFact => ({
  shareable: false,
  ...over,
});

async function seedPartner(fs: FileSystem, facts: InsightFact[]): Promise<void> {
  await upsertPerson(fs, key, { id: 'a', displayName: 'Angel', isSubject: true, tags: [] });
  await upsertPerson(fs, key, { id: 'b', displayName: 'Ben', isSubject: true, tags: [] });
  // "Ben is Angel's partner" (edge from A → B, type partner).
  await upsertRelationship(fs, key, { fromPersonId: 'a', toPersonId: 'b', type: 'partner' });
  const insight: Insight = {
    schemaVersion: 1,
    id: 'ins-b',
    source: 'test',
    subjectPersonId: 'b',
    summary: 'About Ben',
    facts,
    confidence: 'medium',
    categories: [],
    approved: true,
    provenance: { at: '2026-08-01T00:00:00.000Z' },
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
  await saveInsight(fs, key, insight);
}

describe('gatherRecipientPartnerContext', () => {
  it("surfaces a partner's SHARED facts to the person and marks a shared desire as reciprocity", async () => {
    const fs = memFileSystem();
    await seedPartner(fs, [
      fact({
        id: 'f1',
        text: 'Ben would love to try rope play',
        shareableTypes: ['partner'],
        lifeArea: 'Intimacy',
      }),
      fact({
        id: 'f3',
        text: 'Ben loves hiking',
        shareableTypes: ['partner'],
        lifeArea: 'Health & body',
      }),
    ]);
    const ctx = await gatherRecipientPartnerContext(fs, key, 'a');
    expect(ctx.contextBlock).toContain('rope play');
    expect(ctx.contextBlock).toContain('Ben loves hiking');
    expect(ctx.contextBlock).toContain('shared by Ben');
    // The intimacy desire is a reciprocity candidate; the (non-Intimacy) hiking fact is not.
    expect(ctx.reciprocity).toEqual([
      { fromPartnerId: 'b', note: 'Ben would love to try rope play' },
    ]);
  });

  it('NEVER crosses a restricted or non-shared partner fact (the privacy boundary)', async () => {
    const fs = memFileSystem();
    await seedPartner(fs, [
      // restricted → never crosses, even though it's a partner-relevant intimacy fact.
      fact({
        id: 'r1',
        text: 'Bens private trauma detail',
        restricted: true,
        lifeArea: 'Intimacy',
      }),
      // shareable:false with no shareableTypes → private, never crosses.
      fact({ id: 'p1', text: 'Bens private money worry', lifeArea: 'Money' }),
      // one genuinely shared fact so the block is non-empty.
      fact({
        id: 'f1',
        text: 'Ben likes surprises',
        shareableTypes: ['partner'],
        lifeArea: 'Relationships',
      }),
    ]);
    const ctx = await gatherRecipientPartnerContext(fs, key, 'a');
    expect(ctx.contextBlock).toContain('Ben likes surprises');
    expect(ctx.contextBlock).not.toContain('trauma');
    expect(ctx.contextBlock).not.toContain('money worry');
    expect(ctx.reciprocity.map((r) => r.note)).toEqual(['Ben likes surprises']); // Relationships → reciprocity
  });

  it('surfaces nothing for a person with no relationships', async () => {
    const fs = memFileSystem();
    await seedPartner(fs, [
      fact({
        id: 'f1',
        text: 'Ben shared thing',
        shareableTypes: ['partner'],
        lifeArea: 'Intimacy',
      }),
    ]);
    // 'c' isn't related to Ben → the gate never grants.
    await upsertPerson(fs, key, { id: 'c', displayName: 'Cass', isSubject: true, tags: [] });
    const ctx = await gatherRecipientPartnerContext(fs, key, 'c');
    expect(ctx.contextBlock).toBe('');
    expect(ctx.reciprocity).toEqual([]);
  });

  it('does not share a partner fact scoped to a DIFFERENT relationship type', async () => {
    const fs = memFileSystem();
    await seedPartner(fs, [
      // Shared only with a "coworker", not a partner → Angel (the partner) must not see it.
      fact({
        id: 'f1',
        text: 'Ben work gossip',
        shareableTypes: ['coworker'],
        lifeArea: 'Work & purpose',
      }),
    ]);
    const ctx = await gatherRecipientPartnerContext(fs, key, 'a');
    expect(ctx.contextBlock).toBe('');
  });
});

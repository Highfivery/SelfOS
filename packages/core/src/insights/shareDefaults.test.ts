import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { FileSystem } from '../host';
import type { Insight, InsightFact } from '../schemas';
import { backfillPartnerSharing } from './backfillSharing';
import { listInsightsForPerson, saveInsight } from './insightStore';
import { DEFAULT_INSIGHT_SHARE_TYPES, producedFactShare } from './shareDefaults';

const key = generateMasterKey();
const at = '2026-07-17T12:00:00.000Z';

function insight(id: string, facts: InsightFact[], partial: Partial<Insight> = {}): Insight {
  return {
    id,
    schemaVersion: 1,
    source: 'session',
    subjectPersonId: 'p1',
    summary: 's',
    facts,
    confidence: 'medium',
    categories: [],
    approved: true,
    provenance: { conversationId: 'c1', at },
    createdAt: at,
    updatedAt: at,
    ...partial,
  };
}

async function factsOf(fs: FileSystem, id: string): Promise<InsightFact[]> {
  const all = await listInsightsForPerson(fs, key, 'p1');
  return all.find((i) => i.id === id)?.facts ?? [];
}

describe('producedFactShare', () => {
  it('defaults a non-restricted fact to shared-with-partner (never broadcast)', () => {
    expect(producedFactShare()).toEqual({ shareable: false, shareableTypes: ['partner'] });
    expect(producedFactShare(false)).toEqual({ shareable: false, shareableTypes: ['partner'] });
    expect(DEFAULT_INSIGHT_SHARE_TYPES).toEqual(['partner']);
  });

  it('keeps a restricted fact private with no type scope (break-glass never auto-shares)', () => {
    expect(producedFactShare(true)).toEqual({ shareable: false, restricted: true });
    expect(producedFactShare(true).shareableTypes).toBeUndefined();
  });

  it('a prior EXPLICIT scope overrides the default (a re-analysis never reverts an un-share)', () => {
    // The user un-shared → `[]` carried forward stays `[]`, not the partner default.
    expect(producedFactShare(false, [])).toEqual({ shareable: false, shareableTypes: [] });
    // A broadened scope is preserved too.
    expect(producedFactShare(false, ['sibling'])).toEqual({
      shareable: false,
      shareableTypes: ['sibling'],
    });
    // A restricted fact ignores any prior scope (break-glass never carries a type scope).
    expect(producedFactShare(true, ['partner'])).toEqual({ shareable: false, restricted: true });
  });
});

describe('backfillPartnerSharing', () => {
  it('brings a never-configured default-private fact up to shared-with-partner', async () => {
    const fs = memFileSystem();
    await saveInsight(fs, key, insight('i1', [{ id: 'f1', text: 'a', shareable: false }]));
    const changed = await backfillPartnerSharing(fs, key, 'p1');
    expect(changed).toBe(1);
    expect((await factsOf(fs, 'i1'))[0]?.shareableTypes).toEqual(['partner']);
  });

  it('preserves every explicit choice — restricted / flagged / manually-private / per-person', async () => {
    const fs = memFileSystem();
    await saveInsight(
      fs,
      key,
      insight('i1', [
        { id: 'f1', text: 'break-glass', shareable: false, restricted: true },
        { id: 'f2', text: 'flagged', shareable: false, flaggedInaccurate: true },
        { id: 'f3', text: 'manually private', shareable: false, shareableTypes: [] },
        { id: 'f4', text: 'per-person', shareable: false, shareableWith: ['p9'] },
      ]),
    );
    const changed = await backfillPartnerSharing(fs, key, 'p1');
    expect(changed).toBe(0);
    const facts = await factsOf(fs, 'i1');
    expect(facts.find((f) => f.id === 'f1')?.shareableTypes).toBeUndefined();
    expect(facts.find((f) => f.id === 'f2')?.shareableTypes).toBeUndefined();
    expect(facts.find((f) => f.id === 'f3')?.shareableTypes).toEqual([]);
    expect(facts.find((f) => f.id === 'f4')?.shareableTypes).toBeUndefined();
    expect(facts.find((f) => f.id === 'f4')?.shareableWith).toEqual(['p9']);
  });

  it('skips onboarding (intake) + compatibility insights (their sharing is chosen elsewhere)', async () => {
    const fs = memFileSystem();
    await saveInsight(
      fs,
      key,
      insight('intake1', [{ id: 'f1', text: 'a', shareable: false }], {
        source: 'intake',
        provenance: { intakeSection: 'basics', at },
      }),
    );
    await saveInsight(
      fs,
      key,
      insight('compat1', [{ id: 'f1', text: 'a', shareable: false }], {
        source: 'questionnaire',
        provenance: { compatibilityGroupId: 'g1', at },
      }),
    );
    const changed = await backfillPartnerSharing(fs, key, 'p1');
    expect(changed).toBe(0);
    expect((await factsOf(fs, 'intake1'))[0]?.shareableTypes).toBeUndefined();
    expect((await factsOf(fs, 'compat1'))[0]?.shareableTypes).toBeUndefined();
  });

  it('is idempotent + preserves updatedAt (Memory order unchanged)', async () => {
    const fs = memFileSystem();
    await saveInsight(fs, key, insight('i1', [{ id: 'f1', text: 'a', shareable: false }]));
    expect(await backfillPartnerSharing(fs, key, 'p1')).toBe(1);
    expect(await backfillPartnerSharing(fs, key, 'p1')).toBe(0); // second run is a no-op
    expect((await listInsightsForPerson(fs, key, 'p1'))[0]?.updatedAt).toBe(at);
  });
});

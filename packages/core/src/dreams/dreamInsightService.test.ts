import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { Dream, DreamAnalysis, Insight, SensitivityTier } from '../schemas';
import { savePerson, saveRelationship } from '../people';
import { saveInsight, summarizeForContext } from '../insights';
import { saveAnalysis, saveDream } from './dreamService';
import { getDreamInsight, listDreamShareTargets, setDreamFactShare } from './dreamInsightService';

const key = generateMasterKey();
const now = new Date('2026-06-15T10:00:00.000Z');

function person(id: string, displayName: string) {
  return {
    id,
    schemaVersion: 1,
    displayName,
    isSubject: true,
    tags: [],
    createdAt: 'now',
    updatedAt: 'now',
  };
}

function dream(id: string, sensitivity: SensitivityTier = 'standard'): Dream {
  return {
    id,
    schemaVersion: 1,
    personId: 'p1',
    narrative: `dream ${id}`,
    lucid: false,
    nightmare: false,
    tags: [],
    people: [],
    sensitivity,
    status: 'analyzed',
    analysisId: `a-${id}`,
    createdAt: 'now',
    updatedAt: 'now',
  };
}

function analysis(dreamId: string, insightId: string): DreamAnalysis {
  return {
    id: `a-${dreamId}`,
    schemaVersion: 1,
    dreamId,
    personId: 'p1',
    summary: 'A dream',
    emotionalLandscape: '',
    wakingLifeConnections: '',
    notableImages: '',
    reflectiveQuestions: [],
    tags: { emotions: [], symbols: [], settings: [], themes: [], people: [] },
    edited: false,
    insightId,
    generatedAt: 'now',
    updatedAt: 'now',
  };
}

function insight(id: string): Insight {
  return {
    id,
    schemaVersion: 1,
    source: 'dream',
    subjectPersonId: 'p1',
    summary: 'A dream about home',
    facts: [
      { id: 'f1', text: 'Feels protective of their partner.', shareable: false },
      { id: 'f2', text: 'Unsettled by change.', shareable: false },
    ],
    confidence: 'medium',
    categories: [],
    approved: true,
    provenance: { dreamId: 'd1', at: 'now' },
    createdAt: 'now',
    updatedAt: 'now',
  };
}

/** A dreamer (p1) related to p2, plus an unrelated p3; a standard dream d1 with an approved insight. */
async function seed() {
  const fs = memFileSystem();
  await savePerson(fs, key, person('p1', 'Dreamer'));
  await savePerson(fs, key, person('p2', 'Partner'));
  await savePerson(fs, key, person('p3', 'Stranger'));
  await saveRelationship(fs, key, {
    id: 'r1',
    schemaVersion: 1,
    fromPersonId: 'p1',
    toPersonId: 'p2',
    type: 'partner',
    createdAt: 'now',
    updatedAt: 'now',
  });
  await saveDream(fs, key, dream('d1'));
  await saveInsight(fs, key, insight('i1'));
  await saveAnalysis(fs, key, analysis('d1', 'i1'));
  return fs;
}

describe('dreamInsightService (per-dream sharing)', () => {
  it('lists the dreamer’s related people as share targets', async () => {
    const fs = await seed();
    expect(await listDreamShareTargets(fs, key, 'p1')).toEqual([
      { id: 'p2', displayName: 'Partner' },
    ]);
  });

  it('shares a specific fact with a related person → it reaches only their context', async () => {
    const fs = await seed();
    const res = await setDreamFactShare({
      fs,
      key,
      personId: 'p1',
      dreamId: 'd1',
      factId: 'f1',
      withPersonId: 'p2',
      share: true,
      now,
    });
    expect(res.ok).toBe(true);
    expect((await getDreamInsight(fs, key, 'p1', 'd1'))?.facts[0]?.shareableWith).toEqual(['p2']);

    // p2's context (they relate to p1) includes the targeted fact…
    const p2ctx = await summarizeForContext(fs, key, 'p2', [{ id: 'p1', displayName: 'Dreamer' }]);
    expect(p2ctx).toContain('Feels protective of their partner.');
    // …but p3's does NOT (the fact is targeted at p2 only, not broadcast).
    const p3ctx = await summarizeForContext(fs, key, 'p3', [{ id: 'p1', displayName: 'Dreamer' }]);
    expect(p3ctx).not.toContain('Feels protective of their partner.');
  });

  it('leaves the broadcast shareable:true path reaching all related people (unchanged)', async () => {
    const fs = await seed();
    // A broadcast-shareable fact (no targeting) still reaches a related person, as before.
    await saveInsight(fs, key, {
      ...insight('i1'),
      facts: [{ id: 'f1', text: 'Broadcast fact.', shareable: true }],
    });
    const p2ctx = await summarizeForContext(fs, key, 'p2', [{ id: 'p1', displayName: 'Dreamer' }]);
    expect(p2ctx).toContain('Broadcast fact.');
  });

  it('un-shares a fact (removes the target, dropping it from their context)', async () => {
    const fs = await seed();
    const base = { fs, key, personId: 'p1', dreamId: 'd1', factId: 'f1', withPersonId: 'p2', now };
    await setDreamFactShare({ ...base, share: true });
    await setDreamFactShare({ ...base, share: false });
    expect((await getDreamInsight(fs, key, 'p1', 'd1'))?.facts[0]?.shareableWith).toBeUndefined();
    const p2ctx = await summarizeForContext(fs, key, 'p2', [{ id: 'p1', displayName: 'Dreamer' }]);
    expect(p2ctx).not.toContain('Feels protective of their partner.');
  });

  it('now SHARES a sensitive-tier dream (sensitivity no longer excludes — 15 §3.2)', async () => {
    const fs = await seed();
    await saveDream(fs, key, dream('d2', 'explicit')); // informsContext defaults on
    await saveInsight(fs, key, { ...insight('i2'), provenance: { dreamId: 'd2', at: 'now' } });
    await saveAnalysis(fs, key, analysis('d2', 'i2'));
    const res = await setDreamFactShare({
      fs,
      key,
      personId: 'p1',
      dreamId: 'd2',
      factId: 'f1',
      withPersonId: 'p2',
      share: true,
      now,
    });
    expect(res).toEqual({ ok: true });
    expect((await getDreamInsight(fs, key, 'p1', 'd2'))?.facts[0]?.shareableWith).toEqual(['p2']);
  });

  it('refuses to share when the dream’s informsContext is off, and hides its insight', async () => {
    const fs = await seed();
    await saveDream(fs, key, { ...dream('d3'), informsContext: false });
    await saveInsight(fs, key, { ...insight('i3'), provenance: { dreamId: 'd3', at: 'now' } });
    await saveAnalysis(fs, key, analysis('d3', 'i3'));
    const res = await setDreamFactShare({
      fs,
      key,
      personId: 'p1',
      dreamId: 'd3',
      factId: 'f1',
      withPersonId: 'p2',
      share: true,
      now,
    });
    expect(res).toEqual({ ok: false, reason: 'NOT_ALLOWED' });
    // The share controls disappear: getDreamInsight returns null for a muted dream.
    expect(await getDreamInsight(fs, key, 'p1', 'd3')).toBeNull();
  });

  it('refuses to share with a non-related person', async () => {
    const fs = await seed();
    const res = await setDreamFactShare({
      fs,
      key,
      personId: 'p1',
      dreamId: 'd1',
      factId: 'f1',
      withPersonId: 'p3', // not related to p1
      share: true,
      now,
    });
    expect(res).toEqual({ ok: false, reason: 'NOT_FOUND' });
  });

  it('returns null for a dream with no approved insight', async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person('p1', 'Dreamer'));
    // A dream with no saved analysis → no linked insight.
    await saveDream(fs, key, dream('d9'));
    expect(await getDreamInsight(fs, key, 'p1', 'd9')).toBeNull();
  });
});

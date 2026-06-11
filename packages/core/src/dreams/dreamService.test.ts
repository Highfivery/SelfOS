import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { Dream, DreamAnalysis } from '../schemas';
import { writeEncryptedJson } from '../vault';
import {
  deleteDream,
  getAnalysis,
  getDream,
  listDreams,
  saveAnalysis,
  saveDream,
} from './dreamService';

const key = generateMasterKey();

function dream(over: Partial<Dream> & { id: string; personId: string }): Dream {
  return {
    schemaVersion: 1,
    narrative: `dream-${over.id}`,
    lucid: false,
    nightmare: false,
    tags: [],
    people: [],
    sensitivity: 'standard',
    status: 'captured',
    createdAt: '2026-06-11T00:00:00.000Z',
    updatedAt: '2026-06-11T00:00:00.000Z',
    ...over,
  };
}

function analysis(
  over: Partial<DreamAnalysis> & { id: string; dreamId: string; personId: string },
): DreamAnalysis {
  return {
    schemaVersion: 1,
    summary: `summary-${over.id}`,
    emotionalLandscape: 'unease',
    wakingLifeConnections: 'change',
    notableImages: 'a shifting house',
    reflectiveQuestions: [],
    tags: { emotions: [], symbols: [], settings: [], themes: [], people: [] },
    edited: false,
    generatedAt: '2026-06-11T00:00:00.000Z',
    updatedAt: '2026-06-11T00:00:00.000Z',
    ...over,
  };
}

describe('dreamService', () => {
  it('saves, reads, lists (newest first), and deletes', async () => {
    const fs = memFileSystem();
    await saveDream(
      fs,
      key,
      dream({ id: 'd1', personId: 'p1', createdAt: '2026-06-11T10:00:00.000Z' }),
    );
    await saveDream(
      fs,
      key,
      dream({ id: 'd2', personId: 'p1', createdAt: '2026-06-11T12:00:00.000Z' }),
    );
    expect((await listDreams(fs, key, 'p1')).map((d) => d.id)).toEqual(['d2', 'd1']);
    expect((await getDream(fs, key, 'p1', 'd1'))?.narrative).toBe('dream-d1');
    await deleteDream(fs, 'p1', 'd1');
    expect(await getDream(fs, key, 'p1', 'd1')).toBeNull();
  });

  it('stores dreams encrypted at rest', async () => {
    const fs = memFileSystem();
    await saveDream(
      fs,
      key,
      dream({ id: 'd1', personId: 'p1', narrative: 'I was flying over the sea' }),
    );
    const bytes = await fs.read('people/p1/dreams/d1/dream.enc');
    const raw = bytes && new TextDecoder().decode(bytes);
    expect(raw).toContain('aes-256-gcm');
    expect(raw).not.toContain('flying over the sea');
  });

  it('deleting a dream purges its analysis (and transcript folder) too', async () => {
    const fs = memFileSystem();
    await saveDream(fs, key, dream({ id: 'd1', personId: 'p1' }));
    await saveAnalysis(fs, key, analysis({ id: 'a1', dreamId: 'd1', personId: 'p1' }));
    await deleteDream(fs, 'p1', 'd1');
    expect(await getDream(fs, key, 'p1', 'd1')).toBeNull();
    expect(await getAnalysis(fs, key, 'p1', 'd1')).toBeNull();
  });

  it('listing ignores non-dream files and never serves another person’s dream', async () => {
    const fs = memFileSystem();
    await saveDream(fs, key, dream({ id: 'd1', personId: 'p1' }));
    // A file living directly in the dreams dir (e.g. the cached pattern narrative) is not a dream folder.
    await fs.writeAtomic('people/p1/dreams/patterns.enc', new TextEncoder().encode('not a dream'));
    // A tampered/misplaced file whose dreamer doesn't match the folder must not leak in (defense in depth).
    await writeEncryptedJson(
      fs,
      'people/p1/dreams/dx/dream.enc',
      dream({ id: 'dx', personId: 'p2' }),
      key,
    );
    expect((await listDreams(fs, key, 'p1')).map((d) => d.id)).toEqual(['d1']);
  });

  it('saves and reads a dream analysis, encrypted at rest', async () => {
    const fs = memFileSystem();
    await saveAnalysis(
      fs,
      key,
      analysis({
        id: 'a1',
        dreamId: 'd1',
        personId: 'p1',
        summary: 'a search through a shifting house',
      }),
    );
    expect((await getAnalysis(fs, key, 'p1', 'd1'))?.summary).toBe(
      'a search through a shifting house',
    );
    const bytes = await fs.read('people/p1/dreams/d1/analysis.enc');
    const raw = bytes && new TextDecoder().decode(bytes);
    expect(raw).toContain('aes-256-gcm');
    expect(raw).not.toContain('a search through a shifting house');
  });

  it('returns null for an absent dream or analysis', async () => {
    const fs = memFileSystem();
    expect(await getDream(fs, key, 'p1', 'nope')).toBeNull();
    expect(await getAnalysis(fs, key, 'p1', 'nope')).toBeNull();
    expect(await listDreams(fs, key, 'p1')).toEqual([]);
  });

  it('round-trips a fully populated dream and analysis (people refs, bounds, structured tags)', async () => {
    const fs = memFileSystem();
    const full = dream({
      id: 'd1',
      personId: 'p1',
      title: 'The rearranging house',
      narrative: 'I was back in my childhood house but the rooms kept rearranging.',
      dreamDate: '2026-06-10',
      mood: 0.4,
      vividness: 5,
      sleepQuality: 3,
      lucid: true,
      tags: ['childhood home', 'searching'],
      people: [{ personId: 'p2', name: 'Brother' }, { name: 'a stranger' }],
      sensitivity: 'intimacyGeneral',
      status: 'analyzed',
      analysisId: 'a1',
    });
    await saveDream(fs, key, full);
    expect(await getDream(fs, key, 'p1', 'd1')).toEqual(full);

    const fullAnalysis = analysis({
      id: 'a1',
      dreamId: 'd1',
      personId: 'p1',
      reflectiveQuestions: ['What feels like it is rearranging?'],
      coachingPrompt: 'Notice what shifted this week.',
      tags: {
        emotions: ['unease', 'nostalgia'],
        symbols: ['childhood home', 'garden'],
        settings: ['childhood home'],
        themes: ['searching', 'change'],
        people: ['brother'],
      },
      metrics: { emotionalIntensity: 0.7 },
      lensesApplied: ['reflective', 'continuity', 'symbolic'],
      crisisFlag: false,
      distressSignal: false,
      edited: true,
      insightId: 'i1',
    });
    await saveAnalysis(fs, key, fullAnalysis);
    expect(await getAnalysis(fs, key, 'p1', 'd1')).toEqual(fullAnalysis);
  });

  it('rejects out-of-range bounds and empty person refs on read (Zod boundary)', async () => {
    const fs = memFileSystem();
    // mood is a normalized valence (−1..1); 2 is out of range.
    await saveDream(fs, key, dream({ id: 'bad-mood', personId: 'p1', mood: 2 }));
    await expect(getDream(fs, key, 'p1', 'bad-mood')).rejects.toThrow();
    // vividness is a 1..5 integer.
    await saveDream(fs, key, dream({ id: 'bad-vivid', personId: 'p1', vividness: 6 }));
    await expect(getDream(fs, key, 'p1', 'bad-vivid')).rejects.toThrow();
    // a person ref must carry a personId or a name — never empty.
    await saveDream(fs, key, dream({ id: 'bad-person', personId: 'p1', people: [{}] }));
    await expect(getDream(fs, key, 'p1', 'bad-person')).rejects.toThrow();
  });
});

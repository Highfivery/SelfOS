import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { ClaudeClient } from '../host';
import type { Dream, DreamAnalysis } from '../schemas';
import { listInsightsForPerson } from '../insights';
import { queryUsage } from '../usage';
import { saveAnalysis, getPatternSummary, saveDream } from './dreamService';
import {
  approvePatternNarrative,
  computePatternStats,
  generatePatternNarrative,
  getPatternStats,
  NIGHTMARE_NUDGE_COUNT,
  removePatternNarrativeFromContext,
  type PatternEntry,
} from './dreamPatternService';

const key = generateMasterKey();
const now = new Date('2026-06-15T10:00:00.000Z');

function dreamOf(over: Partial<Dream> & { id: string }): Dream {
  return {
    schemaVersion: 1,
    personId: 'p1',
    narrative: `dream ${over.id}`,
    lucid: false,
    nightmare: false,
    tags: [],
    people: [],
    sensitivity: 'standard',
    status: 'captured',
    createdAt: '2026-06-10T00:00:00.000Z',
    updatedAt: '2026-06-10T00:00:00.000Z',
    ...over,
  };
}

function analysisOf(dreamId: string, over: Partial<DreamAnalysis> = {}): DreamAnalysis {
  return {
    id: `a-${dreamId}`,
    schemaVersion: 1,
    dreamId,
    personId: 'p1',
    summary: `summary ${dreamId}`,
    emotionalLandscape: '',
    wakingLifeConnections: '',
    notableImages: '',
    reflectiveQuestions: [],
    tags: { emotions: [], symbols: [], settings: [], themes: [], people: [] },
    edited: false,
    generatedAt: 'now',
    updatedAt: 'now',
    ...over,
  };
}

function entry(dream: Dream, analysis: DreamAnalysis | null = null): PatternEntry {
  return { dream, analysis };
}

/** A fake client that streams a canned reflection (the narrative is prose, not JSON). */
function fakeClient(reply = 'Across these dreams I notice a thread of searching.'): ClaudeClient {
  return {
    send: () => Promise.resolve(''),
    stream: (_options, onDelta) => {
      onDelta(reply);
      return Promise.resolve({
        text: reply,
        usage: { inputTokens: 30, outputTokens: 20, cacheWriteTokens: 0, cacheReadTokens: 0 },
      });
    },
  };
}

describe('computePatternStats', () => {
  it('ranks recurring symbols, themes, emotions, and people most-frequent first', () => {
    const entries = [
      entry(
        dreamOf({ id: 'd1', dreamDate: '2026-06-12', lucid: true, people: [{ name: 'Mara' }] }),
        analysisOf('d1', {
          tags: {
            emotions: ['fear'],
            symbols: ['water', 'house'],
            settings: [],
            themes: ['loss'],
            people: ['Mara'],
          },
        }),
      ),
      entry(
        dreamOf({ id: 'd2', dreamDate: '2026-06-13', nightmare: true }),
        analysisOf('d2', {
          tags: {
            emotions: ['fear', 'relief'],
            symbols: ['water'],
            settings: [],
            themes: ['loss'],
            people: ['Mara'],
          },
        }),
      ),
    ];
    const stats = computePatternStats(entries, 'all', now);
    expect(stats.dreamCount).toBe(2);
    expect(stats.analyzedCount).toBe(2);
    expect(stats.symbols[0]).toEqual({ label: 'water', count: 2 });
    expect(stats.themes[0]).toEqual({ label: 'loss', count: 2 });
    expect(stats.emotions[0]).toEqual({ label: 'fear', count: 2 });
    // Mara appears via dream.people once and analysis.tags.people twice → 3.
    expect(stats.people[0]).toMatchObject({ label: 'Mara', count: 3 });
    expect(stats.lucidCount).toBe(1);
    expect(stats.nightmareCount).toBe(1);
  });

  it('keeps a People-graph personId on a resolved people entry', () => {
    const stats = computePatternStats(
      [
        entry(
          dreamOf({
            id: 'd1',
            dreamDate: '2026-06-12',
            people: [{ name: 'Sam', personId: 'person-9' }],
          }),
        ),
      ],
      'all',
      now,
    );
    expect(stats.people[0]).toEqual({ label: 'Sam', count: 1, personId: 'person-9' });
  });

  it('windows frequency lists + trends but never the nightmare nudge', () => {
    const entries = [
      entry(dreamOf({ id: 'old', dreamDate: '2026-01-01', mood: 0.5, vividness: 4 })),
      entry(dreamOf({ id: 'new', dreamDate: '2026-06-12', mood: -0.5, vividness: 2 })),
    ];
    const all = computePatternStats(entries, 'all', now);
    expect(all.dreamCount).toBe(2);
    expect(all.moodTrend).toEqual([
      { date: '2026-01-01', value: 0.5 },
      { date: '2026-06-12', value: -0.5 },
    ]);

    const recent = computePatternStats(entries, '30d', now);
    expect(recent.dreamCount).toBe(1); // only the 2026-06-12 dream is within 30 days
    expect(recent.moodTrend).toEqual([{ date: '2026-06-12', value: -0.5 }]);
  });

  it('fires the nightmare nudge on a recent frequency of nightmares', () => {
    const nightmares = Array.from({ length: NIGHTMARE_NUDGE_COUNT }, (_, i) =>
      entry(dreamOf({ id: `n${i}`, dreamDate: '2026-06-10', nightmare: true })),
    );
    expect(computePatternStats(nightmares, 'all', now).nightmareNudge).toBe(true);
    // One fewer recent nightmare → no nudge from frequency.
    expect(computePatternStats(nightmares.slice(1), 'all', now).nightmareNudge).toBe(false);
    // Old nightmares (outside the 14-day window) don't count.
    const old = Array.from({ length: NIGHTMARE_NUDGE_COUNT }, (_, i) =>
      entry(dreamOf({ id: `o${i}`, dreamDate: '2026-05-01', nightmare: true })),
    );
    expect(computePatternStats(old, 'all', now).nightmareNudge).toBe(false);
  });

  it('fires the nightmare nudge on a recent AI distress signal alone', () => {
    const stats = computePatternStats(
      [
        entry(
          dreamOf({ id: 'd1', dreamDate: '2026-06-12' }),
          analysisOf('d1', { distressSignal: true }),
        ),
      ],
      'all',
      now,
    );
    expect(stats.nightmareNudge).toBe(true);
  });
});

describe('dreamPatternService (narrative)', () => {
  it('getPatternStats round-trips through the encrypted vault', async () => {
    const fs = memFileSystem();
    await saveDream(fs, key, dreamOf({ id: 'd1', dreamDate: '2026-06-12', lucid: true }));
    await saveAnalysis(
      fs,
      key,
      analysisOf('d1', {
        tags: {
          emotions: ['calm'],
          symbols: ['sky'],
          settings: [],
          themes: ['flight'],
          people: [],
        },
      }),
    );
    const stats = await getPatternStats(fs, key, 'p1', 'all', now);
    expect(stats.dreamCount).toBe(1);
    expect(stats.analyzedCount).toBe(1);
    expect(stats.symbols[0]).toEqual({ label: 'sky', count: 1 });
  });

  it('refuses the narrative with EMPTY when there are no recent dreams', async () => {
    const fs = memFileSystem();
    const res = await generatePatternNarrative({
      fs,
      key,
      client: fakeClient(),
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      personId: 'p1',
      now,
    });
    expect(res).toMatchObject({ ok: false, reason: 'EMPTY' });
  });

  it('requires an API key', async () => {
    const fs = memFileSystem();
    await saveDream(fs, key, dreamOf({ id: 'd1', dreamDate: '2026-06-12' }));
    const res = await generatePatternNarrative({
      fs,
      key,
      client: fakeClient(),
      apiKey: null,
      model: 'claude-sonnet-4-6',
      personId: 'p1',
      now,
    });
    expect(res).toMatchObject({ ok: false, reason: 'NO_KEY' });
  });

  it('generates + caches the narrative and meters dream.patterns', async () => {
    const fs = memFileSystem();
    await saveDream(fs, key, dreamOf({ id: 'd1', dreamDate: '2026-06-12' }));
    const res = await generatePatternNarrative({
      fs,
      key,
      client: fakeClient('A recurring thread of water and searching.'),
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      personId: 'p1',
      now,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected a narrative');
    expect(res.summary.narrative).toContain('water and searching');
    expect(res.usage.type).toBe('dream.patterns');
    expect((await getPatternSummary(fs, key, 'p1'))?.narrative).toContain('water and searching');
    const events = await queryUsage(fs, key, {
      from: '2026-01-01T00:00:00.000Z',
      to: '2027-01-01T00:00:00.000Z',
      personId: 'p1',
      type: 'dream.patterns',
    });
    expect(events).toHaveLength(1);
  });

  it('approves the narrative into a cross-dream Insight (no dreamId), then removes it', async () => {
    const fs = memFileSystem();
    await saveDream(fs, key, dreamOf({ id: 'd1', dreamDate: '2026-06-12' }));
    await generatePatternNarrative({
      fs,
      key,
      client: fakeClient(),
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      personId: 'p1',
      now,
    });

    const denied = await approvePatternNarrative({
      fs,
      key,
      personId: 'p1',
      memoryEnabled: false,
      now,
    });
    expect(denied).toMatchObject({ ok: false, reason: 'MEMORY_DISABLED' });

    const ok = await approvePatternNarrative({ fs, key, personId: 'p1', memoryEnabled: true, now });
    expect(ok.ok).toBe(true);
    const insights = await listInsightsForPerson(fs, key, 'p1');
    expect(insights).toHaveLength(1);
    expect(insights[0]?.source).toBe('dream');
    expect(insights[0]?.provenance.dreamId).toBeUndefined(); // cross-dream
    expect((await getPatternSummary(fs, key, 'p1'))?.insightId).toBe(
      ok.ok ? ok.insightId : undefined,
    );

    await removePatternNarrativeFromContext({ fs, key, personId: 'p1' });
    expect(await listInsightsForPerson(fs, key, 'p1')).toEqual([]);
    expect((await getPatternSummary(fs, key, 'p1'))?.insightId).toBeUndefined();
  });

  it('re-generating drops the prior approved narrative Insight', async () => {
    const fs = memFileSystem();
    await saveDream(fs, key, dreamOf({ id: 'd1', dreamDate: '2026-06-12' }));
    const deps = {
      fs,
      key,
      client: fakeClient(),
      apiKey: 'sk-test' as string | null,
      model: 'claude-sonnet-4-6',
      personId: 'p1',
      now,
    };
    await generatePatternNarrative(deps);
    await approvePatternNarrative({ fs, key, personId: 'p1', memoryEnabled: true, now });
    expect(await listInsightsForPerson(fs, key, 'p1')).toHaveLength(1);

    await generatePatternNarrative(deps);
    expect(await listInsightsForPerson(fs, key, 'p1')).toEqual([]);
    expect((await getPatternSummary(fs, key, 'p1'))?.insightId).toBeUndefined();
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { ClaudeClient, FileSystem } from '../host';
import { flattenContent } from '../host';
import type { Insight } from '../schemas';
import { saveInsight } from '../insights';
import { saveDream } from '../dreams';
import { queryUsage } from '../usage';
import { setPersonBudget } from '../usage';
import {
  countNewInsights,
  getSynthesis,
  shouldSynthesize,
  synthesize,
} from './coachingSynthesisService';

const key = generateMasterKey();
const now = new Date('2026-06-24T12:00:00.000Z');
let fs: FileSystem;
beforeEach(() => {
  fs = memFileSystem();
});

function insight(id: string, over: Partial<Insight> = {}): Insight {
  return {
    id,
    schemaVersion: 1,
    source: 'session',
    subjectPersonId: 'p1',
    summary: `reflected on ${id}`,
    facts: [{ id: `${id}-f`, text: `a fact from ${id}`, shareable: false }],
    confidence: 'medium',
    categories: ['Relationships'],
    approved: true,
    provenance: { conversationId: id, at: now.toISOString() },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...over,
  };
}

/** A fake client that returns a JSON synthesis object (the happy path). */
function jsonClient(
  observation = 'Connection has come up across a couple of recent reflections.',
): ClaudeClient {
  return {
    send: () => Promise.resolve(''),
    stream: () =>
      Promise.resolve({
        text: JSON.stringify({
          observation,
          sources: ['sessions', 'dreams'],
          lifeArea: 'Relationships',
        }),
        usage: { inputTokens: 40, outputTokens: 25, cacheWriteTokens: 0, cacheReadTokens: 0 },
      }),
  };
}

function deps(client: ClaudeClient, over: Partial<Parameters<typeof synthesize>[0]> = {}) {
  return {
    fs,
    key,
    client,
    apiKey: 'sk-test',
    model: 'claude-sonnet-4-6',
    personId: 'p1',
    now,
    ...over,
  };
}

describe('shouldSynthesize (40 §3.4)', () => {
  it('never runs when proactivity is off', () => {
    expect(shouldSynthesize({ level: 'off', newInsightCount: 99 }, now)).toBe(false);
  });

  it('gentle needs ≥3 new insights and at most one per 7 days', () => {
    expect(shouldSynthesize({ level: 'gentle', newInsightCount: 2 }, now)).toBe(false);
    expect(shouldSynthesize({ level: 'gentle', newInsightCount: 3 }, now)).toBe(true);
    // Within the 7-day window since the last run → throttled regardless of count.
    const threeDaysAgo = new Date(now.getTime() - 3 * 86400000).toISOString();
    expect(
      shouldSynthesize(
        { level: 'gentle', newInsightCount: 9, lastSynthesizedAt: threeDaysAgo },
        now,
      ),
    ).toBe(false);
    const eightDaysAgo = new Date(now.getTime() - 8 * 86400000).toISOString();
    expect(
      shouldSynthesize(
        { level: 'gentle', newInsightCount: 3, lastSynthesizedAt: eightDaysAgo },
        now,
      ),
    ).toBe(true);
  });

  it('active is faster — ≥2 new insights, once per 3 days', () => {
    expect(shouldSynthesize({ level: 'active', newInsightCount: 2 }, now)).toBe(true);
    const twoDaysAgo = new Date(now.getTime() - 2 * 86400000).toISOString();
    expect(
      shouldSynthesize({ level: 'active', newInsightCount: 9, lastSynthesizedAt: twoDaysAgo }, now),
    ).toBe(false);
  });
});

describe('countNewInsights', () => {
  it('counts only approved insights newer than the marker', () => {
    const older = insight('old', { updatedAt: '2026-06-01T00:00:00.000Z' });
    const newer = insight('new', { updatedAt: '2026-06-20T00:00:00.000Z' });
    const draft = insight('draft', { approved: false, updatedAt: '2026-06-20T00:00:00.000Z' });
    expect(countNewInsights([older, newer, draft], '2026-06-10T00:00:00.000Z')).toBe(1);
    expect(countNewInsights([older, newer, draft], undefined)).toBe(2); // all approved when no marker
  });
});

describe('synthesize (40 §3.3)', () => {
  it('returns NO_KEY without an API key (no spend)', async () => {
    const out = await synthesize(deps(jsonClient(), { apiKey: null }));
    expect(out).toMatchObject({ ok: false, reason: 'NO_KEY' });
  });

  it('returns EMPTY when there isn’t enough recent material', async () => {
    await saveInsight(fs, key, insight('s1'));
    const out = await synthesize(deps(jsonClient())); // only one insight (< MIN_INSIGHTS)
    expect(out).toMatchObject({ ok: false, reason: 'EMPTY' });
    expect(
      await queryUsage(fs, key, { from: '2026-01-01', to: '2026-12-31', personId: 'p1' }),
    ).toHaveLength(0); // never called the model
  });

  it('counts only RECENT insights for EMPTY — an all-stale history never bills an empty digest', async () => {
    const old = '2026-04-01T00:00:00.000Z'; // > 30 days before `now`
    await saveInsight(fs, key, insight('o1', { provenance: { conversationId: 'o1', at: old } }));
    await saveInsight(fs, key, insight('o2', { provenance: { conversationId: 'o2', at: old } }));
    const out = await synthesize(deps(jsonClient())); // 2 approved, but both out of the window
    expect(out).toMatchObject({ ok: false, reason: 'EMPTY' });
    expect(
      await queryUsage(fs, key, { from: '2026-01-01', to: '2026-12-31', personId: 'p1' }),
    ).toHaveLength(0); // no spend on a stale-only history
  });

  it('produces + caches one observation, metered coaching.synthesize', async () => {
    await saveInsight(fs, key, insight('s1'));
    await saveInsight(fs, key, insight('s2'));
    const out = await synthesize(
      deps(jsonClient('A thread of connection runs through your week.')),
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.synthesis.observation).toBe('A thread of connection runs through your week.');
      expect(out.synthesis.subjectPersonId).toBe('p1');
      expect(out.synthesis.lifeArea).toBe('Relationships'); // normalized to the taxonomy
    }
    // Cached + metered.
    const cached = await getSynthesis(fs, key, 'p1');
    expect(cached?.observation).toContain('connection');
    const usage = await queryUsage(fs, key, {
      from: '2026-01-01',
      to: '2026-12-31',
      personId: 'p1',
    });
    expect(usage).toHaveLength(1);
    expect(usage[0]?.type).toBe('coaching.synthesize');
  });

  it('meters BEFORE parse — a paid call with unusable output is still billed, and reports honestly', async () => {
    await saveInsight(fs, key, insight('s1'));
    await saveInsight(fs, key, insight('s2'));
    const refusing: ClaudeClient = {
      send: () => Promise.resolve(''),
      stream: () =>
        Promise.resolve({
          text: 'I cannot help with this request.', // refusal prose, no JSON
          usage: { inputTokens: 10, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 },
        }),
    };
    const out = await synthesize(deps(refusing));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('REFUSED');
    expect(
      await queryUsage(fs, key, { from: '2026-01-01', to: '2026-12-31', personId: 'p1' }),
    ).toHaveLength(1); // billed despite the unusable output
  });

  it('skips when over budget (no spend)', async () => {
    await saveInsight(fs, key, insight('s1'));
    await saveInsight(fs, key, insight('s2'));
    await setPersonBudget(fs, key, 'p1', { limitUsd: 0, period: 'month', warnRatio: 0.8 });
    const out = await synthesize(deps(jsonClient()));
    expect(out).toMatchObject({ ok: false, reason: 'BUDGET' });
    expect(
      await queryUsage(fs, key, { from: '2026-01-01', to: '2026-12-31', personId: 'p1' }),
    ).toHaveLength(0);
  });

  it('caps synthesis at 7 passes per rolling week, then returns CAPPED without spending (40 §3.4)', async () => {
    await saveInsight(fs, key, insight('s1'));
    await saveInsight(fs, key, insight('s2'));
    // Seven passes succeed (each meters one coaching.synthesize event)…
    for (let i = 0; i < 7; i++) {
      expect(await synthesize(deps(jsonClient()))).toMatchObject({ ok: true });
    }
    // …the eighth within the same week is CAPPED, and bills nothing more.
    const before = await queryUsage(fs, key, {
      from: '2026-01-01',
      to: '2026-12-31',
      personId: 'p1',
      type: 'coaching.synthesize',
    });
    expect(before).toHaveLength(7);
    expect(await synthesize(deps(jsonClient()))).toMatchObject({ ok: false, reason: 'CAPPED' });
    const after = await queryUsage(fs, key, {
      from: '2026-01-01',
      to: '2026-12-31',
      personId: 'p1',
      type: 'coaching.synthesize',
    });
    expect(after).toHaveLength(7); // no extra spend

    // The owner budget-override bypasses the cap (like a budget stop).
    expect(await synthesize(deps(jsonClient(), { override: true }))).toMatchObject({ ok: true });
  });

  it('excludes restricted + flagged facts from the digest (privacy boundary, §8)', async () => {
    let captured = '';
    const capturing: ClaudeClient = {
      send: () => Promise.resolve(''),
      stream: (options) => {
        captured = flattenContent(options.messages.at(-1)?.content ?? '');
        return Promise.resolve({
          text: JSON.stringify({ observation: 'ok', sources: [] }),
          usage: { inputTokens: 5, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    await saveInsight(
      fs,
      key,
      insight('s1', {
        facts: [
          { id: 'ok', text: 'a shareable visible fact', shareable: false },
          { id: 'secret', text: 'a RESTRICTED secret', shareable: false, restricted: true },
          { id: 'wrong', text: 'a FLAGGED wrong fact', shareable: false, flaggedInaccurate: true },
        ],
      }),
    );
    await saveInsight(fs, key, insight('s2'));
    await synthesize(deps(capturing));
    expect(captured).toContain('a shareable visible fact');
    expect(captured).not.toContain('RESTRICTED secret');
    expect(captured).not.toContain('FLAGGED wrong fact');
  });

  it('excludes a MUTED dream’s insight from the digest (informsContext:false, §8)', async () => {
    let captured = '';
    const capturing: ClaudeClient = {
      send: () => Promise.resolve(''),
      stream: (options) => {
        captured = flattenContent(options.messages.at(-1)?.content ?? '');
        return Promise.resolve({
          text: JSON.stringify({ observation: 'ok', sources: [] }),
          usage: { inputTokens: 5, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    // A dream the user muted to "private journal entry" — its insight must NOT feed the synthesis pass.
    await saveDream(fs, key, {
      id: 'd1',
      schemaVersion: 1,
      personId: 'p1',
      narrative: 'a private dream',
      lucid: false,
      nightmare: false,
      tags: [],
      people: [],
      sensitivity: 'standard',
      informsContext: false,
      status: 'analyzed',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    await saveInsight(
      fs,
      key,
      insight('di', {
        source: 'dream',
        summary: 'a MUTED dream observation',
        facts: [{ id: 'df', text: 'a MUTED dream fact', shareable: false }],
        provenance: { dreamId: 'd1', at: now.toISOString() },
      }),
    );
    await saveInsight(fs, key, insight('s1'));
    await saveInsight(fs, key, insight('s2'));
    await synthesize(deps(capturing));
    expect(captured).not.toContain('MUTED dream');
  });

  it('drops a WHOLLY-flagged insight’s summary from the digest (§8)', async () => {
    let captured = '';
    const capturing: ClaudeClient = {
      send: () => Promise.resolve(''),
      stream: (options) => {
        captured = flattenContent(options.messages.at(-1)?.content ?? '');
        return Promise.resolve({
          text: JSON.stringify({ observation: 'ok', sources: [] }),
          usage: { inputTokens: 5, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    // Every fact flagged → the whole insight is dropped (its summary restates the corrected claim).
    await saveInsight(
      fs,
      key,
      insight('wf', {
        summary: 'a WHOLLY corrected summary',
        facts: [{ id: 'f', text: 'flagged', shareable: false, flaggedInaccurate: true }],
      }),
    );
    await saveInsight(fs, key, insight('s1'));
    await saveInsight(fs, key, insight('s2'));
    await synthesize(deps(capturing));
    expect(captured).not.toContain('WHOLLY corrected');
  });
});

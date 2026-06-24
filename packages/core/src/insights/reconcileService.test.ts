import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { ClaudeClient } from '../host';
import type { Insight } from '../schemas';
import { getInsight, listInsightsForPerson, saveInsight } from './insightStore';
import { reconcileInsights } from './reconcileService';

const key = generateMasterKey();

function insight(over: Partial<Insight> & { id: string }): Insight {
  return {
    schemaVersion: 1,
    source: 'session',
    subjectPersonId: 'p1',
    summary: `summary-${over.id}`,
    facts: [],
    confidence: 'medium',
    categories: [],
    approved: true,
    provenance: { at: '2026-06-10T00:00:00.000Z' },
    createdAt: '2026-06-10T00:00:00.000Z',
    updatedAt: '2026-06-10T00:00:00.000Z',
    ...over,
  };
}

/** A Claude client that replies with a fixed reconcile-ops JSON object. */
function fakeClient(ops: unknown): ClaudeClient {
  const text = JSON.stringify(ops);
  return {
    send: () => Promise.resolve(''),
    stream: (_options, onDelta) => {
      onDelta(text);
      return Promise.resolve({
        text,
        usage: { inputTokens: 5, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 },
      });
    },
  };
}

function deps(fs: ReturnType<typeof memFileSystem>, client: ClaudeClient) {
  return {
    fs,
    key,
    client,
    apiKey: 'sk-test',
    model: 'claude-sonnet-4-6',
    personId: 'p1',
    now: new Date('2026-06-16T00:00:00.000Z'),
  };
}

describe('reconcileInsights', () => {
  it('sets confidence + rationale + normalized categories on each insight', async () => {
    const fs = memFileSystem();
    await saveInsight(fs, key, insight({ id: 'i1' }));
    const client = fakeClient({
      insights: [
        {
          id: 'i1',
          confidence: 'high',
          rationale: 'echoed across 3 sessions',
          categories: ['relationships', 'not-a-real-area'], // case-insensitive + unknowns dropped
        },
      ],
      merges: [],
    });
    const result = await reconcileInsights(deps(fs, client));
    expect(result).toMatchObject({ ok: true, reconciledCount: 1, mergedCount: 0 });
    const i1 = await getInsight(fs, key, 'p1', 'i1');
    expect(i1?.confidence).toBe('high');
    expect(i1?.confidenceRationale).toBe('echoed across 3 sessions');
    expect(i1?.categories).toEqual(['Relationships']); // normalized to the taxonomy, unknown dropped
    expect(i1?.lastReconciledAt).toBe('2026-06-16T00:00:00.000Z');
  });

  it('conservatively merges a duplicate: folds non-flagged facts, records provenance, deletes the source', async () => {
    const fs = memFileSystem();
    await saveInsight(
      fs,
      key,
      insight({
        id: 'a',
        provenance: { conversationId: 'cA', at: '2026-06-10T00:00:00.000Z' },
        facts: [
          { id: 'fa1', text: 'Loves hiking', shareable: false },
          { id: 'fa2', text: 'WRONG FACT', shareable: false, flaggedInaccurate: true },
        ],
      }),
    );
    await saveInsight(
      fs,
      key,
      insight({ id: 'b', facts: [{ id: 'fb1', text: 'Values nature', shareable: false }] }),
    );
    const client = fakeClient({
      insights: [
        { id: 'b', confidence: 'high' },
        { id: 'a', confidence: 'medium' },
      ],
      merges: [{ from: 'a', into: 'b' }],
    });
    const result = await reconcileInsights(deps(fs, client));
    expect(result).toMatchObject({ ok: true, mergedCount: 1 });

    expect(await getInsight(fs, key, 'p1', 'a')).toBeNull(); // the duplicate was deleted
    const b = await getInsight(fs, key, 'p1', 'b');
    expect(b?.facts.map((f) => f.text)).toContain('Loves hiking'); // folded in
    expect(b?.facts.some((f) => f.text === 'WRONG FACT')).toBe(false); // a flagged fact is NEVER carried forward
    expect(b?.contributingSources?.some((p) => p.conversationId === 'cA')).toBe(true); // provenance recorded
  });

  it('returns AI_OFF with no API key, and NOTHING_TO_DO when there are no approved insights', async () => {
    const fs = memFileSystem();
    await saveInsight(fs, key, insight({ id: 'draft', approved: false }));
    expect(await reconcileInsights({ ...deps(fs, fakeClient({})), apiKey: null })).toMatchObject({
      ok: false,
      reason: 'AI_OFF',
    });
    // Only a draft exists (not approved) → nothing active to reconcile.
    expect(await reconcileInsights(deps(fs, fakeClient({})))).toMatchObject({
      ok: false,
      reason: 'NOTHING_TO_DO',
    });
  });

  it('tolerates one malformed op — applies the good ones, drops the bad (37 §3.1)', async () => {
    const fs = memFileSystem();
    await saveInsight(fs, key, insight({ id: 'i1' }));
    await saveInsight(fs, key, insight({ id: 'i2' }));
    const client = fakeClient({
      insights: [
        { id: 'i1', confidence: 'high', rationale: 'solid' },
        { id: 'i2', confidence: 'not-a-level' }, // invalid enum → dropped, not a whole-batch failure
      ],
      merges: [],
    });
    const result = await reconcileInsights(deps(fs, client));
    expect(result.ok).toBe(true);
    expect((await getInsight(fs, key, 'p1', 'i1'))?.confidence).toBe('high'); // good op applied
  });

  it('returns an honest MALFORMED (not a refusal) when no JSON comes back', async () => {
    const fs = memFileSystem();
    await saveInsight(fs, key, insight({ id: 'i1' }));
    const raw: ClaudeClient = {
      send: () => Promise.resolve(''),
      stream: (_o, onDelta) => {
        onDelta('just prose, no json');
        return Promise.resolve({
          text: 'just prose, no json',
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    expect(await reconcileInsights(deps(fs, raw))).toMatchObject({
      ok: false,
      reason: 'MALFORMED',
    });
  });

  it('only ever loads the subject’s OWN insights (never another person’s)', async () => {
    const fs = memFileSystem();
    await saveInsight(fs, key, insight({ id: 'mine', subjectPersonId: 'p1' }));
    await saveInsight(fs, key, insight({ id: 'theirs', subjectPersonId: 'p2', summary: 'OTHER' }));
    // The reconcile prompt's user message is the digest — assert it never contains the other subject's data.
    let seen = '';
    const client: ClaudeClient = {
      send: () => Promise.resolve(''),
      stream: (options, onDelta) => {
        seen = options.messages.map((m) => m.content).join('\n');
        const text = JSON.stringify({ insights: [{ id: 'mine', confidence: 'high' }], merges: [] });
        onDelta(text);
        return Promise.resolve({
          text,
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    await reconcileInsights(deps(fs, client));
    expect(seen).toContain('summary-mine');
    expect(seen).not.toContain('OTHER'); // p2's insight is never in p1's reconcile prompt
    // p2's insight is untouched.
    expect((await listInsightsForPerson(fs, key, 'p2')).length).toBe(1);
  });
});

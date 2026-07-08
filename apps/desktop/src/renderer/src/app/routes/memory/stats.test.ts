import { describe, expect, it } from 'vitest';
import type { Insight } from '@shared/schemas';
import { confidenceStats, overviewStats } from './stats';

function insight(over: Partial<Insight> & { id: string }): Insight {
  return {
    schemaVersion: 1,
    source: 'session',
    subjectPersonId: 'p1',
    summary: `s-${over.id}`,
    facts: [],
    confidence: 'medium',
    categories: ['Other'],
    approved: true,
    provenance: { at: '2026-06-20T12:00:00.000Z' },
    createdAt: '2026-06-20T12:00:00.000Z',
    updatedAt: '2026-06-20T12:00:00.000Z',
    ...over,
  };
}

describe('Memory stats derivations', () => {
  it('counts live facts by source and the latest update', () => {
    const stat = overviewStats([
      insight({
        id: 'a',
        source: 'intake',
        facts: [
          { id: 'f1', text: 'x', shareable: false },
          { id: 'f2', text: 'y', shareable: false, flaggedInaccurate: true }, // excluded
        ],
        updatedAt: '2026-06-21T00:00:00.000Z',
      }),
      insight({
        id: 'b',
        source: 'session',
        facts: [{ id: 'f3', text: 'z', shareable: false }],
        updatedAt: '2026-06-22T00:00:00.000Z',
      }),
    ]);
    expect(stat.total).toBe(2); // f2 flagged → not counted
    expect(stat.bySource).toEqual([
      { source: 'intake', count: 1 },
      { source: 'session', count: 1 },
    ]);
    expect(stat.lastUpdated).toBe('2026-06-22T00:00:00.000Z');
  });

  it('omits sources with no live facts and handles an empty list', () => {
    expect(overviewStats([])).toEqual({ total: 0, bySource: [], lastUpdated: undefined });
  });

  it('buckets confidence over approved insights', () => {
    const stat = confidenceStats([
      insight({ id: 'a', confidence: 'high' }),
      insight({ id: 'b', confidence: 'high' }),
      insight({ id: 'c', confidence: 'medium' }),
      insight({ id: 'd', confidence: 'low' }),
    ]);
    expect(stat).toEqual({ high: 2, medium: 1, low: 1, total: 4 });
  });
});

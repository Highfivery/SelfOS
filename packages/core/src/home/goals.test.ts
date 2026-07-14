import { describe, expect, it } from 'vitest';
import type { Goal } from '../schemas';
import { goalsSummary } from './goals';

const now = new Date('2026-07-14T00:00:00.000Z');

const goal = (over: Partial<Goal> & { id: string }): Goal => ({
  schemaVersion: 1,
  subjectPersonId: 'p1',
  text: over.id,
  status: 'open',
  provenance: { at: '2026-07-01T00:00:00.000Z' },
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-10T00:00:00.000Z',
  ...over,
});

describe('goalsSummary (60 §3.1.3)', () => {
  it('counts active / done / stale and a completion %', () => {
    const s = goalsSummary(
      [
        goal({ id: 'a', status: 'open' }),
        goal({ id: 'b', status: 'inProgress' }),
        goal({ id: 'c', status: 'done' }),
        goal({ id: 'd', status: 'abandoned' }), // not counted in progress denominator
        goal({ id: 'e', status: 'open', due: '2026-06-01' }), // past due → stale
      ],
      now,
    );
    expect(s.activeCount).toBe(3); // a, b, e
    expect(s.doneCount).toBe(1); // c
    expect(s.staleCount).toBe(1); // e
    // done / (active + done) = 1 / 4 = 25%
    expect(s.progressPct).toBe(25);
  });

  it('surfaces stale goals first, then the soonest due', () => {
    const s = goalsSummary(
      [
        goal({ id: 'soon', status: 'open', due: '2026-07-20' }),
        goal({ id: 'later', status: 'open', due: '2026-09-01' }),
        goal({ id: 'stale', status: 'open', due: '2026-06-01' }), // overdue
      ],
      now,
      2,
    );
    expect(s.top.map((g) => g.id)).toEqual(['stale', 'soon']);
  });

  it('is empty + 0% with no goals', () => {
    const s = goalsSummary([], now);
    expect(s).toEqual({ activeCount: 0, doneCount: 0, staleCount: 0, progressPct: 0, top: [] });
  });
});

import { describe, expect, it } from 'vitest';
import type { Goal } from '@shared/schemas';
import { stalestGoal } from './goalFollowup';

const NOW = new Date('2026-06-24T12:00:00.000Z');
const daysAgo = (n: number): string =>
  new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

function goal(id: string, over: Partial<Goal> = {}): Goal {
  return {
    id,
    schemaVersion: 1,
    subjectPersonId: 'p1',
    text: `goal ${id}`,
    status: 'open',
    provenance: { at: daysAgo(40) },
    createdAt: daysAgo(40),
    updatedAt: daysAgo(40),
    lastTouchedAt: daysAgo(40),
    ...over,
  };
}

describe('stalestGoal (40 §3.2)', () => {
  it('returns null when nothing is stale', () => {
    // Touched yesterday → not stale (< 21 days).
    expect(stalestGoal([goal('a', { lastTouchedAt: daysAgo(1) })], NOW)).toBeNull();
  });

  it('ignores done / abandoned goals (only active ones can be stale)', () => {
    expect(
      stalestGoal([goal('done', { status: 'done' }), goal('gone', { status: 'abandoned' })], NOW),
    ).toBeNull();
  });

  it('picks the least-recently-touched stale goal', () => {
    const picked = stalestGoal(
      [
        goal('fresh', { lastTouchedAt: daysAgo(1) }), // not stale
        goal('staleish', { lastTouchedAt: daysAgo(25) }),
        goal('stalest', { lastTouchedAt: daysAgo(60) }),
      ],
      NOW,
    );
    expect(picked?.id).toBe('stalest');
  });

  it('treats a past-due goal as stale even if recently touched', () => {
    const picked = stalestGoal([goal('due', { due: daysAgo(2), lastTouchedAt: daysAgo(1) })], NOW);
    expect(picked?.id).toBe('due');
  });
});

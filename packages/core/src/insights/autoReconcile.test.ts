import { describe, expect, it } from 'vitest';
import type { Insight } from '../schemas';
import { shouldAutoReconcile } from './autoReconcile';

const now = new Date('2026-06-30T00:00:00.000Z');
const daysAgo = (n: number): string =>
  new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

type Stamp = Pick<Insight, 'createdAt' | 'lastReconciledAt'>;
const i = (createdAt: string, lastReconciledAt?: string): Stamp => ({
  createdAt,
  ...(lastReconciledAt ? { lastReconciledAt } : {}),
});

describe('shouldAutoReconcile (39 §3.3 cadence)', () => {
  it('fires when ≥5 new insights exist since the last reconcile', () => {
    const reconciledAt = daysAgo(3);
    const insights = [
      i(daysAgo(10), reconciledAt), // old, already reconciled
      ...Array.from({ length: 5 }, () => i(daysAgo(1))), // 5 new since
    ];
    expect(shouldAutoReconcile({ insights, lastCheckedAt: undefined, now })).toBe(true);
  });

  it('fires for a never-reconciled person once there are ≥5 insights', () => {
    const insights = Array.from({ length: 5 }, () => i(daysAgo(1)));
    expect(shouldAutoReconcile({ insights, lastCheckedAt: undefined, now })).toBe(true);
  });

  it('fires on a >14-day gap even with few new insights', () => {
    const insights = [i(daysAgo(40), daysAgo(20)), i(daysAgo(40), daysAgo(20))];
    expect(shouldAutoReconcile({ insights, lastCheckedAt: undefined, now })).toBe(true);
  });

  it('does NOT fire with too little (under 5 new, recent reconcile, small gap)', () => {
    const insights = [i(daysAgo(5), daysAgo(2)), i(daysAgo(1))];
    expect(shouldAutoReconcile({ insights, lastCheckedAt: undefined, now })).toBe(false);
  });

  it('does NOT fire with fewer than 2 insights', () => {
    expect(shouldAutoReconcile({ insights: [i(daysAgo(1))], lastCheckedAt: undefined, now })).toBe(
      false,
    );
  });

  it('is throttled — no auto pass within 24h of the last check, even when warranted', () => {
    const insights = Array.from({ length: 6 }, () => i(daysAgo(1)));
    expect(shouldAutoReconcile({ insights, lastCheckedAt: daysAgo(0.5), now })).toBe(false); // 12h ago
    expect(shouldAutoReconcile({ insights, lastCheckedAt: daysAgo(2), now })).toBe(true); // 2d ago
  });
});

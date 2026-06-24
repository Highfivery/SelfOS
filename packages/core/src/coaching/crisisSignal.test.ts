import { describe, expect, it } from 'vitest';
import type { Insight } from '../schemas';
import { aggregateCrisisSignal } from './crisisSignal';

const NOW = new Date('2026-06-24T12:00:00.000Z');
const daysAgo = (n: number): string =>
  new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

function insight(at: string, crisisFlag: boolean, extra: Partial<Insight> = {}): Insight {
  return {
    id: `i-${at}-${String(crisisFlag)}`,
    schemaVersion: 1,
    source: 'session',
    subjectPersonId: 'me',
    summary: 's',
    facts: [],
    confidence: 'medium',
    categories: [],
    approved: true,
    crisisFlag,
    provenance: { at },
    createdAt: at,
    updatedAt: at,
    ...extra,
  };
}

describe('aggregateCrisisSignal (40 §3.5)', () => {
  it('is not recurring with a single recent crisis flag', () => {
    const out = aggregateCrisisSignal({
      insights: [insight(daysAgo(1), true), insight(daysAgo(2), false)],
      nightmareNudge: false,
      now: NOW,
    });
    expect(out.recurring).toBe(false);
    expect(out.count).toBe(1);
  });

  it('recurs at ≥2 crisis flags within the 14-day window, with a "since"', () => {
    const out = aggregateCrisisSignal({
      insights: [insight(daysAgo(2), true), insight(daysAgo(9), true)],
      nightmareNudge: false,
      now: NOW,
    });
    expect(out.recurring).toBe(true);
    expect(out.count).toBe(2);
    expect(out.since).toBe(daysAgo(9)); // the earliest in-window flag
  });

  it('ignores crisis flags older than the window', () => {
    const out = aggregateCrisisSignal({
      insights: [insight(daysAgo(2), true), insight(daysAgo(30), true)],
      nightmareNudge: false,
      now: NOW,
    });
    expect(out.count).toBe(1);
    expect(out.recurring).toBe(false);
  });

  it('recurs on the dream nightmare nudge alone (even with no crisis-flagged insights)', () => {
    const out = aggregateCrisisSignal({ insights: [], nightmareNudge: true, now: NOW });
    expect(out.recurring).toBe(true);
    expect(out.nightmare).toBe(true);
    expect(out.count).toBe(0);
  });

  it('does not count unapproved drafts', () => {
    const out = aggregateCrisisSignal({
      insights: [
        insight(daysAgo(1), true, { approved: false }),
        insight(daysAgo(2), true, { approved: false }),
      ],
      nightmareNudge: false,
      now: NOW,
    });
    expect(out.recurring).toBe(false);
    expect(out.count).toBe(0);
  });
});

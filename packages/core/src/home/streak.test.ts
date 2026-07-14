import { describe, expect, it } from 'vitest';
import { computeStreak } from './streak';

// A fixed "now" (local) so day math is deterministic. Use midday to avoid boundary flakiness.
const now = new Date('2026-07-13T12:00:00');
const dayAt = (offsetDays: number, hour = 9): string => {
  const d = new Date(now);
  d.setDate(d.getDate() - offsetDays);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

describe('computeStreak', () => {
  it('counts consecutive active days ending today', () => {
    const info = computeStreak({ now, activity: [dayAt(0), dayAt(1), dayAt(2)] });
    expect(info.days).toBe(3);
    expect(info.suppressed).toBe(false);
    expect(info.since).toBeDefined();
  });

  it('multiple activities on the same day count once', () => {
    const info = computeStreak({ now, activity: [dayAt(0, 8), dayAt(0, 20), dayAt(1)] });
    expect(info.days).toBe(2);
  });

  it('uses yesterday as a grace anchor when there is no activity yet today', () => {
    const info = computeStreak({ now, activity: [dayAt(1), dayAt(2), dayAt(3)] });
    expect(info.days).toBe(3);
  });

  it('returns 0 when the most recent activity is older than yesterday (run is over — no shaming)', () => {
    const info = computeStreak({ now, activity: [dayAt(3), dayAt(4)] });
    expect(info.days).toBe(0);
    expect(info.since).toBeUndefined();
  });

  it('a gap ends the run — only the current consecutive tail counts, never a total or a miss', () => {
    // active today, yesterday, then a gap at day 2, then day 3 — only today+yesterday are the current run.
    const info = computeStreak({ now, activity: [dayAt(0), dayAt(1), dayAt(3), dayAt(4)] });
    expect(info.days).toBe(2);
  });

  it('is suppressed during a crisis signal (never streak a struggling person)', () => {
    const info = computeStreak({ now, activity: [dayAt(0), dayAt(1), dayAt(2)], crisis: true });
    expect(info).toEqual({ days: 0, suppressed: true });
  });

  it('ignores unparseable and future timestamps', () => {
    const future = dayAt(-2); // 2 days ahead
    const info = computeStreak({ now, activity: [dayAt(0), 'not-a-date', future] });
    expect(info.days).toBe(1);
  });

  it('empty activity → no streak', () => {
    expect(computeStreak({ now, activity: [] })).toEqual({ days: 0, suppressed: false });
  });
});

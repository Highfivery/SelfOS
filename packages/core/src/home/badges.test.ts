import { describe, expect, it } from 'vitest';
import { activeMilestones } from './badges';

const base = { streakDays: 0, sessionCount: 0, areasExplored: 0, challengesDone: 0 };

describe('activeMilestones', () => {
  it('earns nothing below every threshold', () => {
    expect(activeMilestones(base)).toEqual([]);
    expect(activeMilestones({ ...base, streakDays: 6, sessionCount: 9, areasExplored: 4 })).toEqual(
      [],
    );
  });

  it('earns each milestone at its threshold', () => {
    expect(activeMilestones({ ...base, streakDays: 7 }).map((b) => b.id)).toEqual(['rhythm-week']);
    expect(activeMilestones({ ...base, sessionCount: 10 }).map((b) => b.id)).toEqual([
      'ten-sessions',
    ]);
    expect(activeMilestones({ ...base, areasExplored: 5 }).map((b) => b.id)).toEqual([
      'five-areas',
    ]);
    expect(activeMilestones({ ...base, challengesDone: 1 }).map((b) => b.id)).toEqual([
      'first-challenge',
    ]);
  });

  it('returns every currently-earned milestone together (the caller celebrates each once)', () => {
    const earned = activeMilestones({
      streakDays: 12,
      sessionCount: 20,
      areasExplored: 6,
      challengesDone: 2,
    });
    expect(earned.map((b) => b.id)).toEqual([
      'rhythm-week',
      'ten-sessions',
      'five-areas',
      'first-challenge',
    ]);
    expect(earned.every((b) => b.title.length > 0 && b.body.length > 0)).toBe(true);
  });
});

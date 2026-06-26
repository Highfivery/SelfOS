import { describe, expect, it } from 'vitest';
import { computeMomentum } from './momentum';
import type { MomentumReflection } from './schemas';

describe('computeMomentum', () => {
  it('reflects showing up when ≥2 this week (highest priority)', () => {
    const m = computeMomentum({ showedUpThisWeek: 3, areasExplored: 4, goalsMovingForward: 2 });
    expect(m.line).toBe('you’ve shown up 3 times this week');
  });

  it('falls back to breadth when showing-up is thin', () => {
    const m = computeMomentum({ showedUpThisWeek: 1, areasExplored: 4, goalsMovingForward: 0 });
    expect(m.line).toBe('you’ve explored 4 areas of yourself so far');
  });

  it('falls back to goals moving forward', () => {
    expect(
      computeMomentum({ showedUpThisWeek: 0, areasExplored: 1, goalsMovingForward: 1 }).line,
    ).toBe('you’ve got a goal moving forward');
    expect(
      computeMomentum({ showedUpThisWeek: 0, areasExplored: 1, goalsMovingForward: 2 }).line,
    ).toBe('you’ve got 2 goals moving forward');
  });

  it('degrades to nothing (just the greeting) on a quiet week — NEVER a gap/streak/miss', () => {
    const m = computeMomentum({ showedUpThisWeek: 0, areasExplored: 0, goalsMovingForward: 0 });
    expect(m).toEqual({});
    expect(m.line).toBeUndefined();
  });

  it('only ever carries positive reflection fields (the no-streak/no-overdue shape constraint)', () => {
    const m: MomentumReflection = computeMomentum({
      showedUpThisWeek: 3,
      areasExplored: 2,
      goalsMovingForward: 1,
    });
    // The reflection's keys are a closed positive set — no gap/streak/miss/overdue can be expressed.
    const allowed = new Set(['line', 'showedUp', 'areas', 'goalsMoving']);
    for (const key of Object.keys(m)) expect(allowed.has(key)).toBe(true);
    for (const v of [m.showedUp, m.areas, m.goalsMoving]) {
      if (v !== undefined) expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it('clamps negative/fractional inputs to safe non-negative counts', () => {
    const m = computeMomentum({ showedUpThisWeek: -5, areasExplored: 2.9, goalsMovingForward: -1 });
    expect(m.line).toBe('you’ve explored 2 areas of yourself so far');
    expect(m.goalsMoving).toBe(0);
  });
});

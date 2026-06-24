import { describe, expect, it } from 'vitest';
import { goalRaiseInstruction } from './goalRaise';

describe('goalRaiseInstruction (40 §3.1)', () => {
  it('returns "" when there are no active goals (nothing to raise)', () => {
    expect(goalRaiseInstruction({ goals: [] })).toBe('');
  });

  it('names the active commitments and guards relevance + safety', () => {
    const out = goalRaiseInstruction({
      goals: [{ text: 'finish the kitchen', stale: false }],
      level: 'gentle',
    });
    expect(out).toContain('finish the kitchen');
    expect(out).toContain('ONLY if'); // relevance-gated
    expect(out).toContain('AT MOST ONE'); // raise once
    expect(out.toLowerCase()).toContain('safety'); // yields to safety
    expect(out.toLowerCase()).toContain('let it go'); // drop it if not picked up
  });

  it('marks a stale goal so the coach favours the long-untouched one', () => {
    const out = goalRaiseInstruction({
      goals: [{ text: 'call my brother', stale: true }],
    });
    expect(out).toContain('call my brother');
    expect(out).toContain('a while ago');
  });

  it('is a touch more present at the "active" level', () => {
    const goals = [{ text: 'run a 5k', stale: false }];
    const gentle = goalRaiseInstruction({ goals, level: 'gentle' });
    const active = goalRaiseInstruction({ goals, level: 'active' });
    expect(gentle).toContain('Keep it light and unforced');
    expect(active).toContain('a little more present');
  });

  it('bounds the number of goals it names', () => {
    const goals = Array.from({ length: 9 }, (_, i) => ({ text: `goal ${i}`, stale: false }));
    const out = goalRaiseInstruction({ goals });
    expect(out).toContain('goal 0');
    expect(out).toContain('goal 4');
    expect(out).not.toContain('goal 5'); // capped at MAX_NAMED (5)
  });
});

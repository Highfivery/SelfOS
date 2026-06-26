import { describe, expect, it } from 'vitest';
import { pendingCelebration } from './celebration';
import type { Completion } from './schemas';

const NOW = new Date('2026-06-25T12:00:00.000Z');

function c(key: string, at: string): Completion {
  return { key, title: `Nice — ${key}`, at };
}

describe('pendingCelebration', () => {
  it('returns the newest eligible uncelebrated completion', () => {
    const result = pendingCelebration(
      [c('onboarding', '2026-06-24T00:00:00.000Z'), c('session:1', '2026-06-25T06:00:00.000Z')],
      new Set(),
      NOW,
    );
    expect(result?.key).toBe('session:1');
  });

  it('does not re-celebrate a recorded signature', () => {
    const result = pendingCelebration(
      [c('session:1', '2026-06-25T06:00:00.000Z')],
      new Set(['celebrate:session:1']),
      NOW,
    );
    expect(result).toBeNull();
  });

  it('ignores ancient completions (outside the recent window) so shipping never fêtes old history', () => {
    const result = pendingCelebration(
      [c('session:old', '2026-05-01T00:00:00.000Z')],
      new Set(),
      NOW,
    );
    expect(result).toBeNull();
  });

  it('ignores future-dated or unparseable timestamps', () => {
    const result = pendingCelebration(
      [c('future', '2026-12-01T00:00:00.000Z'), c('bad', 'not-a-date')],
      new Set(),
      NOW,
    );
    expect(result).toBeNull();
  });
});

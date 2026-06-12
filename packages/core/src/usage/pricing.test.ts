// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cacheSavingsOf, costOf } from './pricing';

describe('pricing', () => {
  it('computes cost from input + output tokens (sonnet)', () => {
    // 1M input @ $3 + 1M output @ $15 = $18
    expect(
      costOf('claude-sonnet-4-6', {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
      }),
    ).toBeCloseTo(18);
  });

  it('prices cache write and read', () => {
    // 1M cache write @ $3.75 + 1M cache read @ $0.30 = $4.05
    expect(
      costOf('claude-sonnet-4-6', {
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
      }),
    ).toBeCloseTo(4.05);
  });

  it('computes cache savings vs the full input price', () => {
    // 1M read saves (3 − 0.30) = $2.70
    expect(cacheSavingsOf('claude-sonnet-4-6', 1_000_000)).toBeCloseTo(2.7);
  });

  it('falls back to a conservative price for unknown models', () => {
    expect(
      costOf('mystery-model', {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
      }),
    ).toBeCloseTo(5);
  });

  it('charges a flat per-image cost for image models (zero tokens → not $0)', () => {
    const zero = { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 };
    expect(costOf('gpt-image-2', zero)).toBeCloseTo(0.17);
    expect(costOf('gpt-image-1', zero)).toBeCloseTo(0.17);
  });
});

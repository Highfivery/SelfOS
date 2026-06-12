// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fakeImageClient } from './openaiImageClient';

describe('fakeImageClient', () => {
  it('returns a tiny PNG by default (deterministic, no network)', async () => {
    const outcome = await fakeImageClient().generate({
      apiKey: 'x',
      model: 'gpt-image-2',
      prompt: 'a dreamscape',
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.image.mime).toBe('image/png');
    // PNG magic bytes: 0x89 'P' 'N' 'G'.
    expect(Array.from(outcome.image.bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('refuses (content policy) when in refuse mode — the refusal-not-metered E2E hook', async () => {
    const outcome = await fakeImageClient('refuse').generate({
      apiKey: 'x',
      model: 'gpt-image-2',
      prompt: 'a dreamscape',
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('REFUSED');
  });
});

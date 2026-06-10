// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { runConnectionTest, type ClaudeClient } from './claudeService';

const noopStream: ClaudeClient['stream'] = () =>
  Promise.resolve({
    text: '',
    usage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 },
  });
const okClient: ClaudeClient = { send: () => Promise.resolve('ok'), stream: noopStream };
const throwing = (error: unknown): ClaudeClient => ({
  send: () => Promise.reject(error),
  stream: noopStream,
});

describe('runConnectionTest', () => {
  it('returns NO_KEY when no key is set', async () => {
    const result = await runConnectionTest(okClient, null, 'claude-sonnet-4-6');
    expect(result).toMatchObject({ ok: false, code: 'NO_KEY' });
  });

  it('returns ok with the response text on success', async () => {
    expect(await runConnectionTest(okClient, 'sk', 'claude-sonnet-4-6')).toEqual({
      ok: true,
      text: 'ok',
    });
  });

  it('maps a 401 to AUTH', async () => {
    const result = await runConnectionTest(throwing({ status: 401 }), 'sk', 'claude-sonnet-4-6');
    expect(result).toMatchObject({ ok: false, code: 'AUTH' });
  });

  it('maps a 429 to RATE_LIMIT', async () => {
    const result = await runConnectionTest(throwing({ status: 429 }), 'sk', 'claude-sonnet-4-6');
    expect(result).toMatchObject({ ok: false, code: 'RATE_LIMIT' });
  });

  it('maps an error without a status to NETWORK', async () => {
    const result = await runConnectionTest(
      throwing(new Error('fetch failed')),
      'sk',
      'claude-sonnet-4-6',
    );
    expect(result).toMatchObject({ ok: false, code: 'NETWORK' });
  });
});

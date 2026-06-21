import { describe, expect, it } from 'vitest';
import type { ImageClient } from '@selfos/core/host';
import { runOpenAiConnectionTest } from './openaiProxy';

const okImage: ImageClient = {
  verify: () => Promise.resolve(),
  generate: () => Promise.reject(new Error('not used')),
};
const failImage = (status?: number): ImageClient => ({
  verify: () =>
    Promise.reject(
      status === undefined ? new Error('network') : Object.assign(new Error('http'), { status }),
    ),
  generate: () => Promise.reject(new Error('not used')),
});

describe('runOpenAiConnectionTest (29 §5.B)', () => {
  it('NO_KEY when no key is resolved (no network call)', async () => {
    expect(await runOpenAiConnectionTest(okImage, null)).toEqual({
      ok: false,
      code: 'NO_KEY',
      message: 'Add your OpenAI key first.',
    });
  });

  it('ok on a successful probe', async () => {
    expect(await runOpenAiConnectionTest(okImage, 'sk-openai')).toEqual({ ok: true, text: 'ok' });
  });

  it('maps HTTP statuses to the shared taxonomy with OpenAI-named messages', async () => {
    expect(await runOpenAiConnectionTest(failImage(401), 'k')).toMatchObject({ code: 'AUTH' });
    expect(await runOpenAiConnectionTest(failImage(403), 'k')).toMatchObject({ code: 'AUTH' });
    expect(await runOpenAiConnectionTest(failImage(429), 'k')).toMatchObject({
      code: 'RATE_LIMIT',
    });
    expect(await runOpenAiConnectionTest(failImage(500), 'k')).toMatchObject({ code: 'API_ERROR' });
    expect(await runOpenAiConnectionTest(failImage(undefined), 'k')).toMatchObject({
      code: 'NETWORK',
    });
    const auth = await runOpenAiConnectionTest(failImage(401), 'k');
    expect(auth.ok ? '' : auth.message).toContain('OpenAI');
  });
});

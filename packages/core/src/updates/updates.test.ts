import { describe, expect, it, vi } from 'vitest';
import { checkForUpdate, type FetchLike } from './index';

const NOW = '2026-06-23T12:00:00.000Z';

/** A fake `fetch` returning a JSON body with the given status (default 200). */
function jsonFetch(body: unknown, status = 200): FetchLike {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  ) as unknown as FetchLike;
}

function release(tag: string, extra: Record<string, unknown> = {}): unknown {
  return {
    tag_name: tag,
    html_url: `https://github.com/Highfivery/SelfOS/releases/tag/${tag}`,
    ...extra,
  };
}

describe('checkForUpdate', () => {
  it('flags an update when the latest tag is newer', async () => {
    const result = await checkForUpdate({
      fetch: jsonFetch(release('v0.5.0', { published_at: '2026-06-20T00:00:00Z' })),
      currentVersion: '0.4.0',
      now: NOW,
    });
    expect(result).toEqual({
      current: '0.4.0',
      latest: '0.5.0',
      isUpdateAvailable: true,
      releaseUrl: 'https://github.com/Highfivery/SelfOS/releases/tag/v0.5.0',
      publishedAt: '2026-06-20T00:00:00Z',
      checkedAt: NOW,
    });
  });

  it('is up to date when the latest equals the running version', async () => {
    const result = await checkForUpdate({
      fetch: jsonFetch(release('v0.4.0')),
      currentVersion: 'v0.4.0', // a leading v on the running version is tolerated
      now: NOW,
    });
    expect(result?.isUpdateAvailable).toBe(false);
    expect(result?.latest).toBe('0.4.0');
    expect(result?.current).toBe('0.4.0');
  });

  it('never flags an update when the latest is older (downgrade)', async () => {
    const result = await checkForUpdate({
      fetch: jsonFetch(release('v0.3.0')),
      currentVersion: '0.4.0',
      now: NOW,
    });
    expect(result?.isUpdateAvailable).toBe(false);
  });

  it('compares numerically, not lexicographically (0.10.0 > 0.9.0)', async () => {
    const result = await checkForUpdate({
      fetch: jsonFetch(release('v0.10.0')),
      currentVersion: '0.9.0',
      now: NOW,
    });
    expect(result?.isUpdateAvailable).toBe(true);
  });

  it('treats no releases (404) as up to date', async () => {
    const result = await checkForUpdate({
      fetch: jsonFetch({ message: 'Not Found' }, 404),
      currentVersion: '0.4.0',
      now: NOW,
    });
    expect(result).toEqual({
      current: '0.4.0',
      latest: '0.4.0',
      isUpdateAvailable: false,
      releaseUrl: 'https://github.com/Highfivery/SelfOS/releases',
      checkedAt: NOW,
    });
  });

  it('returns null (couldn’t check) when rate-limited (403)', async () => {
    const result = await checkForUpdate({
      fetch: jsonFetch({ message: 'rate limited' }, 403),
      currentVersion: '0.4.0',
      now: NOW,
    });
    expect(result).toBeNull();
  });

  it('returns null on a network failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as FetchLike;
    const result = await checkForUpdate({ fetch: fetchImpl, currentVersion: '0.4.0', now: NOW });
    expect(result).toBeNull();
  });

  it('returns null when the request times out (aborts)', async () => {
    const fetchImpl = vi.fn(
      (_url: unknown, init?: { signal?: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ) as unknown as FetchLike;
    vi.useFakeTimers();
    try {
      const promise = checkForUpdate({ fetch: fetchImpl, currentVersion: '0.4.0', now: NOW });
      await vi.advanceTimersByTimeAsync(9000); // past the 8s timeout
      await expect(promise).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores a malformed tag (treats as up to date, never crashes)', async () => {
    const result = await checkForUpdate({
      fetch: jsonFetch(release('nightly')),
      currentVersion: '0.4.0',
      now: NOW,
    });
    expect(result?.isUpdateAvailable).toBe(false);
    expect(result?.latest).toBe('0.4.0');
  });

  it('returns null on an unparseable body', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('not json', { status: 200 }),
    ) as unknown as FetchLike;
    const result = await checkForUpdate({ fetch: fetchImpl, currentVersion: '0.4.0', now: NOW });
    expect(result).toBeNull();
  });

  it('falls back to the Releases page when a release has no html_url', async () => {
    const result = await checkForUpdate({
      fetch: jsonFetch({ tag_name: 'v0.5.0' }),
      currentVersion: '0.4.0',
      now: NOW,
    });
    expect(result?.releaseUrl).toBe('https://github.com/Highfivery/SelfOS/releases');
    expect(result?.isUpdateAvailable).toBe(true);
  });

  it('sends a descriptive User-Agent and no auth token', async () => {
    const fetchImpl = jsonFetch(release('v0.4.0'));
    await checkForUpdate({ fetch: fetchImpl, currentVersion: '0.4.0', now: NOW });
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { headers: Record<string, string> },
    ];
    expect(init.headers['User-Agent']).toBe('SelfOS/0.4.0');
    expect(init.headers).not.toHaveProperty('Authorization');
  });
});

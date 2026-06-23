import type { FetchLike } from '@selfos/core/updates';

/**
 * A deterministic fake `fetch` for the update check (36-update-awareness §10), gated by `SELFOS_FAKE_UPDATE`,
 * the same way `SELFOS_FAKE_RELAY` / `SELFOS_FAKE_CLAUDE` make those calls offline + deterministic. It only
 * answers the GitHub `releases/latest` request — so the REAL `checkForUpdate` parse + semver logic still runs
 * in E2E (this fakes only the network, not the result).
 *
 * The env value is the version to report as latest:
 *   - `error`  → reject (network failure → the calm "couldn't check" path)
 *   - `none`   → 404 (no releases yet → up to date)
 *   - `vX.Y.Z` / `X.Y.Z` → a 200 release with that tag (e.g. `9.9.9` ⇒ available; `0.0.0` ⇒ up to date)
 */
export function fakeUpdateFetch(value: string): FetchLike {
  return ((input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (!url.includes('/releases/latest')) {
      return Promise.reject(new Error(`fake update fetch: unexpected URL ${url}`));
    }
    if (value === 'error') return Promise.reject(new Error('fake update fetch: forced error'));
    if (value === 'none') {
      return Promise.resolve(
        new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 }),
      );
    }
    const tag = value.startsWith('v') ? value : `v${value}`;
    const body = {
      tag_name: tag,
      html_url: `https://github.com/Highfivery/SelfOS/releases/tag/${tag}`,
      published_at: '2026-06-23T00:00:00Z',
    };
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as FetchLike;
}

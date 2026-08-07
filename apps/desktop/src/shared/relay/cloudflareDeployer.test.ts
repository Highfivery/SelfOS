// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  CloudflareDeployError,
  deployRelay,
  teardownRelay,
  verifyCloudflareToken,
} from './cloudflareDeployer';

const bundle = { script: 'export default {}', version: '1' };

function cfFetch(overrides: Record<string, unknown> = {}): {
  fetch: typeof fetch;
  calls: { url: string; method: string }[];
} {
  const calls: { url: string; method: string }[] = [];
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status });
  const fetchFn = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET' });
    if (url in overrides) return overrides[url] as Response;
    if (url.endsWith('/user/tokens/verify'))
      return json({ success: true, result: { status: 'active' } });
    if (url.endsWith('/workers/subdomain'))
      return json({ success: true, result: { subdomain: 'acme' } });
    if (url.endsWith('/storage/kv/namespaces'))
      return json({ success: true, result: { id: 'kv1' } });
    return json({ success: true, result: {} });
  }) as typeof fetch;
  return { fetch: fetchFn, calls };
}

describe('cloudflareDeployer', () => {
  it('verifies token, provisions KV, uploads the Worker, and returns the workers.dev endpoint', async () => {
    const { fetch, calls } = cfFetch();
    const result = await deployRelay(fetch, bundle, { apiToken: 'tok', accountId: 'acct' });
    expect(result.endpointUrl).toBe('https://selfos-relay.acme.workers.dev');
    expect(result.kvNamespaceId).toBe('kv1');
    expect(result.relayVersion).toBe('1');
    expect(result.drainSecret).toMatch(/^[0-9a-f]{64}$/);
    // The Worker upload is a PUT to the scripts endpoint.
    expect(
      calls.some((c) => c.method === 'PUT' && c.url.includes('/workers/scripts/selfos-relay')),
    ).toBe(true);
  });

  it('reuses an existing KV namespace when one with the title already exists (idempotent re-connect)', async () => {
    const base = 'https://api.cloudflare.com/client/v4/accounts/acct/storage/kv/namespaces';
    const { fetch, calls } = cfFetch({
      // Creating a namespace with the same title fails (a prior/partial provision left it behind)…
      [base]: new Response(
        JSON.stringify({
          success: false,
          errors: [{ message: 'a namespace with this account ID and title already exists' }],
        }),
        { status: 400 },
      ),
      // …so the deployer lists namespaces + reuses the matching one.
      [`${base}?per_page=100`]: new Response(
        JSON.stringify({
          success: true,
          result: [
            { id: 'other', title: 'unrelated' },
            { id: 'kv-existing', title: 'selfos-relay-mailbox' },
          ],
        }),
        { status: 200 },
      ),
    });
    const result = await deployRelay(fetch, bundle, { apiToken: 'tok', accountId: 'acct' });
    expect(result.kvNamespaceId).toBe('kv-existing');
    expect(calls.some((c) => c.url.endsWith('?per_page=100'))).toBe(true);
    // Still uploaded the Worker (bound to the reused namespace).
    expect(
      calls.some((c) => c.method === 'PUT' && c.url.includes('/workers/scripts/selfos-relay')),
    ).toBe(true);
  });

  it('refuses to deploy when the token is invalid', async () => {
    const { fetch } = cfFetch({
      'https://api.cloudflare.com/client/v4/user/tokens/verify': new Response(
        JSON.stringify({ success: false, errors: [{ message: 'bad token' }] }),
        { status: 401 },
      ),
    });
    expect(await verifyCloudflareToken(fetch, 'tok')).toBe(false);
    await expect(
      deployRelay(fetch, bundle, { apiToken: 'tok', accountId: 'acct' }),
    ).rejects.toBeInstanceOf(CloudflareDeployError);
  });

  it('teardown deletes the Worker + the KV namespace (best-effort)', async () => {
    const { fetch, calls } = cfFetch();
    await teardownRelay(fetch, {
      apiToken: 'tok',
      accountId: 'acct',
      scriptName: 'selfos-relay',
      kvNamespaceId: 'kv1',
    });
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(2);
  });
});

import {
  drain,
  purge,
  putMailbox,
  putResult,
  respond,
  revoke,
  unlock,
  type RelayEnv,
  type RelayKv,
} from '@selfos/core/relay';
import type { RelayBundle } from './cloudflareDeployer';

/**
 * A deterministic in-memory relay (Cloudflare REST + Worker) for E2E/dev, gated by `SELFOS_FAKE_RELAY`.
 * It lets the external-send → drain UI flow run without a real Cloudflare account or network, the same
 * way `SELFOS_FAKE_CLAUDE` / `SELFOS_FAKE_SECRETS` make Claude + secrets deterministic.
 */
export function fakeRelayFetch(): typeof fetch {
  const store = new Map<string, string>();
  const kv: RelayKv = {
    get: (k) => Promise.resolve(store.get(k) ?? null),
    put: (k, v) => {
      store.set(k, v);
      return Promise.resolve();
    },
    delete: (k) => {
      store.delete(k);
      return Promise.resolve();
    },
  };
  let clock = 1_000_000;
  const env: RelayEnv = { kv, nowMs: () => (clock += 1), nowIso: () => new Date().toISOString() };
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status });

  return (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    if (url.startsWith('https://api.cloudflare.com')) {
      if (url.endsWith('/user/tokens/verify'))
        return json({ success: true, result: { status: 'active' } });
      if (url.endsWith('/workers/subdomain'))
        return json({ success: true, result: { subdomain: 'demo' } });
      if (url.endsWith('/storage/kv/namespaces'))
        return json({ success: true, result: { id: 'kv1' } });
      return json({ success: true, result: {} });
    }
    const path = new URL(url).pathname;
    const ops: Record<string, () => Promise<{ status: number; json: unknown }>> = {
      '/api/admin/mailbox': () => putMailbox(env, body),
      '/api/admin/result': () => putResult(env, body),
      '/api/admin/drain': () => drain(env, body),
      '/api/admin/purge': () => purge(env, body),
      '/api/admin/revoke': () => revoke(env, body),
      '/api/unlock': () => unlock(env, body),
      '/api/respond': () => respond(env, body),
    };
    const op = ops[path];
    if (!op) return json({ error: 'not found' }, 404);
    const result = await op();
    return json(result.json, result.status);
  }) as typeof fetch;
}

/** A stub Worker bundle so the fake connect path doesn't need a real `apps/relay` build. */
export function fakeRelayBundle(): Promise<RelayBundle> {
  return Promise.resolve({ script: 'export default {}', version: '1' });
}

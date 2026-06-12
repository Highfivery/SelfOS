import type { RelayClient } from '@selfos/core/questionnaires';
import type { RelayMailbox, RelayStoredResponse } from '@selfos/core/schemas';
import type { FetchLike } from './cloudflareDeployer';

/**
 * The app's HTTPS transport to a deployed relay Worker (08-questionnaires §5.2) — the concrete
 * `RelayClient` the core `createRelaySend` / `drainRelaySend` orchestration calls. Drain/manage endpoints
 * are authenticated by the `drainSecret`, which stays host-side and never reaches the renderer.
 */
export function createRelayHttpClient(
  endpointUrl: string,
  drainSecret: string,
  fetchImpl: FetchLike,
): RelayClient {
  const base = endpointUrl.replace(/\/+$/, '');
  const post = async (path: string, body: unknown): Promise<unknown> => {
    const res = await fetchImpl(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${drainSecret}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Relay request failed (${res.status}) for ${path}`);
    return res.json().catch(() => ({}));
  };
  return {
    putMailbox: async (mailbox: RelayMailbox) => {
      await post('/api/admin/mailbox', mailbox);
    },
    drain: async (token: string) => {
      const json = (await post('/api/admin/drain', { token })) as {
        responses?: RelayStoredResponse[];
      };
      return json.responses ?? [];
    },
    purge: async (token: string) => {
      await post('/api/admin/purge', { token });
    },
    revoke: async (token: string) => {
      await post('/api/admin/revoke', { token });
    },
  };
}

import { describe, expect, it } from 'vitest';
import { hashPin } from '@selfos/core/crypto';
import type { RelayKv } from '@selfos/core/relay';
import type { EncryptedEnvelopeData, RelayMailbox, SealedResponse } from '@selfos/core/schemas';
import { handleRelayRequest, type WorkerEnv } from './handler';

const PAGE = '<!doctype html><html><body>relay page</body></html>';
const DRAIN_SECRET = 'super-secret-drain-token';

const envelope: EncryptedEnvelopeData = {
  v: 1,
  alg: 'aes-256-gcm',
  iv: 'AA',
  tag: 'BB',
  data: 'CC',
};
const sealed: SealedResponse = { epk: 'EPK', env: envelope };

function memEnv(): WorkerEnv & { store: Map<string, string> } {
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
  return { RELAY_KV: kv, DRAIN_SECRET, store };
}

const post = (path: string, body: unknown, headers: Record<string, string> = {}): Request =>
  new Request(`https://relay.example.dev${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

const auth = { authorization: `Bearer ${DRAIN_SECRET}` };

async function mailbox(token: string, pin: string): Promise<RelayMailbox> {
  return {
    schemaVersion: 1,
    token,
    sealedContent: envelope,
    pinHash: await hashPin(pin),
    createdAt: '2026-06-11T00:00:00.000Z',
  };
}

describe('relay worker handler', () => {
  it('serves the answering page for /q/<token>', async () => {
    const res = await handleRelayRequest(
      new Request('https://relay.example.dev/q/abc123'),
      memEnv(),
      PAGE,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(await res.text()).toBe(PAGE);
  });

  it('requires the drain secret for admin endpoints', async () => {
    const env = memEnv();
    const unauthed = await handleRelayRequest(
      post('/api/admin/mailbox', await mailbox('tok', '123456')),
      env,
      PAGE,
    );
    expect(unauthed.status).toBe(401);

    const authed = await handleRelayRequest(
      post('/api/admin/mailbox', await mailbox('tok', '123456'), auth),
      env,
      PAGE,
    );
    expect(authed.status).toBe(200);
    expect(env.store.has('mailbox:tok')).toBe(true);
  });

  it('runs the recipient flow: unlock, respond, then the app drains', async () => {
    const env = memEnv();
    await handleRelayRequest(
      post('/api/admin/mailbox', await mailbox('tok', '123456'), auth),
      env,
      PAGE,
    );

    const unlocked = await handleRelayRequest(
      post('/api/unlock', { token: 'tok', pin: '123456' }),
      env,
      PAGE,
    );
    expect(unlocked.status).toBe(200);
    expect(((await unlocked.json()) as { sealedContent: unknown }).sealedContent).toEqual(envelope);

    const responded = await handleRelayRequest(
      post('/api/respond', { token: 'tok', pin: '123456', sealed }),
      env,
      PAGE,
    );
    expect(responded.status).toBe(200);

    const drained = await handleRelayRequest(
      post('/api/admin/drain', { token: 'tok' }, auth),
      env,
      PAGE,
    );
    expect(((await drained.json()) as { responses: unknown[] }).responses).toHaveLength(1);
  });

  it('rejects a wrong PIN and returns 404 for unknown routes', async () => {
    const env = memEnv();
    await handleRelayRequest(
      post('/api/admin/mailbox', await mailbox('tok', '123456'), auth),
      env,
      PAGE,
    );
    expect(
      (await handleRelayRequest(post('/api/unlock', { token: 'tok', pin: '000000' }), env, PAGE))
        .status,
    ).toBe(401);
    expect(
      (await handleRelayRequest(new Request('https://relay.example.dev/nope'), env, PAGE)).status,
    ).toBe(404);
  });
});

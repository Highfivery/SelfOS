// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { RelayMailbox } from '@selfos/core/schemas';
import { createRelayHttpClient } from './relayHttpClient';

const envelope = { v: 1 as const, alg: 'aes-256-gcm' as const, iv: 'AA', tag: 'BB', data: 'CC' };
const mailbox: RelayMailbox = {
  schemaVersion: 1,
  token: 'tok',
  sealedContent: envelope,
  pinHash: 'salt:hash',
  createdAt: '2026-06-11T00:00:00.000Z',
};

function recordingFetch(response: unknown): {
  fetch: typeof fetch;
  calls: { url: string; auth: string | null; body: unknown }[];
} {
  const calls: { url: string; auth: string | null; body: unknown }[] = [];
  const fetchFn = (async (input: string | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      auth: headers.get('authorization'),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    });
    return new Response(JSON.stringify(response), { status: 200 });
  }) as typeof fetch;
  return { fetch: fetchFn, calls };
}

describe('relayHttpClient', () => {
  it('authenticates with the drain secret and posts to the admin endpoints', async () => {
    const { fetch, calls } = recordingFetch({ ok: true });
    const client = createRelayHttpClient('https://relay.example.dev/', 'drain-secret', fetch);
    await client.putMailbox(mailbox);
    expect(calls[0]?.url).toBe('https://relay.example.dev/api/admin/mailbox');
    expect(calls[0]?.auth).toBe('Bearer drain-secret');
    expect(calls[0]?.body).toMatchObject({ token: 'tok' });
  });

  it('returns the drained responses array', async () => {
    const stored = [
      { sealed: { epk: 'E', env: envelope }, receivedAt: '2026-06-11T01:00:00.000Z' },
    ];
    const { fetch } = recordingFetch({ responses: stored });
    const client = createRelayHttpClient('https://relay.example.dev', 'drain-secret', fetch);
    expect(await client.drain('tok')).toEqual(stored);
  });

  it('throws on a non-OK relay response', async () => {
    const fetchFn = (async () => new Response('nope', { status: 500 })) as typeof fetch;
    const client = createRelayHttpClient('https://relay.example.dev', 'drain-secret', fetchFn);
    await expect(client.revoke('tok')).rejects.toThrow();
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { hashPin } from '../crypto';
import type { EncryptedEnvelopeData, RelayMailbox, SealedResponse } from '../schemas';
import {
  LOCKOUT_MS,
  MAX_PIN_ATTEMPTS,
  type RelayEnv,
  type RelayKv,
  drain,
  purge,
  putMailbox,
  putResult,
  respond,
  revoke,
  unlock,
  withdraw,
} from './relayMailbox';

/** An in-memory KV fake (Workers-KV-shaped) for the zero-knowledge mailbox tests. */
function memoryKv(): RelayKv & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
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
}

const dummyEnvelope: EncryptedEnvelopeData = {
  v: 1,
  alg: 'aes-256-gcm',
  iv: 'AAAA',
  tag: 'BBBB',
  data: 'CCCC',
};

const sealed: SealedResponse = { epk: 'EPK', env: dummyEnvelope };

async function makeMailbox(pin: string): Promise<RelayMailbox> {
  return {
    schemaVersion: 1,
    token: 'tok',
    sealedContent: dummyEnvelope,
    pinHash: await hashPin(pin),
    createdAt: '2026-06-11T00:00:00.000Z',
  };
}

// The PIN gate is deliberately expensive (salted scrypt, N=16384), and the lockout tests burn a full
// MAX_PIN_ATTEMPTS run of wrong guesses — several hundred ms of KDF each. That is comfortably under the
// 5s default in isolation but tips over when the suite runs in parallel with the rest of the package, so
// these were an intermittent pre-push/CI failure. Give the block real headroom rather than weakening the
// assertions or cheapening the KDF (the cost IS the brute-force protection being tested).
describe('relay mailbox', { timeout: 30_000 }, () => {
  let kv: RelayKv & { store: Map<string, string> };
  let clock: number;
  let env: RelayEnv;

  beforeEach(() => {
    kv = memoryKv();
    clock = 1_000_000;
    env = { kv, nowMs: () => clock, nowIso: () => '2026-06-11T02:00:00.000Z' };
  });

  it('stores a mailbox and releases sealed content only with the right PIN', async () => {
    await putMailbox(env, await makeMailbox('123456'));

    const wrong = await unlock(env, { token: 'tok', pin: '000000' });
    expect(wrong.status).toBe(401);
    expect((wrong.json as { attemptsRemaining: number }).attemptsRemaining).toBe(
      MAX_PIN_ATTEMPTS - 1,
    );

    const right = await unlock(env, { token: 'tok', pin: '123456' });
    expect(right.status).toBe(200);
    expect((right.json as { sealedContent: unknown }).sealedContent).toEqual(dummyEnvelope);
    expect((right.json as { submitted: boolean }).submitted).toBe(false);
  });

  it('locks out after 5 wrong attempts for 15 minutes', async () => {
    await putMailbox(env, await makeMailbox('123456'));
    for (let i = 0; i < MAX_PIN_ATTEMPTS; i += 1) {
      await unlock(env, { token: 'tok', pin: '000000' });
    }
    const locked = await unlock(env, { token: 'tok', pin: '123456' });
    expect(locked.status).toBe(429);
    expect((locked.json as { lockedUntil: number }).lockedUntil).toBe(clock + LOCKOUT_MS);

    // After the lockout window, the correct PIN works again.
    clock += LOCKOUT_MS + 1;
    const ok = await unlock(env, { token: 'tok', pin: '123456' });
    expect(ok.status).toBe(200);
  });

  it('counts wrong PINs across respond + withdraw toward the same lockout (no brute-force oracle)', async () => {
    await putMailbox(env, await makeMailbox('123456'));
    // Wrong guesses through respond + withdraw — NOT unlock — must still accumulate toward the lockout.
    for (let i = 0; i < MAX_PIN_ATTEMPTS - 1; i += 1) {
      await respond(env, { token: 'tok', pin: '000000', sealed });
    }
    expect((await withdraw(env, { token: 'tok', pin: '000000' })).status).toBe(429);
    // And the lockout is shared: unlock is now locked too, even with the right PIN.
    expect((await unlock(env, { token: 'tok', pin: '123456' })).status).toBe(429);
  });

  it('accepts one submission, gates further ones, and reports submitted on unlock', async () => {
    await putMailbox(env, await makeMailbox('123456'));

    const first = await respond(env, { token: 'tok', pin: '123456', sealed });
    expect(first.status).toBe(200);

    const again = await respond(env, { token: 'tok', pin: '123456', sealed });
    expect(again.status).toBe(409);

    const unlocked = await unlock(env, { token: 'tok', pin: '123456' });
    expect((unlocked.json as { submitted: boolean }).submitted).toBe(true);
  });

  it('rejects an oversized response and a wrong PIN on respond', async () => {
    await putMailbox(env, await makeMailbox('123456'));
    const big: SealedResponse = {
      epk: 'EPK',
      env: { ...dummyEnvelope, data: 'x'.repeat(300_000) },
    };
    expect((await respond(env, { token: 'tok', pin: '123456', sealed: big })).status).toBe(413);
    expect((await respond(env, { token: 'tok', pin: '000000', sealed })).status).toBe(401);
  });

  it('drains a response, purges it, and revoke removes the mailbox', async () => {
    await putMailbox(env, await makeMailbox('123456'));
    await respond(env, { token: 'tok', pin: '123456', sealed });

    const drained = await drain(env, { token: 'tok' });
    expect((drained.json as { responses: unknown[] }).responses).toHaveLength(1);

    // Drain is idempotent (does not delete) until the app confirms by purging.
    await purge(env, { token: 'tok' });
    expect((await drain(env, { token: 'tok' })).json).toEqual({ responses: [] });

    await revoke(env, { token: 'tok' });
    expect(kv.store.size).toBe(0);
    expect((await unlock(env, { token: 'tok', pin: '123456' })).status).toBe(404);
  });

  it('withdraw deletes a submitted response before drain', async () => {
    await putMailbox(env, await makeMailbox('123456'));
    await respond(env, { token: 'tok', pin: '123456', sealed });
    expect((await withdraw(env, { token: 'tok', pin: '123456' })).status).toBe(200);
    expect((await drain(env, { token: 'tok' })).json).toEqual({ responses: [] });
  });

  it('attaches a sealed outcome and releases it alongside content on a later unlock (§17.12-D)', async () => {
    await putMailbox(env, await makeMailbox('123456'));
    // Before any push, unlock carries no result.
    const before = await unlock(env, { token: 'tok', pin: '123456' });
    expect((before.json as { sealedResult?: unknown }).sealedResult).toBeUndefined();

    const resultEnvelope: EncryptedEnvelopeData = { ...dummyEnvelope, data: 'RESULT' };
    expect((await putResult(env, { token: 'tok', sealedResult: resultEnvelope })).status).toBe(200);

    const after = await unlock(env, { token: 'tok', pin: '123456' });
    expect((after.json as { sealedResult?: unknown }).sealedResult).toEqual(resultEnvelope);
    // The content + PIN gate are untouched by the patch.
    expect((after.json as { sealedContent: unknown }).sealedContent).toEqual(dummyEnvelope);
  });

  it('putResult validates its input and 404s a missing mailbox', async () => {
    // No mailbox yet.
    expect((await putResult(env, { token: 'tok', sealedResult: dummyEnvelope })).status).toBe(404);
    await putMailbox(env, await makeMailbox('123456'));
    expect((await putResult(env, { token: 'tok', sealedResult: { bad: true } })).status).toBe(400);
    expect((await putResult(env, { sealedResult: dummyEnvelope })).status).toBe(400);
  });

  it('treats an expired mailbox as unavailable', async () => {
    const mailbox = { ...(await makeMailbox('123456')), expiresAt: '2026-06-10T00:00:00.000Z' };
    await putMailbox(env, mailbox);
    expect((await unlock(env, { token: 'tok', pin: '123456' })).status).toBe(404);
  });
});

// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Encryptor } from '../secrets/encryptor';
import { createNodeSecretStore } from './nodeSecretStore';

// An inline fake — NOT imported from `secrets/encryptor`, whose `realEncryptor` pulls in `electron`
// (`safeStorage`). Unit tests run in CI without the Electron binary, so importing that module's runtime
// would crash; the `Encryptor` type import above is erased at build. (Matches the e2e's passthrough.)
const passthrough: Encryptor = {
  isAvailable: () => true,
  encrypt: (plain) => Buffer.from(plain, 'utf8').toString('base64'),
  decrypt: (ciphertext) => Buffer.from(ciphertext, 'base64').toString('utf8'),
};

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'selfos-secrets-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('createNodeSecretStore', () => {
  it('round-trips a secret', async () => {
    const store = createNodeSecretStore(dir, passthrough);
    await store.set('anthropic.apiKey', 'sk-ant-123');
    expect(await store.get('anthropic.apiKey')).toBe('sk-ant-123');
    expect(await store.has('anthropic.apiKey')).toBe(true);
  });

  it('returns null/false for unknown secrets', async () => {
    const store = createNodeSecretStore(dir, passthrough);
    expect(await store.get('nope')).toBeNull();
    expect(await store.has('nope')).toBe(false);
  });

  it('never writes the plaintext value to disk', async () => {
    const store = createNodeSecretStore(dir, passthrough);
    await store.set('anthropic.apiKey', 'super-secret-value');
    const raw = await readFile(join(dir, 'secrets.json'), 'utf8');
    expect(raw).not.toContain('super-secret-value');
  });

  it('clears a secret', async () => {
    const store = createNodeSecretStore(dir, passthrough);
    await store.set('anthropic.apiKey', 'v');
    await store.clear('anthropic.apiKey');
    expect(await store.has('anthropic.apiKey')).toBe(false);
  });
});

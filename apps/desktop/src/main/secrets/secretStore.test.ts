// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearSecret, getSecret, hasSecret, setSecret, type Encryptor } from './secretStore';

const encryptor: Encryptor = {
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

describe('secretStore', () => {
  it('round-trips a secret', async () => {
    await setSecret(dir, encryptor, 'anthropic.apiKey', 'sk-ant-123');
    expect(await getSecret(dir, encryptor, 'anthropic.apiKey')).toBe('sk-ant-123');
    expect(await hasSecret(dir, 'anthropic.apiKey')).toBe(true);
  });

  it('returns null/false for unknown secrets', async () => {
    expect(await getSecret(dir, encryptor, 'nope')).toBeNull();
    expect(await hasSecret(dir, 'nope')).toBe(false);
  });

  it('never writes the plaintext value to disk', async () => {
    await setSecret(dir, encryptor, 'anthropic.apiKey', 'super-secret-value');
    const raw = await readFile(join(dir, 'secrets.json'), 'utf8');
    expect(raw).not.toContain('super-secret-value');
  });

  it('clears a secret', async () => {
    await setSecret(dir, encryptor, 'anthropic.apiKey', 'v');
    await clearSecret(dir, 'anthropic.apiKey');
    expect(await hasSecret(dir, 'anthropic.apiKey')).toBe(false);
  });
});

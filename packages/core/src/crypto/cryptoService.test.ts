import { describe, expect, it } from 'vitest';
import { toBase64 } from '../encoding';
import {
  decrypt,
  decryptBytes,
  deriveKeyFromPhrase,
  encrypt,
  encryptBytes,
  generateMasterKey,
  generateRecoveryPhrase,
  randomBytes,
  unwrapKey,
  wrapKey,
} from './cryptoService';

const key = generateMasterKey();

describe('encrypt/decrypt', () => {
  it('round-trips utf-8 text', async () => {
    const env = await encrypt('a private journal entry 🌿', key);
    expect(env.alg).toBe('aes-256-gcm');
    expect(await decrypt(env, key)).toBe('a private journal entry 🌿');
  });

  it('produces a fresh IV each time (ciphertext differs)', async () => {
    expect((await encrypt('same', key)).data).not.toBe((await encrypt('same', key)).data);
  });

  it('fails to decrypt with the wrong key', async () => {
    const env = await encrypt('secret', key);
    await expect(decrypt(env, generateMasterKey())).rejects.toThrow();
  });

  it('fails to decrypt if the ciphertext is tampered with', async () => {
    const env = await encrypt('secret', key);
    await expect(
      decrypt({ ...env, data: toBase64(new TextEncoder().encode('tampered')) }, key),
    ).rejects.toThrow();
  });

  it('round-trips raw bytes (binary blobs like question images)', async () => {
    const bytes = randomBytes(2048);
    const env = await encryptBytes(bytes, key);
    const out = await decryptBytes(env, key);
    expect(Array.from(out)).toEqual(Array.from(bytes));
  });

  it('byte and text paths share one envelope (string encrypt decodes via decryptBytes)', async () => {
    const env = await encrypt('hello 🌿', key);
    expect(new TextDecoder().decode(await decryptBytes(env, key))).toBe('hello 🌿');
  });

  it('rejects tampered binary ciphertext', async () => {
    const env = await encryptBytes(randomBytes(64), key);
    await expect(decryptBytes({ ...env, tag: toBase64(randomBytes(16)) }, key)).rejects.toThrow();
  });
});

describe('recovery phrase', () => {
  it('generates a grouped code', () => {
    expect(generateRecoveryPhrase()).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{1,4})+$/);
  });

  it('derives the same key from the same phrase + salt, ignoring formatting', async () => {
    const salt = randomBytes(16);
    const a = await deriveKeyFromPhrase('a1b2-c3d4', salt);
    const b = await deriveKeyFromPhrase('A1B2C3D4', salt);
    expect(toBase64(a)).toBe(toBase64(b));
  });

  it('wraps and unwraps the master key with the recovery key', async () => {
    const salt = randomBytes(16);
    const phrase = generateRecoveryPhrase();
    const kek = await deriveKeyFromPhrase(phrase, salt);
    const wrapped = await wrapKey(key, kek);
    expect(toBase64(await unwrapKey(wrapped, kek))).toBe(toBase64(key));
  });

  it('cannot unwrap with the wrong phrase', async () => {
    const salt = randomBytes(16);
    const wrapped = await wrapKey(key, await deriveKeyFromPhrase(generateRecoveryPhrase(), salt));
    await expect(
      unwrapKey(wrapped, await deriveKeyFromPhrase(generateRecoveryPhrase(), salt)),
    ).rejects.toThrow();
  });
});

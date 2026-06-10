// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decrypt,
  deriveKeyFromPhrase,
  encrypt,
  generateMasterKey,
  generateRecoveryPhrase,
  unwrapKey,
  wrapKey,
} from './cryptoService';

const key = generateMasterKey();

describe('encrypt/decrypt', () => {
  it('round-trips utf-8 text', () => {
    const env = encrypt('a private journal entry 🌿', key);
    expect(env.alg).toBe('aes-256-gcm');
    expect(decrypt(env, key)).toBe('a private journal entry 🌿');
  });

  it('produces a fresh IV each time (ciphertext differs)', () => {
    expect(encrypt('same', key).data).not.toBe(encrypt('same', key).data);
  });

  it('fails to decrypt with the wrong key', () => {
    const env = encrypt('secret', key);
    expect(() => decrypt(env, generateMasterKey())).toThrow();
  });

  it('fails to decrypt if the ciphertext is tampered with', () => {
    const env = encrypt('secret', key);
    expect(() =>
      decrypt({ ...env, data: Buffer.from('tampered').toString('base64') }, key),
    ).toThrow();
  });
});

describe('recovery phrase', () => {
  it('generates a grouped code', () => {
    expect(generateRecoveryPhrase()).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{1,4})+$/);
  });

  it('derives the same key from the same phrase + salt, ignoring formatting', () => {
    const salt = randomBytes(16);
    const a = deriveKeyFromPhrase('a1b2-c3d4', salt);
    const b = deriveKeyFromPhrase('A1B2C3D4', salt);
    expect(a.equals(b)).toBe(true);
  });

  it('wraps and unwraps the master key with the recovery key', () => {
    const salt = randomBytes(16);
    const phrase = generateRecoveryPhrase();
    const kek = deriveKeyFromPhrase(phrase, salt);
    const wrapped = wrapKey(key, kek);
    expect(unwrapKey(wrapped, kek).equals(key)).toBe(true);
  });

  it('cannot unwrap with the wrong phrase', () => {
    const salt = randomBytes(16);
    const wrapped = wrapKey(key, deriveKeyFromPhrase(generateRecoveryPhrase(), salt));
    expect(() => unwrapKey(wrapped, deriveKeyFromPhrase(generateRecoveryPhrase(), salt))).toThrow();
  });
});

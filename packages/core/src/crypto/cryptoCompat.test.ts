// BYTE-COMPATIBILITY FIXTURES (07-mobile-platform §5.1 / §10).
//
// These constants were produced by the ORIGINAL `node:crypto` implementation of cryptoService/pin
// (AES-256-GCM via createCipheriv + scryptSync{N:16384,r:8,p:1}). They are frozen here so the new
// WebCrypto + scrypt-js implementation must decrypt / derive / verify them to the exact known values.
// If this test ever fails, the rewrite has broken on-disk compatibility and existing vaults would be
// unreadable. Do not regenerate these casually.
import { describe, expect, it } from 'vitest';
import { fromBase64, toBase64 } from '../encoding';
import {
  decrypt,
  deriveKeyFromPhrase,
  encrypt,
  type EncryptedEnvelope,
  unwrapKey,
} from './cryptoService';
import { verifyPin } from './pin';

// --- captured from the legacy node:crypto implementation ---
const AES = {
  keyB64: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
  plaintext: 'a private journal entry 🌿 with ünîcode',
  envelope: {
    v: 1,
    alg: 'aes-256-gcm',
    iv: 'tSqRdOzChiQxpNHa',
    tag: 'qZey1a/j3jT1OVUeLHN0jg==',
    data: 'SfDk9HndX0dzNmbCfbnh2UgvgK16MY+kNlPAyZ4F/Ry90WfAZi9y14pwLg==',
  } satisfies EncryptedEnvelope,
} as const;

const SCRYPT = {
  phrase: 'A1B2-C3D4-E5F6-G7H8',
  saltB64: 'MDAxMTIyMzM0NDU1NjY3Nw==',
  derivedKeyB64: 'MF/FzxuOnUbI4F/bO6EqTBG+MFPXAWJpr6ehgv6wK4k=',
} as const;

const WRAPPED = {
  masterKeyB64: 'ZmVlZGZhY2VmZWVkZmFjZWZlZWRmYWNlZmVlZGZhY2U=',
  phrase: 'A1B2-C3D4-E5F6-G7H8',
  saltB64: 'MDAxMTIyMzM0NDU1NjY3Nw==',
  wrapped: {
    v: 1,
    alg: 'aes-256-gcm',
    iv: '4fx//+wXCksuCF0q',
    tag: 'vMlB0JIA5zVPLx5wsqH88Q==',
    data: 'EF4aUP85wWSruuvbBwYI2LlPCKr8zc2Tl/5s/IAwu800xw5k5qo2eJw7xBE=',
  } satisfies EncryptedEnvelope,
} as const;

const PIN = {
  pin: '1357',
  hash: '+3WTklDMuX6EYf+r2io+lw==:zFHBpiB+dLMKJiqvCwW8RfSi7ykMZRKGiHGx38A3mXM=',
} as const;

describe('crypto byte-compat with the legacy node:crypto implementation', () => {
  it('decrypts a legacy AES-256-GCM envelope to the known plaintext', async () => {
    expect(await decrypt(AES.envelope, fromBase64(AES.keyB64))).toBe(AES.plaintext);
  });

  it('rejects a legacy envelope under the wrong key (auth tag still enforced)', async () => {
    await expect(decrypt(AES.envelope, new Uint8Array(32))).rejects.toThrow();
  });

  it('derives the identical scrypt key from the same phrase + salt', async () => {
    const derived = await deriveKeyFromPhrase(SCRYPT.phrase, fromBase64(SCRYPT.saltB64));
    expect(toBase64(derived)).toBe(SCRYPT.derivedKeyB64);
  });

  it('unwraps a legacy recovery bundle back to the original master key', async () => {
    const kek = await deriveKeyFromPhrase(WRAPPED.phrase, fromBase64(WRAPPED.saltB64));
    const masterKey = await unwrapKey(WRAPPED.wrapped, kek);
    expect(toBase64(masterKey)).toBe(WRAPPED.masterKeyB64);
  });

  it('verifies a legacy PIN hash (and rejects a wrong PIN)', async () => {
    expect(await verifyPin(PIN.pin, PIN.hash)).toBe(true);
    expect(await verifyPin('0000', PIN.hash)).toBe(false);
  });

  it('round-trips new ciphertext under the same legacy key', async () => {
    const key = fromBase64(AES.keyB64);
    const env = await encrypt(AES.plaintext, key);
    expect(await decrypt(env, key)).toBe(AES.plaintext);
  });
});

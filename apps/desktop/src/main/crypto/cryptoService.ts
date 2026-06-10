import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * Symmetric encryption for vault data at rest (04-people-roles §5). AES-256-GCM with a random IV per
 * write and a verified auth tag. Pure functions (the key is injected), so they are fully unit-testable
 * without Electron, the keychain, or the filesystem.
 */
export interface EncryptedEnvelope {
  v: 1;
  alg: 'aes-256-gcm';
  iv: string; // base64
  tag: string; // base64
  data: string; // base64
}

export function isEncryptedEnvelope(value: unknown): value is EncryptedEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { alg?: unknown }).alg === 'aes-256-gcm' &&
    typeof (value as { iv?: unknown }).iv === 'string' &&
    typeof (value as { tag?: unknown }).tag === 'string' &&
    typeof (value as { data?: unknown }).data === 'string'
  );
}

export function encrypt(plaintext: string, key: Buffer): EncryptedEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    v: 1,
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

export function decrypt(envelope: EncryptedEnvelope, key: Buffer): string {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

export function generateMasterKey(): Buffer {
  return randomBytes(32);
}

// Crockford base32 (no I, L, O, U) — readable, case-insensitive recovery codes.
const BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function base32(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** A grouped, ~104-bit recovery code, e.g. `A1B2-C3D4-E5F6-G7H8-J9K0-M`. Shown once at setup. */
export function generateRecoveryPhrase(): string {
  return (base32(randomBytes(13)).match(/.{1,4}/g) ?? []).join('-');
}

export function normalizeRecoveryPhrase(phrase: string): string {
  return phrase.replace(/[^a-z0-9]/gi, '').toUpperCase();
}

/** Derive a 256-bit key-encryption key from a recovery phrase + salt (scrypt). */
export function deriveKeyFromPhrase(phrase: string, salt: Buffer): Buffer {
  return scryptSync(normalizeRecoveryPhrase(phrase), salt, 32, { N: 16384, r: 8, p: 1 });
}

export function wrapKey(masterKey: Buffer, kek: Buffer): EncryptedEnvelope {
  return encrypt(masterKey.toString('base64'), kek);
}

export function unwrapKey(wrapped: EncryptedEnvelope, kek: Buffer): Buffer {
  return Buffer.from(decrypt(wrapped, kek), 'base64');
}

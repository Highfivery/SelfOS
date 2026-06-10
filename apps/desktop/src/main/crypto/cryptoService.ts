import { scrypt } from 'scrypt-js';

/**
 * Symmetric encryption for vault data at rest (04-people-roles §5). AES-256-GCM with a random IV per
 * write and a verified auth tag, derived keys via scrypt. Built on **WebCrypto** (`crypto.subtle`) +
 * `scrypt-js` so a single implementation runs on both Electron (Node ≥20) and the iOS WKWebView
 * (07-mobile-platform §5.1). The on-disk envelope and scrypt params are unchanged from the original
 * `node:crypto` implementation, so existing vaults stay byte-for-byte readable (see cryptoCompat.test).
 *
 * Keys/bytes are `Buffer` for now (a thin Uint8Array view); the Buffer→Uint8Array migration lands with
 * the `@selfos/core` extraction (07 slice ii). Pure functions (the key is injected), so they are fully
 * unit-testable without Electron, the keychain, or the filesystem.
 */
export interface EncryptedEnvelope {
  v: 1;
  alg: 'aes-256-gcm';
  iv: string; // base64
  tag: string; // base64
  data: string; // base64
}

// scrypt cost parameters — must match the original implementation so old ciphertext/keys still derive.
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const GCM_TAG_BYTES = 16; // 128-bit auth tag (WebCrypto's default + Node's getAuthTag length)

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

/** Cryptographically-random bytes (WebCrypto), returned as a Buffer for base64/keychain convenience. */
export function randomBytes(length: number): Buffer {
  return Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(length)));
}

function importAesKey(key: Buffer) {
  return globalThis.crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function encrypt(plaintext: string, key: Buffer): Promise<EncryptedEnvelope> {
  const iv = randomBytes(12);
  const cryptoKey = await importAesKey(key);
  // WebCrypto returns ciphertext with the 16-byte auth tag appended; split it to keep the {iv,tag,data}
  // envelope identical to the legacy node:crypto output.
  const sealed = Buffer.from(
    await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, tagLength: GCM_TAG_BYTES * 8 },
      cryptoKey,
      new TextEncoder().encode(plaintext),
    ),
  );
  const data = sealed.subarray(0, sealed.length - GCM_TAG_BYTES);
  const tag = sealed.subarray(sealed.length - GCM_TAG_BYTES);
  return {
    v: 1,
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: data.toString('base64'),
  };
}

export async function decrypt(envelope: EncryptedEnvelope, key: Buffer): Promise<string> {
  const iv = Buffer.from(envelope.iv, 'base64');
  // Re-join ciphertext + tag for WebCrypto, which expects them concatenated. Rejects on a bad key or a
  // tampered tag (OperationError) — preserving the throw-on-tamper contract.
  const sealed = Buffer.concat([
    Buffer.from(envelope.data, 'base64'),
    Buffer.from(envelope.tag, 'base64'),
  ]);
  const cryptoKey = await importAesKey(key);
  const plaintext = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: GCM_TAG_BYTES * 8 },
    cryptoKey,
    sealed,
  );
  return new TextDecoder().decode(plaintext);
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

/**
 * Derive `keyLength` bytes from a secret + salt via scrypt — the one KDF used for both recovery
 * key-encryption keys and PIN hashes. The params are frozen to match the legacy `node:crypto` output.
 */
export async function deriveScrypt(
  secret: string,
  salt: Buffer,
  keyLength: number,
): Promise<Buffer> {
  const password = new TextEncoder().encode(secret);
  return Buffer.from(await scrypt(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P, keyLength));
}

/** Derive a 256-bit key-encryption key from a recovery phrase + salt (scrypt). */
export async function deriveKeyFromPhrase(phrase: string, salt: Buffer): Promise<Buffer> {
  return deriveScrypt(normalizeRecoveryPhrase(phrase), salt, 32);
}

export async function wrapKey(masterKey: Buffer, kek: Buffer): Promise<EncryptedEnvelope> {
  return encrypt(masterKey.toString('base64'), kek);
}

export async function unwrapKey(wrapped: EncryptedEnvelope, kek: Buffer): Promise<Buffer> {
  return Buffer.from(await decrypt(wrapped, kek), 'base64');
}

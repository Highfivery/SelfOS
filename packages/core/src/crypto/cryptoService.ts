import { scrypt } from 'scrypt-js';
import { fromBase64, toBase64 } from '../encoding';

/**
 * Symmetric encryption for vault data at rest (04-people-roles §5). AES-256-GCM with a random IV per
 * write and a verified auth tag, derived keys via scrypt. Built on **WebCrypto** (`crypto.subtle`) +
 * `scrypt-js` + `Uint8Array`/portable base64 so a single implementation runs on both Electron
 * (Node ≥20) and the iOS WKWebView (07-mobile-platform §5.1) — no `node:crypto`, no `Buffer`. The
 * on-disk envelope and scrypt params are unchanged from the original implementation, so existing
 * vaults stay byte-for-byte readable (see cryptoCompat.test). Pure functions (the key is injected),
 * fully unit-testable without a host.
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

/** Cryptographically-random bytes (WebCrypto). */
export function randomBytes(length: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

/**
 * WebCrypto's `BufferSource` parameters require an `ArrayBuffer`-backed view, but TS 5.7 types a plain
 * `Uint8Array` as `Uint8Array<ArrayBufferLike>` (its buffer could be a `SharedArrayBuffer`). Copy into a
 * fresh `ArrayBuffer`-backed array so the `subtle.*` calls typecheck under **both** the host's node lib
 * and the iOS WebView's DOM lib (07-mobile-platform — `@selfos/core` runs in the WebView). The copy is
 * cheap (keys / IVs / small blobs) and byte-identical.
 */
function bufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

// Return type inferred, not annotated: `CryptoKey` is a global only under the DOM lib, but this source
// is also typechecked under the host's node-lib config (07 slice ii). `globalThis.crypto` exists in both.
function importAesKey(key: Uint8Array) {
  return globalThis.crypto.subtle.importKey('raw', bufferSource(key), { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function encrypt(plaintext: string, key: Uint8Array): Promise<EncryptedEnvelope> {
  const iv = randomBytes(12);
  const cryptoKey = await importAesKey(key);
  // WebCrypto returns ciphertext with the 16-byte auth tag appended; split it to keep the {iv,tag,data}
  // envelope identical to the legacy node:crypto output.
  const sealed = new Uint8Array(
    await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: bufferSource(iv), tagLength: GCM_TAG_BYTES * 8 },
      cryptoKey,
      bufferSource(new TextEncoder().encode(plaintext)),
    ),
  );
  const data = sealed.subarray(0, sealed.length - GCM_TAG_BYTES);
  const tag = sealed.subarray(sealed.length - GCM_TAG_BYTES);
  return {
    v: 1,
    alg: 'aes-256-gcm',
    iv: toBase64(iv),
    tag: toBase64(tag),
    data: toBase64(data),
  };
}

export async function decrypt(envelope: EncryptedEnvelope, key: Uint8Array): Promise<string> {
  const iv = fromBase64(envelope.iv);
  const data = fromBase64(envelope.data);
  const tag = fromBase64(envelope.tag);
  // Re-join ciphertext + tag for WebCrypto, which expects them concatenated. Rejects on a bad key or a
  // tampered tag (OperationError) — preserving the throw-on-tamper contract.
  const sealed = new Uint8Array(data.length + tag.length);
  sealed.set(data, 0);
  sealed.set(tag, data.length);
  const cryptoKey = await importAesKey(key);
  const plaintext = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bufferSource(iv), tagLength: GCM_TAG_BYTES * 8 },
    cryptoKey,
    bufferSource(sealed),
  );
  return new TextDecoder().decode(plaintext);
}

export function generateMasterKey(): Uint8Array {
  return randomBytes(32);
}

// Crockford base32 (no I, L, O, U) — readable, case-insensitive recovery codes.
const BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
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
  salt: Uint8Array,
  keyLength: number,
): Promise<Uint8Array> {
  const password = new TextEncoder().encode(secret);
  return scrypt(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P, keyLength);
}

/** Derive a 256-bit key-encryption key from a recovery phrase + salt (scrypt). */
export async function deriveKeyFromPhrase(phrase: string, salt: Uint8Array): Promise<Uint8Array> {
  return deriveScrypt(normalizeRecoveryPhrase(phrase), salt, 32);
}

export async function wrapKey(masterKey: Uint8Array, kek: Uint8Array): Promise<EncryptedEnvelope> {
  return encrypt(toBase64(masterKey), kek);
}

export async function unwrapKey(wrapped: EncryptedEnvelope, kek: Uint8Array): Promise<Uint8Array> {
  return fromBase64(await decrypt(wrapped, kek));
}

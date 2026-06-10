import { deriveScrypt, randomBytes } from '../crypto/cryptoService';

/**
 * Salted scrypt hash for PINs/passphrases (`salt:hash`, base64). Never store the plaintext. Shares the
 * `scrypt-js` + WebCrypto KDF in cryptoService (no `node:crypto`) so the same code runs on Electron and
 * the iOS WKWebView (07-mobile-platform §5.1); the params match the legacy node default scrypt so
 * existing hashes still verify (see cryptoCompat.test).
 */

/** Constant-time equality for two byte arrays (no `node:crypto.timingSafeEqual` on the webview). */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await deriveScrypt(pin, salt, 32);
  return `${salt.toString('base64')}:${hash.toString('base64')}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [saltB64, hashB64] = stored.split(':');
  if (!saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await deriveScrypt(pin, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(expected, actual);
}

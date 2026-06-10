import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** Salted scrypt hash for PINs/passphrases (`salt:hash`, base64). Never store the plaintext. */
export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, 32);
  return `${salt.toString('base64')}:${hash.toString('base64')}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  const [saltB64, hashB64] = stored.split(':');
  if (!saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = scryptSync(pin, Buffer.from(saltB64, 'base64'), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

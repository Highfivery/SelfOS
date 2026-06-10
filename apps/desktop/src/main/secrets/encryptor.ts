import { safeStorage } from 'electron';
import type { Encryptor } from './secretStore';

/** Real encryptor backed by the OS keychain via Electron `safeStorage`. */
export function realEncryptor(): Encryptor {
  return {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
    decrypt: (ciphertext) => safeStorage.decryptString(Buffer.from(ciphertext, 'base64')),
  };
}

/** Test/dev passthrough (base64 only, no real encryption) — used when SELFOS_FAKE_SECRETS is set. */
export function passthroughEncryptor(): Encryptor {
  return {
    isAvailable: () => true,
    encrypt: (plain) => Buffer.from(plain, 'utf8').toString('base64'),
    decrypt: (ciphertext) => Buffer.from(ciphertext, 'base64').toString('utf8'),
  };
}

export function defaultEncryptor(): Encryptor {
  return process.env['SELFOS_FAKE_SECRETS'] ? passthroughEncryptor() : realEncryptor();
}

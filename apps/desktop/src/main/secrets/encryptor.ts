import { safeStorage } from 'electron';

/**
 * Encrypts/decrypts secret strings for the device-local secret store. The real implementation wraps
 * Electron's `safeStorage` (OS keychain); tests inject a passthrough. This is an internal detail of the
 * Electron `SecretStore` host (07-mobile-platform §5.3) — the iOS host uses the Keychain directly and
 * needs no Encryptor. Secrets live device-local in `userData/secrets.json` and never enter the synced
 * vault or reach the renderer in plaintext (00-architecture §6.2).
 */
export interface Encryptor {
  isAvailable(): boolean;
  encrypt(plain: string): string; // → base64 ciphertext
  decrypt(ciphertext: string): string;
}

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

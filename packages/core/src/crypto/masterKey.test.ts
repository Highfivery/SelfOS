import { beforeEach, describe, expect, it } from 'vitest';
import type { SecretStore } from '../host';
import { memFileSystem } from '../host/memFileSystem';
import { toBase64 } from '../encoding';
import {
  MASTER_KEY_ID,
  createMasterKey,
  hasMasterKey,
  loadMasterKey,
  restoreFromRecoveryPhrase,
} from './masterKey';

/** In-memory SecretStore fake — stands in for the iOS Keychain / Electron safeStorage. */
function memSecretStore(): SecretStore {
  const map = new Map<string, string>();
  return {
    get: (id) => Promise.resolve(map.get(id) ?? null),
    set: (id, value) => {
      map.set(id, value);
      return Promise.resolve();
    },
    has: (id) => Promise.resolve(map.has(id)),
    clear: (id) => {
      map.delete(id);
      return Promise.resolve();
    },
  };
}

let fs: ReturnType<typeof memFileSystem>;
beforeEach(() => {
  fs = memFileSystem();
});

describe('masterKey', () => {
  it('creates and loads a master key', async () => {
    const secrets = memSecretStore();
    expect(await hasMasterKey(secrets)).toBe(false);
    await createMasterKey(secrets, fs);
    expect(await hasMasterKey(secrets)).toBe(true);
    expect((await loadMasterKey(secrets))?.length).toBe(32);
  });

  it('restores the same key from the recovery phrase after secret-store loss', async () => {
    const secrets = memSecretStore();
    const { recoveryPhrase } = await createMasterKey(secrets, fs);
    const original = await loadMasterKey(secrets);

    await secrets.clear(MASTER_KEY_ID); // simulate keychain loss / new device
    expect(await loadMasterKey(secrets)).toBeNull();

    expect(await restoreFromRecoveryPhrase(secrets, fs, recoveryPhrase)).toBe(true);
    const restored = await loadMasterKey(secrets);
    expect(restored && toBase64(restored)).toBe(original && toBase64(original));
  });

  it('rejects a wrong recovery phrase', async () => {
    const secrets = memSecretStore();
    await createMasterKey(secrets, fs);
    await secrets.clear(MASTER_KEY_ID);
    expect(await restoreFromRecoveryPhrase(secrets, fs, 'WRON-GPHR-ASE0-0000')).toBe(false);
    expect(await hasMasterKey(secrets)).toBe(false);
  });
});

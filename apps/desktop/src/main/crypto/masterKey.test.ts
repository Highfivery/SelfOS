// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SecretStore } from '@selfos/core/host';
import { createNodeFileSystem } from '../host/nodeFileSystem';
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

let vault: string;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'selfos-mk-vault-'));
});
afterEach(async () => {
  await rm(vault, { recursive: true, force: true });
});

describe('masterKey', () => {
  it('creates and loads a master key', async () => {
    const secrets = memSecretStore();
    const fs = createNodeFileSystem(vault);
    expect(await hasMasterKey(secrets)).toBe(false);
    await createMasterKey(secrets, fs);
    expect(await hasMasterKey(secrets)).toBe(true);
    expect((await loadMasterKey(secrets))?.length).toBe(32);
  });

  it('restores the same key from the recovery phrase after secret-store loss', async () => {
    const secrets = memSecretStore();
    const fs = createNodeFileSystem(vault);
    const { recoveryPhrase } = await createMasterKey(secrets, fs);
    const original = await loadMasterKey(secrets);

    await secrets.clear(MASTER_KEY_ID); // simulate keychain loss / new device
    expect(await loadMasterKey(secrets)).toBeNull();

    expect(await restoreFromRecoveryPhrase(secrets, fs, recoveryPhrase)).toBe(true);
    expect((await loadMasterKey(secrets))?.toString('base64')).toBe(original?.toString('base64'));
  });

  it('rejects a wrong recovery phrase', async () => {
    const secrets = memSecretStore();
    const fs = createNodeFileSystem(vault);
    await createMasterKey(secrets, fs);
    await secrets.clear(MASTER_KEY_ID);
    expect(await restoreFromRecoveryPhrase(secrets, fs, 'WRON-GPHR-ASE0-0000')).toBe(false);
    expect(await hasMasterKey(secrets)).toBe(false);
  });
});

// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearSecret, type Encryptor } from '../secrets/secretStore';
import {
  MASTER_KEY_ID,
  createMasterKey,
  hasMasterKey,
  loadMasterKey,
  restoreFromRecoveryPhrase,
} from './masterKey';

const encryptor: Encryptor = {
  isAvailable: () => true,
  encrypt: (plain) => Buffer.from(plain, 'utf8').toString('base64'),
  decrypt: (ciphertext) => Buffer.from(ciphertext, 'base64').toString('utf8'),
};

let ud: string;
let vault: string;
beforeEach(async () => {
  ud = await mkdtemp(join(tmpdir(), 'selfos-mk-ud-'));
  vault = await mkdtemp(join(tmpdir(), 'selfos-mk-vault-'));
});
afterEach(async () => {
  await rm(ud, { recursive: true, force: true });
  await rm(vault, { recursive: true, force: true });
});

describe('masterKey', () => {
  it('creates and loads a master key', async () => {
    expect(await hasMasterKey(ud, encryptor)).toBe(false);
    await createMasterKey(ud, encryptor, vault);
    expect(await hasMasterKey(ud, encryptor)).toBe(true);
    expect((await loadMasterKey(ud, encryptor))?.length).toBe(32);
  });

  it('restores the same key from the recovery phrase after keychain loss', async () => {
    const { recoveryPhrase } = await createMasterKey(ud, encryptor, vault);
    const original = await loadMasterKey(ud, encryptor);

    await clearSecret(ud, MASTER_KEY_ID); // simulate keychain loss / new device
    expect(await loadMasterKey(ud, encryptor)).toBeNull();

    expect(await restoreFromRecoveryPhrase(ud, encryptor, vault, recoveryPhrase)).toBe(true);
    expect((await loadMasterKey(ud, encryptor))?.equals(original!)).toBe(true);
  });

  it('rejects a wrong recovery phrase', async () => {
    await createMasterKey(ud, encryptor, vault);
    await clearSecret(ud, MASTER_KEY_ID);
    expect(await restoreFromRecoveryPhrase(ud, encryptor, vault, 'WRON-GPHR-ASE0-0000')).toBe(
      false,
    );
    expect(await hasMasterKey(ud, encryptor)).toBe(false);
  });
});

// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VaultMetaSchema } from '../../shared/schemas';
import { getVaultStatus, initializeVault, VAULT_LAYOUT } from './vault';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'selfos-vault-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('initializeVault', () => {
  it('creates the vault structure and valid meta', async () => {
    const meta = await initializeVault(dir);
    expect(() => VaultMetaSchema.parse(meta)).not.toThrow();

    const onDisk = JSON.parse(await readFile(join(dir, VAULT_LAYOUT.metaFile), 'utf8'));
    expect(onDisk.vaultId).toBe(meta.vaultId);
    const settings = JSON.parse(await readFile(join(dir, VAULT_LAYOUT.settingsFile), 'utf8'));
    expect(settings).toEqual({ schemaVersion: 1, values: {} });
  });

  it('is idempotent — re-running keeps the same vault id', async () => {
    const first = await initializeVault(dir);
    const second = await initializeVault(dir);
    expect(second.vaultId).toBe(first.vaultId);
  });
});

describe('getVaultStatus', () => {
  it('reports missing for a non-existent directory', async () => {
    const status = await getVaultStatus(join(dir, 'nope'));
    expect(status).toEqual({ ok: false, reason: 'missing' });
  });

  it('reports invalid for a directory without meta', async () => {
    const status = await getVaultStatus(dir);
    expect(status).toEqual({ ok: false, reason: 'invalid' });
  });

  it('reports ok with meta for an initialized vault', async () => {
    await initializeVault(dir);
    const status = await getVaultStatus(dir);
    expect(status.ok).toBe(true);
    if (status.ok) expect(status.meta.schemaVersion).toBe(1);
  });
});

// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computeBootState } from './boot';
import { initializeVault } from './vault/vault';
import { writeDeviceState } from './state/deviceStore';

let userData: string;
let vault: string;

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'selfos-ud-'));
  vault = await mkdtemp(join(tmpdir(), 'selfos-vault-'));
});
afterEach(async () => {
  await rm(userData, { recursive: true, force: true });
  await rm(vault, { recursive: true, force: true });
});

describe('computeBootState', () => {
  it('is onboarding when no vault is configured', async () => {
    expect(await computeBootState(userData)).toEqual({
      phase: 'onboarding',
      vaultPath: null,
      hasSettings: false,
    });
  });

  it('is vault-error when the configured vault is missing', async () => {
    await writeDeviceState(userData, { schemaVersion: 1, vaultPath: join(vault, 'gone') });
    const boot = await computeBootState(userData);
    expect(boot.phase).toBe('vault-error');
  });

  it('is ready when the configured vault is initialized', async () => {
    await initializeVault(vault);
    await writeDeviceState(userData, { schemaVersion: 1, vaultPath: vault });
    expect(await computeBootState(userData)).toEqual({
      phase: 'ready',
      vaultPath: vault,
      hasSettings: true,
    });
  });
});

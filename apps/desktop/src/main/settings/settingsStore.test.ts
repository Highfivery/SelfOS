// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readAllSettings, resetSettingValue, writeSettingValue } from './settingsStore';

let vault: string;
let userData: string;

beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'selfos-set-vault-'));
  userData = await mkdtemp(join(tmpdir(), 'selfos-set-ud-'));
});
afterEach(async () => {
  await rm(vault, { recursive: true, force: true });
  await rm(userData, { recursive: true, force: true });
});

describe('main settings store', () => {
  it('returns empty maps when nothing is persisted', async () => {
    expect(await readAllSettings(vault, userData)).toEqual({ vault: {}, device: {} });
  });

  it('writes and reads a vault-scoped value', async () => {
    await writeSettingValue('vault', 'appearance.theme', 'dark', vault, userData);
    const all = await readAllSettings(vault, userData);
    expect(all.vault['appearance.theme']).toBe('dark');
    expect(all.device).toEqual({});
  });

  it('keeps device-scoped values out of the synced vault', async () => {
    await writeSettingValue('device', 'window.x', 1, vault, userData);
    const all = await readAllSettings(vault, userData);
    expect(all.device['window.x']).toBe(1);
    expect(all.vault).toEqual({});
  });

  it('resets (removes) a value', async () => {
    await writeSettingValue('vault', 'a', 1, vault, userData);
    await resetSettingValue('vault', 'a', vault, userData);
    expect((await readAllSettings(vault, userData)).vault).toEqual({});
  });
});

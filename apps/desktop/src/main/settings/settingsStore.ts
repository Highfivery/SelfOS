import { join } from 'node:path';
import { SettingsFileSchema, type SettingsFile } from '../../shared/schemas';
import { pathExists, readJson, writeJsonAtomic } from '../vault/atomic';
import { migrate, type MigrationSet } from '../vault/migrations';
import { VAULT_LAYOUT } from '../vault/vault';

/** Migrations for settings files (none yet). */
export const SETTINGS_MIGRATIONS: MigrationSet = { latest: 1, steps: {} };

const EMPTY: SettingsFile = { schemaVersion: 1, values: {} };

/** Where vault-scoped vs device-scoped settings live. */
export function settingsPath(
  scope: 'vault' | 'device',
  vaultDir: string,
  userDataDir: string,
): string {
  return scope === 'vault'
    ? join(vaultDir, VAULT_LAYOUT.settingsFile)
    : join(userDataDir, 'device-settings.json');
}

async function readFile(path: string): Promise<SettingsFile> {
  if (!(await pathExists(path))) return { ...EMPTY };
  try {
    return SettingsFileSchema.parse(migrate(await readJson(path), SETTINGS_MIGRATIONS));
  } catch {
    return { ...EMPTY };
  }
}

/** Persisted values for both scopes (`{ vault, device }`), each a `key → value` map. */
export async function readAllSettings(
  vaultDir: string,
  userDataDir: string,
): Promise<{ vault: Record<string, unknown>; device: Record<string, unknown> }> {
  const [vault, device] = await Promise.all([
    readFile(settingsPath('vault', vaultDir, userDataDir)),
    readFile(settingsPath('device', vaultDir, userDataDir)),
  ]);
  return { vault: vault.values, device: device.values };
}

export async function writeSettingValue(
  scope: 'vault' | 'device',
  key: string,
  value: unknown,
  vaultDir: string,
  userDataDir: string,
): Promise<void> {
  const path = settingsPath(scope, vaultDir, userDataDir);
  const file = await readFile(path);
  await writeJsonAtomic(path, { ...file, values: { ...file.values, [key]: value } });
}

export async function resetSettingValue(
  scope: 'vault' | 'device',
  key: string,
  vaultDir: string,
  userDataDir: string,
): Promise<void> {
  const path = settingsPath(scope, vaultDir, userDataDir);
  const file = await readFile(path);
  const next = { ...file.values };
  delete next[key];
  await writeJsonAtomic(path, { ...file, values: next });
}

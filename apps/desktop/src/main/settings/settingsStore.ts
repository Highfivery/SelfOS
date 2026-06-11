import { join } from 'node:path';
import { SettingsFileSchema, type SettingsFile } from '../../shared/schemas';
import { pathExists, readJson, writeJsonAtomic } from '../vault/atomic';
import { migrate, type MigrationSet } from '../vault/migrations';

/** Migrations for settings files (none yet). */
export const SETTINGS_MIGRATIONS: MigrationSet = { latest: 1, steps: {} };

const EMPTY: SettingsFile = { schemaVersion: 1, values: {} };

/**
 * Device-scoped settings persistence for the Electron host (the `BridgeHost.readDeviceSettings` /
 * `writeDeviceSettings` seam). Device settings live device-local in `userData/device-settings.json`,
 * never synced into the vault. Vault-scoped settings are handled by the shared `createCoreBridge`
 * factory over the `FileSystem` host (07-mobile-platform §5.3) so the logic runs on iOS too.
 */
function deviceSettingsPath(userDataDir: string): string {
  return join(userDataDir, 'device-settings.json');
}

async function readFile(path: string): Promise<SettingsFile> {
  if (!(await pathExists(path))) return { ...EMPTY };
  try {
    return SettingsFileSchema.parse(migrate(await readJson(path), SETTINGS_MIGRATIONS));
  } catch {
    return { ...EMPTY };
  }
}

/** The device-scoped settings `key → value` map. */
export async function readDeviceSettings(userDataDir: string): Promise<Record<string, unknown>> {
  return (await readFile(deviceSettingsPath(userDataDir))).values;
}

/** Persist the full device-scoped settings `key → value` map. */
export async function writeDeviceSettings(
  userDataDir: string,
  values: Record<string, unknown>,
): Promise<void> {
  await writeJsonAtomic(deviceSettingsPath(userDataDir), { ...EMPTY, values });
}

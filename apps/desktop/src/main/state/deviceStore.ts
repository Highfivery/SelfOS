import { join } from 'node:path';
import { DeviceStateSchema, type DeviceState } from '../../shared/schemas';
import { pathExists, readJson, writeJsonAtomic } from '../vault/atomic';
import { migrate, type MigrationSet } from '../vault/migrations';

const CURRENT_VERSION = 1;
const DEFAULT_STATE: DeviceState = { schemaVersion: CURRENT_VERSION, vaultPath: null };

/** Migrations for device-local `state.json` (none yet). */
export const DEVICE_STATE_MIGRATIONS: MigrationSet = { latest: CURRENT_VERSION, steps: {} };

export function deviceStatePath(userDataDir: string): string {
  return join(userDataDir, 'state.json');
}

/** Read device-local state, falling back to defaults on a missing or corrupt file. */
export async function readDeviceState(userDataDir: string): Promise<DeviceState> {
  const file = deviceStatePath(userDataDir);
  if (!(await pathExists(file))) return { ...DEFAULT_STATE };
  try {
    return DeviceStateSchema.parse(migrate(await readJson(file), DEVICE_STATE_MIGRATIONS));
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export async function writeDeviceState(userDataDir: string, state: DeviceState): Promise<void> {
  await writeJsonAtomic(deviceStatePath(userDataDir), DeviceStateSchema.parse(state));
}

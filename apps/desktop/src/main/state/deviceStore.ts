import { join } from 'node:path';
import { DeviceStateSchema, type DeviceState } from '../../shared/schemas';
import { pathExists, readJson, writeJsonAtomic } from '../vault/atomic';

const DEFAULT_STATE: DeviceState = { schemaVersion: 1, vaultPath: null };

export function deviceStatePath(userDataDir: string): string {
  return join(userDataDir, 'state.json');
}

/** Read device-local state, falling back to defaults on a missing or corrupt file. */
export async function readDeviceState(userDataDir: string): Promise<DeviceState> {
  const file = deviceStatePath(userDataDir);
  if (!(await pathExists(file))) return { ...DEFAULT_STATE };
  try {
    return DeviceStateSchema.parse(await readJson(file));
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export async function writeDeviceState(userDataDir: string, state: DeviceState): Promise<void> {
  await writeJsonAtomic(deviceStatePath(userDataDir), DeviceStateSchema.parse(state));
}

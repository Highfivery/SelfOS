import { join } from 'node:path';
import { type BootState } from '../shared/schemas';
import { pathExists } from './vault/atomic';
import { getVaultStatus, VAULT_LAYOUT } from './vault/vault';
import { readDeviceState } from './state/deviceStore';

/**
 * Compute the boot state from device-local state + vault status (02-app-shell §3.1). Pure aside from
 * the filesystem reads, so it is unit-testable against temp directories.
 */
export async function computeBootState(userDataDir: string): Promise<BootState> {
  const device = await readDeviceState(userDataDir);

  if (!device.vaultPath) {
    return { phase: 'onboarding', vaultPath: null, hasSettings: false };
  }

  const status = await getVaultStatus(device.vaultPath);
  if (!status.ok) {
    return { phase: 'vault-error', vaultPath: device.vaultPath, hasSettings: false };
  }

  const hasSettings = await pathExists(join(device.vaultPath, VAULT_LAYOUT.settingsFile));
  return { phase: 'ready', vaultPath: device.vaultPath, hasSettings };
}

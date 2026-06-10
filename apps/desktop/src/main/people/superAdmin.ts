import { readDeviceState, updateDeviceState } from '../state/deviceStore';
import { hashPin, verifyPin } from './pin';

/**
 * The concealed super-admin passphrase (04-people-roles §8). Stored device-local as a salted hash;
 * the unlock/inspect UI is a later slice — here we only set and verify it.
 */
export async function setSuperAdminPassphrase(
  userDataDir: string,
  passphrase: string,
): Promise<void> {
  await updateDeviceState(userDataDir, { superAdminPassphraseHash: hashPin(passphrase) });
}

export async function hasSuperAdminPassphrase(userDataDir: string): Promise<boolean> {
  return (await readDeviceState(userDataDir)).superAdminPassphraseHash !== undefined;
}

export async function verifySuperAdminPassphrase(
  userDataDir: string,
  passphrase: string,
): Promise<boolean> {
  const hash = (await readDeviceState(userDataDir)).superAdminPassphraseHash;
  return hash !== undefined && verifyPin(passphrase, hash);
}

/**
 * In-memory "inspect everything" state for the current session (04-people-roles §8). Main is the
 * source of truth so that capability gating in IPC handlers honors super-admin mode — the renderer
 * flag alone is not trusted. Cleared on lock and never persisted.
 */
let inspectModeActive = false;

export function setSuperAdminActive(active: boolean): void {
  inspectModeActive = active;
}

export function isSuperAdminActive(): boolean {
  return inspectModeActive;
}

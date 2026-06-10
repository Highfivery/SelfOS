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

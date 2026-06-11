import type { FileSystem } from '@selfos/core/host';
import {
  hasSuperAdminPassphrase as hasVaultSuperAdmin,
  setSuperAdminPassphrase as setVaultSuperAdmin,
  storeSuperAdminHash,
  verifySuperAdminPassphrase as verifyVaultSuperAdmin,
} from '@selfos/core/people';
import { readDeviceState } from '../state/deviceStore';

/**
 * The concealed super-admin passphrase now lives in the vault (10-multi-device-vault §5.2), so it's one
 * household-wide secret. This app module is a thin host wrapper: it threads the vault `FileSystem` + key
 * into the core functions, owns the device-local → vault migration, and keeps the in-memory inspect-mode
 * flag (a device-session concern, never persisted).
 */

/** Persist the super-admin passphrase into the vault. */
export async function setSuperAdminPassphrase(
  fs: FileSystem,
  key: Uint8Array,
  passphrase: string,
): Promise<void> {
  await setVaultSuperAdmin(fs, key, passphrase);
}

/**
 * Verify the super-admin passphrase against the vault copy, first migrating a legacy device-local hash
 * into the vault if this vault has none yet (§6.4). One-time and idempotent.
 */
export async function verifySuperAdminPassphrase(
  fs: FileSystem,
  key: Uint8Array,
  userDataDir: string,
  passphrase: string,
): Promise<boolean> {
  await migrateLegacySuperAdmin(fs, key, userDataDir);
  return verifyVaultSuperAdmin(fs, key, passphrase);
}

/** Seed `config/superadmin.enc` from the legacy device-local hash if the vault has none (§6.4). */
async function migrateLegacySuperAdmin(
  fs: FileSystem,
  key: Uint8Array,
  userDataDir: string,
): Promise<void> {
  if (await hasVaultSuperAdmin(fs)) return;
  const legacy = (await readDeviceState(userDataDir)).superAdminPassphraseHash;
  if (legacy) await storeSuperAdminHash(fs, key, legacy);
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

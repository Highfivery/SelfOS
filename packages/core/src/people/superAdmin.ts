import { z } from 'zod';
import type { FileSystem } from '../host';
import { hashPin, verifyPin } from '../crypto';
import { readEncryptedJson, writeEncryptedJson } from '../vault';

/**
 * The concealed super-admin passphrase, stored **in the vault** (10-multi-device-vault §4.1): a salted
 * scrypt hash, encrypted under the master key, so it's one household-wide secret recognized on every
 * device rather than a per-device one. It is only verifiable after the vault is unlocked (the key is
 * loaded) — by which point the super-admin "inspect everything" reveal is the only thing it gates.
 */
const SUPERADMIN_PATH = 'config/superadmin.enc';

export const SuperAdminFileSchema = z.object({
  schemaVersion: z.literal(1),
  passphraseHash: z.string(),
});
export type SuperAdminFile = z.infer<typeof SuperAdminFileSchema>;

async function readSuperAdminFile(fs: FileSystem, key: Uint8Array): Promise<SuperAdminFile | null> {
  const raw = await readEncryptedJson(fs, SUPERADMIN_PATH, key);
  return raw === null ? null : SuperAdminFileSchema.parse(raw);
}

/** Persist a new super-admin passphrase (hashed) into the vault. */
export async function setSuperAdminPassphrase(
  fs: FileSystem,
  key: Uint8Array,
  passphrase: string,
): Promise<void> {
  await storeSuperAdminHash(fs, key, await hashPin(passphrase));
}

/** Persist an already-computed hash — used by the device-local → vault migration (§6.4). */
export async function storeSuperAdminHash(
  fs: FileSystem,
  key: Uint8Array,
  passphraseHash: string,
): Promise<void> {
  const file: SuperAdminFile = { schemaVersion: 1, passphraseHash };
  await writeEncryptedJson(fs, SUPERADMIN_PATH, file, key);
}

/**
 * Whether a super-admin passphrase is set for this vault. Presence-based (does `config/superadmin.enc`
 * exist?), like the recovery.enc marker — so a present-but-corrupt file still counts as "set" and the
 * migration (§6.4) never clobbers it by mistaking corrupt for absent.
 */
export async function hasSuperAdminPassphrase(fs: FileSystem): Promise<boolean> {
  return (await fs.read(SUPERADMIN_PATH)) !== null;
}

/**
 * Verify the super-admin passphrase against the vault copy (constant-time, via verifyPin). Returns
 * false — never throws — for absent, corrupt, or wrong-key files, so the concealed unlock stays a
 * deliberately-generic "didn't match" rather than surfacing an exception.
 */
export async function verifySuperAdminPassphrase(
  fs: FileSystem,
  key: Uint8Array,
  passphrase: string,
): Promise<boolean> {
  try {
    const file = await readSuperAdminFile(fs, key);
    return file !== null && (await verifyPin(passphrase, file.passphraseHash));
  } catch {
    return false;
  }
}

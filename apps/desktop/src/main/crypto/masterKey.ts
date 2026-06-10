import {
  deriveKeyFromPhrase,
  generateMasterKey,
  generateRecoveryPhrase,
  randomBytes,
  unwrapKey,
  wrapKey,
} from '@selfos/core/crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { getSecret, setSecret, type Encryptor } from '../secrets/secretStore';
import { pathExists, readJson, writeJsonAtomic } from '../vault/atomic';

export const MASTER_KEY_ID = 'selfos.masterKey';

const EnvelopeSchema = z.object({
  v: z.literal(1),
  alg: z.literal('aes-256-gcm'),
  iv: z.string(),
  tag: z.string(),
  data: z.string(),
});

const RecoveryBundleSchema = z.object({
  schemaVersion: z.number().int().positive(),
  salt: z.string(), // base64
  wrapped: EnvelopeSchema,
});

function recoveryPath(vaultDir: string): string {
  return join(vaultDir, 'config', 'recovery.enc');
}

export async function loadMasterKey(
  userDataDir: string,
  encryptor: Encryptor,
): Promise<Buffer | null> {
  const base64 = await getSecret(userDataDir, encryptor, MASTER_KEY_ID);
  return base64 ? Buffer.from(base64, 'base64') : null;
}

export async function hasMasterKey(userDataDir: string, encryptor: Encryptor): Promise<boolean> {
  return (await loadMasterKey(userDataDir, encryptor)) !== null;
}

async function storeMasterKey(
  userDataDir: string,
  encryptor: Encryptor,
  key: Buffer,
): Promise<void> {
  await setSecret(userDataDir, encryptor, MASTER_KEY_ID, key.toString('base64'));
}

/**
 * Generate the master key, store it in the keychain, write the recovery bundle to the vault, and
 * return the recovery phrase (to be shown to the user exactly once).
 */
export async function createMasterKey(
  userDataDir: string,
  encryptor: Encryptor,
  vaultDir: string,
): Promise<{ recoveryPhrase: string }> {
  // Core returns Uint8Array; the app keeps threading Buffer, so bridge at this boundary (07 slice ii).
  const masterKey = Buffer.from(generateMasterKey());
  await storeMasterKey(userDataDir, encryptor, masterKey);

  const recoveryPhrase = generateRecoveryPhrase();
  const salt = Buffer.from(randomBytes(16));
  const wrapped = await wrapKey(masterKey, await deriveKeyFromPhrase(recoveryPhrase, salt));
  await writeJsonAtomic(recoveryPath(vaultDir), {
    schemaVersion: 1,
    salt: salt.toString('base64'),
    wrapped,
  });

  return { recoveryPhrase };
}

/** Restore the master key into the keychain from the recovery phrase. Returns false on a bad phrase. */
export async function restoreFromRecoveryPhrase(
  userDataDir: string,
  encryptor: Encryptor,
  vaultDir: string,
  phrase: string,
): Promise<boolean> {
  const path = recoveryPath(vaultDir);
  if (!(await pathExists(path))) return false;
  try {
    const bundle = RecoveryBundleSchema.parse(await readJson(path));
    const kek = await deriveKeyFromPhrase(phrase, Buffer.from(bundle.salt, 'base64'));
    const masterKey = Buffer.from(await unwrapKey(bundle.wrapped, kek));
    await storeMasterKey(userDataDir, encryptor, masterKey);
    return true;
  } catch {
    return false;
  }
}

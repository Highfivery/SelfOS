import { z } from 'zod';
import type { FileSystem, SecretStore } from '../host';
import { fromBase64, toBase64 } from '../encoding';
import {
  deriveKeyFromPhrase,
  generateMasterKey,
  generateRecoveryPhrase,
  randomBytes,
  unwrapKey,
  wrapKey,
} from './cryptoService';

export const MASTER_KEY_ID = 'selfos.masterKey';

// Plain (un-encrypted) recovery bundle in the vault: the master key wrapped by a recovery-phrase KEK.
const RECOVERY_PATH = 'config/recovery.enc';

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

export async function loadMasterKey(secrets: SecretStore): Promise<Uint8Array | null> {
  const base64 = await secrets.get(MASTER_KEY_ID);
  return base64 ? fromBase64(base64) : null;
}

export async function hasMasterKey(secrets: SecretStore): Promise<boolean> {
  return (await loadMasterKey(secrets)) !== null;
}

async function storeMasterKey(secrets: SecretStore, key: Uint8Array): Promise<void> {
  await secrets.set(MASTER_KEY_ID, toBase64(key));
}

/**
 * Generate the master key, store it in the secret store, write the recovery bundle to the vault, and
 * return the recovery phrase (to be shown to the user exactly once).
 */
export async function createMasterKey(
  secrets: SecretStore,
  fs: FileSystem,
): Promise<{ recoveryPhrase: string }> {
  const masterKey = generateMasterKey();
  await storeMasterKey(secrets, masterKey);

  const recoveryPhrase = generateRecoveryPhrase();
  const salt = randomBytes(16);
  const wrapped = await wrapKey(masterKey, await deriveKeyFromPhrase(recoveryPhrase, salt));
  const bundle = { schemaVersion: 1, salt: toBase64(salt), wrapped };
  await fs.writeAtomic(
    RECOVERY_PATH,
    new TextEncoder().encode(`${JSON.stringify(bundle, null, 2)}\n`),
  );

  return { recoveryPhrase };
}

/** Restore the master key into the secret store from the recovery phrase. Returns false on a bad phrase. */
export async function restoreFromRecoveryPhrase(
  secrets: SecretStore,
  fs: FileSystem,
  phrase: string,
): Promise<boolean> {
  const bytes = await fs.read(RECOVERY_PATH);
  if (bytes === null) return false;
  try {
    const bundle = RecoveryBundleSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
    const kek = await deriveKeyFromPhrase(phrase, fromBase64(bundle.salt));
    const masterKey = await unwrapKey(bundle.wrapped, kek);
    await storeMasterKey(secrets, masterKey);
    return true;
  } catch {
    return false;
  }
}

import { join } from 'node:path';
import { z } from 'zod';
import type { SecretStore } from '@selfos/core/host';
import { pathExists, readJson, writeJsonAtomic } from '../vault/atomic';
import type { Encryptor } from '../secrets/encryptor';

/**
 * The Electron `SecretStore` host (07-mobile-platform §5.3): secrets live device-local in
 * `userData/secrets.json`, each value encrypted by the injected `Encryptor` (`safeStorage`). Never
 * synced into the vault, never returned to the renderer in plaintext (00-architecture §6.2).
 */
const SecretsFileSchema = z.object({
  schemaVersion: z.number().int().positive(),
  secrets: z.record(z.string(), z.string()),
});
type SecretsFile = z.infer<typeof SecretsFileSchema>;

const EMPTY: SecretsFile = { schemaVersion: 1, secrets: {} };

export function createNodeSecretStore(userDataDir: string, encryptor: Encryptor): SecretStore {
  const path = join(userDataDir, 'secrets.json');

  const readSecrets = async (): Promise<SecretsFile> => {
    if (!(await pathExists(path))) return { schemaVersion: 1, secrets: {} };
    try {
      return SecretsFileSchema.parse(await readJson(path));
    } catch {
      return { schemaVersion: 1, secrets: {} };
    }
  };

  return {
    async get(id) {
      const ciphertext = (await readSecrets()).secrets[id];
      if (ciphertext === undefined) return null;
      try {
        return encryptor.decrypt(ciphertext);
      } catch {
        return null;
      }
    },
    async set(id, value) {
      const file = await readSecrets();
      await writeJsonAtomic(path, {
        ...file,
        secrets: { ...file.secrets, [id]: encryptor.encrypt(value) },
      });
    },
    async has(id) {
      return (await readSecrets()).secrets[id] !== undefined;
    },
    async clear(id) {
      const file = await readSecrets();
      if (file.secrets[id] === undefined) return;
      const next = { ...file.secrets };
      delete next[id];
      await writeJsonAtomic(path, { ...EMPTY, ...file, secrets: next });
    },
  };
}

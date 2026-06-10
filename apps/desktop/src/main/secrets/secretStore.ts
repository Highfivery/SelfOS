import { join } from 'node:path';
import { z } from 'zod';
import { pathExists, readJson, writeJsonAtomic } from '../vault/atomic';

/**
 * Encrypts/decrypts secrets. The real implementation wraps Electron's `safeStorage` (OS keychain);
 * tests inject a passthrough. Secrets live device-local in `userData/secrets.json` and never enter
 * the synced vault or reach the renderer in plaintext (00-architecture §6.2).
 */
export interface Encryptor {
  isAvailable(): boolean;
  encrypt(plain: string): string; // → base64 ciphertext
  decrypt(ciphertext: string): string;
}

const SecretsFileSchema = z.object({
  schemaVersion: z.number().int().positive(),
  secrets: z.record(z.string(), z.string()),
});
type SecretsFile = z.infer<typeof SecretsFileSchema>;

const EMPTY: SecretsFile = { schemaVersion: 1, secrets: {} };

function secretsPath(userDataDir: string): string {
  return join(userDataDir, 'secrets.json');
}

async function readFile(userDataDir: string): Promise<SecretsFile> {
  const path = secretsPath(userDataDir);
  if (!(await pathExists(path))) return { schemaVersion: 1, secrets: {} };
  try {
    return SecretsFileSchema.parse(await readJson(path));
  } catch {
    return { schemaVersion: 1, secrets: {} };
  }
}

export async function setSecret(
  userDataDir: string,
  encryptor: Encryptor,
  id: string,
  value: string,
): Promise<void> {
  const file = await readFile(userDataDir);
  await writeJsonAtomic(secretsPath(userDataDir), {
    ...file,
    secrets: { ...file.secrets, [id]: encryptor.encrypt(value) },
  });
}

/** Decrypt a stored secret (main-process only — never exposed to the renderer). */
export async function getSecret(
  userDataDir: string,
  encryptor: Encryptor,
  id: string,
): Promise<string | null> {
  const ciphertext = (await readFile(userDataDir)).secrets[id];
  if (ciphertext === undefined) return null;
  try {
    return encryptor.decrypt(ciphertext);
  } catch {
    return null;
  }
}

export async function hasSecret(userDataDir: string, id: string): Promise<boolean> {
  return (await readFile(userDataDir)).secrets[id] !== undefined;
}

export async function clearSecret(userDataDir: string, id: string): Promise<void> {
  const file = await readFile(userDataDir);
  if (file.secrets[id] === undefined) return;
  const next = { ...file.secrets };
  delete next[id];
  await writeJsonAtomic(secretsPath(userDataDir), { ...EMPTY, ...file, secrets: next });
}

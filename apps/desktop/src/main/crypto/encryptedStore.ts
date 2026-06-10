import { decrypt, encrypt, isEncryptedEnvelope } from '@selfos/core/crypto';
import { pathExists, readJson, writeJsonAtomic } from '../vault/atomic';

/** Write `data` as an encrypted `*.enc` file (JSON → ciphertext envelope → atomic write). */
export async function writeEncryptedJson(path: string, data: unknown, key: Buffer): Promise<void> {
  await writeJsonAtomic(path, await encrypt(JSON.stringify(data), key));
}

/** Read and decrypt an encrypted `*.enc` file. Returns null if the file is absent. */
export async function readEncryptedJson(path: string, key: Buffer): Promise<unknown> {
  if (!(await pathExists(path))) return null;
  const envelope = await readJson(path);
  if (!isEncryptedEnvelope(envelope)) {
    throw new Error(`Not an encrypted SelfOS file: ${path}`);
  }
  return JSON.parse(await decrypt(envelope, key));
}

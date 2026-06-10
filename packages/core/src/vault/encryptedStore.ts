import { decrypt, encrypt, isEncryptedEnvelope } from '../crypto';
import type { FileSystem } from '../host';

/** Write `data` as an encrypted `*.enc` file (JSON → ciphertext envelope → atomic write via the host). */
export async function writeEncryptedJson(
  fs: FileSystem,
  path: string,
  data: unknown,
  key: Uint8Array,
): Promise<void> {
  const envelope = await encrypt(JSON.stringify(data), key);
  await fs.writeAtomic(path, new TextEncoder().encode(`${JSON.stringify(envelope, null, 2)}\n`));
}

/** Read and decrypt an encrypted `*.enc` file. Returns null if the file is absent. */
export async function readEncryptedJson(
  fs: FileSystem,
  path: string,
  key: Uint8Array,
): Promise<unknown> {
  const bytes = await fs.read(path);
  if (bytes === null) return null;
  const envelope = JSON.parse(new TextDecoder().decode(bytes));
  if (!isEncryptedEnvelope(envelope)) {
    throw new Error(`Not an encrypted SelfOS file: ${path}`);
  }
  return JSON.parse(await decrypt(envelope, key));
}

import { decryptBytes, encryptBytes, isEncryptedEnvelope } from '../crypto';
import type { FileSystem } from '../host';
import { uuid } from '../id';
import { imagePath, isMediaPath } from './paths';

/**
 * Author-attached **question images** (08-questionnaires §4.2 / §13.2). Images are stored encrypted
 * under the master key in a shared media dir (`questionnaires/media/<id>.enc`), decoupled from any one
 * questionnaire's lifecycle so they can be attached before a new draft is saved. The relay's
 * zero-knowledge re-encryption to a per-send key (§8.6) lands with the relay slice (§13.6).
 */

/** Raster formats we accept (kept small to bound the relay's zero-knowledge surface). */
export const ALLOWED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // ~5 MB

export function isAllowedImageMime(mime: string): boolean {
  return (ALLOWED_IMAGE_MIME as readonly string[]).includes(mime);
}

/** Encrypt + store image bytes; returns the vault-relative path to set on `Question.media.imagePath`. */
export async function storeQuestionnaireImage(
  fs: FileSystem,
  key: Uint8Array,
  bytes: Uint8Array,
): Promise<string> {
  const path = imagePath(uuid());
  const envelope = await encryptBytes(bytes, key);
  await fs.writeAtomic(path, new TextEncoder().encode(JSON.stringify(envelope)));
  return path;
}

/** Read + decrypt an image; null if the path is out of bounds, absent, or unreadable. */
export async function getQuestionnaireImage(
  fs: FileSystem,
  key: Uint8Array,
  path: string,
): Promise<Uint8Array | null> {
  if (!isMediaPath(path)) return null; // never read outside the media dir, even if the caller asks
  const raw = await fs.read(path);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(raw));
    if (!isEncryptedEnvelope(parsed)) return null;
    return await decryptBytes(parsed, key);
  } catch {
    return null;
  }
}

/** Delete a stored image (a no-op for any path outside the media dir). */
export async function deleteQuestionnaireImage(fs: FileSystem, path: string): Promise<void> {
  if (!isMediaPath(path)) return;
  await fs.remove(path);
}

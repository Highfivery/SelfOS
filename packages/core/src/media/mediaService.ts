import { decryptBytes, encryptBytes, isEncryptedEnvelope } from '../crypto';
import type { FileSystem } from '../host';
import { uuid } from '../id';

/**
 * @selfos/core/media — generic encrypted-media storage (45-session-attachments §4.3/§5.1).
 *
 * A single, testable seam for storing binary blobs (images today) ENCRYPTED under the master key, under
 * a vault directory the CALLER owns. It generalizes the 08-questionnaires §13.2 `imageService` so any
 * feature (Sessions now; Dreams/journal later) shares ONE implementation — store → `<dir>/<uuid>.enc`,
 * read+decrypt behind a caller-supplied path GUARD, delete behind the same guard.
 *
 * There is NO new crypto and NO new envelope: bytes are sealed with the proven `encryptBytes` envelope
 * (the same `{v,alg,iv,tag,data}` JSON written for question images), so existing vaults stay byte-compatible.
 *
 * This spec surfaces it only in Sessions; migrating the questionnaire/dream image services onto it is a
 * later behaviour-preserving refactor (§2 non-goal), so the shared constants are duplicated here as the
 * canonical home until that migration lands.
 */

/** Raster formats we accept (mirrors 08-questionnaires §13.2 `ALLOWED_IMAGE_MIME`). */
export const ALLOWED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // ~5 MB

export function isAllowedImageMime(mime: string): boolean {
  return (ALLOWED_IMAGE_MIME as readonly string[]).includes(mime);
}

/**
 * Encrypt + store bytes at `<dir>/<uuid>.enc`; returns the new id (the basename) + vault-relative path.
 * The id is a uuid so two stores never collide and a stored blob is immutable once written.
 */
export async function storeMedia(
  fs: FileSystem,
  key: Uint8Array,
  dir: string,
  bytes: Uint8Array,
): Promise<{ id: string; path: string }> {
  const id = uuid();
  const path = `${dir}/${id}.enc`;
  const envelope = await encryptBytes(bytes, key);
  await fs.writeAtomic(path, new TextEncoder().encode(JSON.stringify(envelope)));
  return { id, path };
}

/**
 * Read + decrypt media bytes; null if `guard(path)` fails, the file is absent, or it's unreadable/corrupt.
 * The caller supplies the path GUARD (e.g. `isConversationAttachmentPath`) so a malicious renderer can never
 * read an arbitrary vault file by path — the trust boundary, mirroring the `isMediaPath`/`isDreamImagePath`
 * rule (08 §13.2 / 13-dream-images §4.3).
 */
export async function getMedia(
  fs: FileSystem,
  key: Uint8Array,
  path: string,
  guard: (p: string) => boolean,
): Promise<Uint8Array | null> {
  if (!guard(path)) return null;
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

/**
 * Best-effort image mime from the leading magic bytes (one of `ALLOWED_IMAGE_MIME`) — so a reader can return
 * the stored type for a data URL without the caller re-supplying it. Defaults to `image/png`.
 */
export function sniffImageMime(bytes: Uint8Array): string {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return 'image/gif';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return 'image/png';
}

/** Delete a stored blob — a no-op for any path the guard rejects. */
export async function deleteMedia(
  fs: FileSystem,
  path: string,
  guard: (p: string) => boolean,
): Promise<void> {
  if (!guard(path)) return;
  await fs.remove(path);
}

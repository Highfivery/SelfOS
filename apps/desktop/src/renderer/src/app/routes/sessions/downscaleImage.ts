/**
 * Client-side image downscaling for Session attachments (45 §5.5). Before an attachment is stored/sent, it's
 * drawn to an off-screen canvas at ~1568px longest edge (Claude's vision sweet spot, which also caps per-image
 * input tokens) and re-encoded — so the stored + transmitted bytes are already bounded. The canvas re-encode
 * also strips EXIF/location metadata as a side effect (a privacy bonus, §8). Animated GIFs collapse to a static
 * first frame (acceptable, §7).
 */

/** Claude's vision resolution sweet spot — the longest-edge downscale target (45 §4.4). */
export const DOWNSCALE_MAX_EDGE = 1568;
/** Per-message attachment cap (45 §4.4). */
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;

/** A downscaled, not-yet-stored attachment held in the composer (store-on-send, 45 §11). */
export interface PendingAttachment {
  /** Client-side temp id for React keys + remove (NOT the stored uuid — that's minted at store time). */
  id: string;
  base64: string; // downscaled image bytes, base64 (no data: prefix) — sent to `storeAttachment`
  mime: string;
  width: number;
  height: number;
  bytes: number; // approximate decoded byte length (display + a pre-flight size sanity)
  previewUrl: string; // a data URL for an instant in-memory thumbnail (no vault round-trip)
}

/** Pure: the target dimensions that fit `maxEdge` on the longest side, preserving aspect ratio (never upscale). */
export function scaledDimensions(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge || longest === 0) return { width, height };
  const ratio = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

/**
 * Decode `blob`, downscale to `maxEdge`, and re-encode to a `PendingAttachment`. Throws if the blob can't be
 * decoded (a corrupt/unsupported image) — the caller surfaces a calm "couldn't read that image" (45 §7).
 */
export async function downscaleImage(
  blob: Blob,
  maxEdge: number = DOWNSCALE_MAX_EDGE,
): Promise<PendingAttachment> {
  const bitmap = await createImageBitmap(blob);
  const { width, height } = scaledDimensions(bitmap.width, bitmap.height, maxEdge);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Canvas 2D context unavailable');
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  // Re-encode: an animated GIF flattens to a static PNG frame; png/jpeg/webp keep their type.
  const outMime = blob.type === 'image/gif' ? 'image/png' : blob.type || 'image/png';
  const dataUrl = canvas.toDataURL(outMime, 0.9);
  const base64 = dataUrl.split(',')[1] ?? '';
  return {
    id: crypto.randomUUID(),
    base64,
    mime: outMime,
    width,
    height,
    bytes: Math.floor((base64.length * 3) / 4), // ~decoded length; main re-checks the true size
    previewUrl: dataUrl,
  };
}

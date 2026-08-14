/**
 * Vault path-segment safety — the one place the "an id from the renderer is untrusted" rule lives.
 *
 * The host filesystem resolves a vault-relative path with `join(vaultDir, path)`, which **normalizes `..`
 * away rather than refusing it**: a `bookId` of `../../../../../../tmp/x` resolves to `/tmp/x`, outside the
 * vault entirely. Every id that becomes a path segment therefore has to be checked before it is
 * interpolated, not after. The bridge is the trust boundary for *permission*; this is the trust boundary
 * for *location*.
 *
 * The habit already existed in three places (`isMediaPath` for questionnaire media, `isDreamImagePath` for
 * dream images, and a hand-copied `isSafeSegment`/`isSafePairKey` in three Together services). This is that
 * rule, single-sourced, so a fourth copy never drifts from the other three.
 */

/** An id we minted (uuid, or a hand-authored slug) — never a path fragment, never a traversal. */
export function isSafeSegment(segment: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(segment);
}

/** A pairKey is two safe ids joined by `~` (`pairKeyFor`) — path-safe, no traversal. */
export function isSafePairKey(pairKey: string): boolean {
  const parts = pairKey.split('~');
  return parts.length === 2 && parts.every(isSafeSegment);
}

/** Thrown when an untrusted id would have become a path segment. Callers that read defensively already
 *  `.catch` into "absent"; a WRITE fails loudly, which is the outcome we want. */
export class UnsafePathSegmentError extends Error {
  constructor(value: string) {
    // Never echo the raw value into a message that could be logged — say what happened, not what was sent.
    super(`Refusing to build a vault path from an unsafe id (${value.length} chars).`);
    this.name = 'UnsafePathSegmentError';
  }
}

/** Return `segment` when it is safe to interpolate into a vault path; throw otherwise. */
export function pathSegment(segment: string): string {
  if (!isSafeSegment(segment)) throw new UnsafePathSegmentError(segment);
  return segment;
}

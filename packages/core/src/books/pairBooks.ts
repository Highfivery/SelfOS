import type { FileSystem } from '../host';
import { listRelationships, livePartnerIds } from '../people';
import type { BookManifest } from '../schemas';
import { pairKeyFor } from '../together';
import { getBook, listBooks } from './storyService';

/**
 * Pair-owned books — "Our Story" (72 §5.8), the one kind of book that is not owned by one person.
 *
 * It lives at `together/pairs/<pairKey>/books/<bookId>/`, the spec-58 pair-storage precedent, and is
 * addressed by passing its `pairKey` where every other book passes a `personId` (see `booksDir`).
 *
 * **Why this module exists at all.** Until now the book path WAS the authorization: `story:*` handlers
 * checked `story.own` + resolved the active person, and every path was built under
 * `people/<activePersonId>/`, so a caller could not reach another person's book however they tried. A
 * pair root has no such property — it names two people — so the gate has to become explicit, and it is
 * the same gate Together already uses: participant membership plus a **live `partner` edge, re-checked on
 * every call**. Delete the edge and the shared book re-gates immediately, with no stale access and nothing
 * to clean up.
 *
 * The pairKey is derived from the live edge rather than trusted from a directory listing or from the
 * caller, so an unreachable pair simply produces no candidates.
 */

/** The pair roots this viewer may currently address — one per LIVE partner edge, order-independent. */
export async function livePairRefs(
  fs: FileSystem,
  key: Uint8Array,
  viewerPersonId: string,
): Promise<string[]> {
  const relationships = await listRelationships(fs, key);
  return livePartnerIds(relationships, viewerPersonId).map((partnerId) =>
    pairKeyFor(viewerPersonId, partnerId),
  );
}

/**
 * Resolve which owner ref a viewer may use to reach `bookId`, or `null` if they may not reach it at all.
 *
 * Their own books first (the overwhelmingly common case, and one read), then each live pair root. `null`
 * covers every denial identically — a book that doesn't exist, someone else's solo book, and a pair book
 * whose partner edge is gone are indistinguishable to the caller, which is what we want.
 */
export async function resolveBookOwnerRef(
  fs: FileSystem,
  key: Uint8Array,
  viewerPersonId: string,
  bookId: string,
): Promise<string | null> {
  const own = await getBook(fs, key, viewerPersonId, bookId).catch(() => null);
  if (own) return viewerPersonId;
  for (const pairRef of await livePairRefs(fs, key, viewerPersonId)) {
    const shared = await getBook(fs, key, pairRef, bookId).catch(() => null);
    if (shared) return pairRef;
  }
  return null;
}

/** Every pair-owned book this viewer can currently reach, with the ref each was found under. */
export async function listPairBooks(
  fs: FileSystem,
  key: Uint8Array,
  viewerPersonId: string,
): Promise<{ ownerRef: string; manifest: BookManifest }[]> {
  const out: { ownerRef: string; manifest: BookManifest }[] = [];
  for (const ownerRef of await livePairRefs(fs, key, viewerPersonId)) {
    for (const manifest of await listBooks(fs, key, ownerRef).catch(() => [])) {
      out.push({ ownerRef, manifest });
    }
  }
  return out;
}

/**
 * The two people a pair ref names. Used to assemble the merged corpus and to name the partner in the UI.
 * Returns null for a solo ref, so a caller can branch on "is this a shared book" without re-parsing.
 */
export function pairMembers(ownerRef: string): [string, string] | null {
  const parts = ownerRef.split('~');
  return parts.length === 2 && parts[0] && parts[1] ? [parts[0], parts[1]] : null;
}

/** The OTHER participant of a pair ref, from this viewer's side; null if the viewer isn't one of them. */
export function partnerOf(ownerRef: string, viewerPersonId: string): string | null {
  const members = pairMembers(ownerRef);
  if (!members || !members.includes(viewerPersonId)) return null;
  return members[0] === viewerPersonId ? members[1] : members[0];
}

/** Whether this ref addresses a pair-owned book. */
export function isPairRef(ownerRef: string): boolean {
  return pairMembers(ownerRef) !== null;
}

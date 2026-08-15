import type { FileSystem } from '../host';
import type { NewMaterialEntry, NewMaterialReason } from '../schemas';
import { getChapter, getNewMaterial, saveChapter, saveNewMaterial } from './storyService';
import { computeSourceSignature } from './storyFreshness';
import { buildStoryCorpus } from './storyCorpus';
import { getExclusions } from './storyService';

/**
 * New material — what a chapter has drifted from, waiting on the author (72 §4.4/§5.4).
 *
 * This replaces the `stale` status. The difference is not cosmetic: `stale` was a flag the refresh cadence
 * ACTED on, so a book rewrote itself in the background, ten chapters a week, forever. An entry here is a
 * proposal. It names what changed and quotes it, and it does nothing at all until the author says so.
 *
 * Four things can put a chapter here. One is passive — new material arrived, found free by the signature
 * diff. The other three are the author's own doing: they excluded something the chapter draws on, re-worded
 * what the chapter is meant to say, or merged two chapters. All four are proposals (owner decision,
 * 2026-08-13) — "you changed its brief" gets a one-click rewrite, not an automatic one.
 *
 * Entries are keyed by `(chapterId, reason)`: re-detecting the same drift REPLACES the entry rather than
 * piling up duplicates, so a chapter shows at most one line per kind of drift.
 */

/** The key an entry is deduped by — one per chapter per kind of drift. */
function entryKey(chapterId: string, reason: NewMaterialReason): string {
  return `${chapterId}:${reason}`;
}

/**
 * File (or refresh) drift proposals. Replaces any existing entry with the same `(chapterId, reason)` so a
 * re-run never duplicates, and leaves every other entry alone. Re-reads live before writing, since the
 * caller may have spent seconds building a corpus first.
 */
export async function recordNewMaterial(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  entries: NewMaterialEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  const live = await getNewMaterial(fs, key, personId, bookId);
  const incoming = new Set(entries.map((e) => entryKey(e.chapterId, e.reason)));
  const kept = live.entries.filter((e) => !incoming.has(entryKey(e.chapterId, e.reason)));
  await saveNewMaterial(fs, key, personId, bookId, {
    schemaVersion: 1,
    entries: [...kept, ...entries],
  });
}

/**
 * Record one author-driven drift (an exclusion, a re-worded brief, a merge) as a proposal. The `note` is what
 * the author reads — it carries no source material, because nothing new arrived: they changed the plan.
 */
export async function recordAuthorDrift(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  args: { chapterId: string; reason: NewMaterialReason; note: string; now: Date },
): Promise<void> {
  await recordNewMaterial(fs, key, personId, bookId, [
    {
      chapterId: args.chapterId,
      reason: args.reason,
      items: [],
      note: args.note,
      detectedAt: args.now.toISOString(),
    },
  ]);
}

/** Drop a chapter's entries — every kind, or one kind. Used after an accepted rewrite and by "Not now". */
export async function clearNewMaterial(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  args: { chapterId: string; reason?: NewMaterialReason },
): Promise<void> {
  const live = await getNewMaterial(fs, key, personId, bookId);
  const next = live.entries.filter(
    (e) =>
      e.chapterId !== args.chapterId || (args.reason !== undefined && e.reason !== args.reason),
  );
  if (next.length === live.entries.length) return; // nothing matched — don't rewrite the file
  await saveNewMaterial(fs, key, personId, bookId, { schemaVersion: 1, entries: next });
}

/**
 * "Not now" (§3.6) — decline a chapter's proposals without rewriting it.
 *
 * For an AUTHOR-driven reason that is enough: the event happened once and won't recur. For `newMaterial` it
 * is not, because the signature diff is stateless — the sources still differ from what the chapter was
 * written against, so the very next free scan would raise it again and "Not now" would mean nothing. So
 * declining also RE-STAMPS the chapter's signature against today's sources.
 *
 * That is an honest use of the field, not a lie about the prose: a signature records the state of the
 * sources at the last time this chapter was reconciled with them, and declining IS a reconciliation — the
 * author has looked at what changed and decided the chapter stands. If more material arrives later the
 * signature drifts again and it comes back.
 */
export async function declineNewMaterial(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  args: { chapterId: string; reason?: NewMaterialReason },
): Promise<void> {
  const declinesMaterial = args.reason === undefined || args.reason === 'newMaterial';
  if (declinesMaterial) {
    const chapter = await getChapter(fs, key, personId, bookId, args.chapterId);
    if (chapter) {
      const corpus = await buildStoryCorpus(
        fs,
        key,
        personId,
        bookId,
        await getExclusions(fs, key, personId, bookId),
      );
      await saveChapter(fs, key, personId, bookId, {
        ...chapter,
        sourceSignature: computeSourceSignature(corpus, chapter),
      });
    }
  }
  await clearNewMaterial(fs, key, personId, bookId, args);
}

/** Every chapter id with something waiting, in the order the entries were filed. */
export async function chaptersWithNewMaterial(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
): Promise<string[]> {
  const list = await getNewMaterial(fs, key, personId, bookId);
  return [...new Set(list.entries.map((e) => e.chapterId))];
}

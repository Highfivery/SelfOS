import type { FileSystem } from '../host';
import type { StoryHomeSignal } from '../schemas';
import { getOutline, listBooks, listChapters } from './storyService';
import { chaptersWithNewMaterial } from './storyMaterial';
import { listStructuralProposals } from './storyStructureService';

/**
 * The living-book Home signal (64 §5.6) — computed host-side, NO AI: what, if anything, the person's book wants
 * from them next. Reads the person's book (v1 is one book — the most-recently-updated wins if there's somehow
 * more) and derives three counts:
 *  - `staleChapters`: WRITTEN chapters with new material waiting (72 §4.4) — things that could go in.
 *  - `pendingProposals`: structural suggestions waiting to be reviewed.
 *  - `unwrittenChapters`: approved outline chapters with no drafted prose yet (including approved new/split
 *    shells — they count as "waiting to be written", not as drifted).
 * A person with no book gets `hasBook: false` (starting a book is the nav's job, not a Home push). The signature
 * is `<bookId>:<stale>:<proposals>:<unwritten>` so a dismissed card re-surfaces only when a count changes.
 */
export async function computeStoryHomeSignal(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<StoryHomeSignal> {
  const books = await listBooks(fs, key, personId);
  if (books.length === 0) {
    return {
      hasBook: false,
      staleChapters: 0,
      pendingProposals: 0,
      unwrittenChapters: 0,
      signature: '',
    };
  }
  const book = books.reduce((a, b) => (a.updatedAt >= b.updatedAt ? a : b));

  const chapters = await listChapters(fs, key, personId, book.id);
  const written = chapters.filter((c) => c.markdown.trim().length > 0);
  const writtenIds = new Set(written.map((c) => c.id));
  const drifted = new Set(await chaptersWithNewMaterial(fs, key, personId, book.id));
  const staleChapters = written.filter((c) => drifted.has(c.id)).length;

  const outline = await getOutline(fs, key, personId, book.id);
  const outlineChapters = outline?.approved ? outline.parts.flatMap((p) => p.chapters) : [];
  const unwrittenChapters = outlineChapters.filter((c) => !writtenIds.has(c.id)).length;

  const pendingProposals = (await listStructuralProposals(fs, key, personId, book.id)).length;

  return {
    hasBook: true,
    staleChapters,
    pendingProposals,
    unwrittenChapters,
    signature: `${book.id}:${staleChapters}:${pendingProposals}:${unwrittenChapters}`,
  };
}

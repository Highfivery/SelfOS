import type { FileSystem } from '../host';
import type { BookEdition, BookManifest } from '../schemas';
import { readerWordCount } from './manuscriptMetrics';
import { copyEdition, getBook, listChapters, updateBook } from './storyService';

/**
 * Editions and the living/finished lifecycle (72 §3.6/§4.5).
 *
 * A book has no natural end. The material keeps arriving, so without a way to say "this one is done" the
 * only states are half-written and never-finished — which is what both real books were. **Finish this
 * edition** freezes what exists as Edition N: readable, exportable, shareable, and no longer changing
 * however much the living book does afterwards.
 *
 * A finished book is NOT dormant (owner decision, 2026-08-13). It keeps noticing new material quietly —
 * detection is free — and offers to start the next edition when there is enough worth adding. What stops is
 * the asking: the biographer does not interview you for a book you have called done.
 *
 * Reopening is a first-class act, not a workaround. Nothing about finishing is destructive: the frozen
 * edition stays, and the living book carries on from exactly where it was.
 */

/** How much new material is worth mentioning a next edition over. Below this, the offer would be noise. */
export const NEXT_EDITION_MATERIAL_THRESHOLD = 3;

export type FinishEditionResult =
  | { ok: true; edition: BookEdition; book: BookManifest }
  | { ok: false; message: string };

/**
 * Freeze the current book as the next edition and mark it finished. Refuses a book with nothing written —
 * there would be nothing to freeze, and "finished" would be a lie about an empty book.
 */
export async function finishEdition(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  now: Date,
): Promise<FinishEditionResult> {
  const book = await getBook(fs, key, personId, bookId);
  if (!book) return { ok: false, message: 'That book is no longer here.' };

  const written = (await listChapters(fs, key, personId, bookId)).filter(
    (c) => c.markdown.trim().length > 0,
  );
  if (written.length === 0) {
    return { ok: false, message: 'There’s nothing written yet to finish.' };
  }

  const n = (book.editions.at(-1)?.n ?? 0) + 1;
  const edition: BookEdition = {
    n,
    finishedAt: now.toISOString(),
    chapterCount: written.length,
    wordCount: written.reduce((sum, c) => sum + readerWordCount(c.markdown), 0),
  };

  // Freeze FIRST, then record it. A crash between the two leaves an orphan copy on disk (harmless, and
  // overwritten by the next attempt at the same n) rather than a manifest claiming an edition that isn't
  // there — which is the failure a reader would actually hit.
  await copyEdition(fs, personId, bookId, n);
  const next = await updateBook(
    fs,
    key,
    personId,
    bookId,
    { lifecycle: 'finished', editions: [...book.editions, edition] },
    now,
  );
  if (!next) return { ok: false, message: 'That book is no longer here.' };
  return { ok: true, edition, book: next };
}

/** Reopen a finished book — it goes back to living and carries on from where it was. The frozen editions
 *  are untouched; nothing about finishing was destructive. */
export async function reopenBook(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  now: Date,
): Promise<BookManifest | null> {
  const book = await getBook(fs, key, personId, bookId);
  if (!book) return null;
  if (isLiving(book)) return book;
  return updateBook(fs, key, personId, bookId, { lifecycle: 'living' }, now);
}

/** Absent lifecycle ⇒ living, so every book written before 72 carries on exactly as it did. */
export function isLiving(book: Pick<BookManifest, 'lifecycle'>): boolean {
  return book.lifecycle !== 'finished';
}

/**
 * Whether a finished book has accumulated enough to be worth offering a next edition over. Living books
 * never get the offer — they are already growing.
 */
export function offersNextEdition(
  book: Pick<BookManifest, 'lifecycle' | 'editions'>,
  pendingMaterialCount: number,
): boolean {
  return !isLiving(book) && pendingMaterialCount >= NEXT_EDITION_MATERIAL_THRESHOLD;
}

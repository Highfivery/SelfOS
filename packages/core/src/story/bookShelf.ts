import type { FileSystem } from '../host';
import type { BookShelfEntry } from '../schemas';
import { readerWordCount } from './manuscriptMetrics';
import { listBooks, listChapters, getOutline } from './storyService';

/**
 * The bookshelf read (72 §3.1).
 *
 * The shelf is the section's front door, so it has to say something true about each book at a glance — how
 * far along it is, in the unit that book is actually measured in. That can't come from the manifest: a
 * manifest knows a book's title and status but not how much of it exists. So this reads each book's outline
 * (how many chapters it means to have) and its chapters (how many have prose, and how long they are).
 *
 * That is one pass over every chapter of every book, which is the same work opening a single book already
 * does — measured at well under the cost of a single model call, and the shelf is loaded once per visit, not
 * per render. It is deliberately NOT cached on the manifest: a count maintained at write time is a count
 * that can silently drift from the files, and a shelf that lies about a book is worse than one that takes a
 * moment.
 *
 * `unit` comes from the book type's spine so a picture book counts pages rather than chapters (72 P6) without
 * this read changing.
 */
export async function listShelf(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  unitFor: (typeId: string) => BookShelfEntry['unit'],
): Promise<BookShelfEntry[]> {
  const out: BookShelfEntry[] = [];
  for (const manifest of await listBooks(fs, key, personId)) {
    const outline = await getOutline(fs, key, personId, manifest.id);
    const chapters = await listChapters(fs, key, personId, manifest.id);
    const written = chapters.filter((c) => c.markdown.trim().length > 0);
    // The outline is the book's intended shape; before it exists, what's written IS the whole book so far.
    const total = outline
      ? outline.parts.reduce((n, part) => n + part.chapters.length, 0)
      : written.length;
    out.push({
      id: manifest.id,
      type: manifest.type,
      title: manifest.title,
      status: manifest.status,
      lifecycle: manifest.lifecycle ?? 'living',
      editions: manifest.editions.length,
      ...(manifest.editions.at(-1)?.finishedAt
        ? { finishedAt: manifest.editions.at(-1)!.finishedAt }
        : {}),
      ...(manifest.coverImageId ? { coverImageId: manifest.coverImageId } : {}),
      ...(manifest.essence ? { essence: manifest.essence } : {}),
      written: written.length,
      total,
      words: written.reduce((n, c) => n + readerWordCount(c.markdown), 0),
      unit: unitFor(manifest.type),
      updatedAt: manifest.updatedAt,
    });
  }
  return out;
}

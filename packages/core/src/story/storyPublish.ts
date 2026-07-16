import type { FileSystem } from '../host';
import { getPerson, listPeople } from '../people';
import type {
  BookChapter,
  BookReader,
  PublishedManifest,
  PublishedPart,
  ReaderChapter,
  SharedBookSummary,
  StoryPublishResult,
  StoryReaderView,
} from '../schemas';
import {
  getBook,
  getOutline,
  getPublishedChapter,
  getPublishedImageBytes,
  getPublishedManifest,
  getStoryImageIndex,
  listBooks,
  listChapters,
  prunePublishedChapters,
  prunePublishedImages,
  saveManifest,
  savePublishedChapter,
  savePublishedManifest,
  snapshotPublishedImage,
} from './storyService';

/**
 * Your Story publishing + readers (64-your-story §3.5/§3.6). The publish gate is the ONE safety mechanism for a
 * book reaching another person: readers only ever see the PUBLISHED HEAD (a snapshot of the person's Reviewed
 * chapters + a self-contained manifest), never the live draft, and access is stored per-book + RE-CHECKED at
 * every read (revoke or un-publish takes effect immediately — the dream-image-sharing model). No AI here.
 */

const SOURCE_KIND_NOUN: Record<string, string> = {
  insight: 'coaching insights',
  intakeAnswer: 'onboarding answers',
  response: 'check-in answers',
  dream: 'dreams',
  test: 'self-reflections',
  goal: 'goals',
  challenge: 'challenges',
  together: 'sessions with a partner',
  timeline: 'timeline moments',
  photo: 'photos',
};

/** The auto "A Note on this book" honesty page (§3.6) — built from what the published chapters ACTUALLY drew on
 *  (their provenance), so it never overstates. Names no numbers it can't back up. */
export function noteOnBook(chapters: BookChapter[]): string {
  const byKind = new Map<string, Set<string>>();
  for (const chapter of chapters) {
    for (const entry of chapter.provenance) {
      for (const ref of entry.refs) {
        const ids = byKind.get(ref.kind) ?? new Set<string>();
        ids.add(ref.id);
        byKind.set(ref.kind, ids);
      }
    }
  }
  const parts = [...byKind.entries()]
    .filter(([, ids]) => ids.size > 0)
    .map(([kind, ids]) => `${ids.size} ${SOURCE_KIND_NOUN[kind] ?? kind}`);
  const drawn = parts.length > 0 ? parts.join(', ') : 'the life you have shared';
  return `This book was written from ${drawn} — your own words and record, never invented. Where a detail was missing, it was left unwritten rather than imagined.`;
}

/**
 * Publish (or re-publish) the book: snapshot EVERY Reviewed chapter into the published head + write a
 * self-contained published manifest (title, essence, matter, the honesty note, the TOC). A chapter that is no
 * longer Reviewed is pruned from the head (never lingers for a reader). Draft edits after this don't leak — the
 * published head is a separate copy. Refuses when nothing is Reviewed yet (the review gate, §3.5).
 */
export async function publishBook(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  now: Date,
): Promise<StoryPublishResult> {
  const book = await getBook(fs, key, personId, bookId);
  if (!book) return { ok: false, message: 'That book is no longer here.' };
  const outline = await getOutline(fs, key, personId, bookId);
  if (!outline) return { ok: false, message: 'This book has no outline yet.' };
  const reviewed = (await listChapters(fs, key, personId, bookId)).filter(
    (c) => c.status === 'reviewed',
  );
  if (reviewed.length === 0) {
    return { ok: false, message: 'Mark at least one chapter “Looks good” before you share it.' };
  }

  const reviewedIds = new Set(reviewed.map((c) => c.id));
  for (const chapter of reviewed) {
    await savePublishedChapter(fs, key, personId, bookId, chapter);
  }
  await prunePublishedChapters(fs, personId, bookId, reviewedIds);

  const parts: PublishedPart[] = outline.parts
    .map((part) => ({
      id: part.id,
      title: part.title,
      chapterIds: part.chapters
        .slice()
        .sort((a, b) => a.order - b.order)
        .filter((c) => reviewedIds.has(c.id))
        .map((c) => c.id),
    }))
    .filter((p) => p.chapterIds.length > 0);
  const chapterOrder = parts.flatMap((p) => p.chapterIds);
  // The honesty note counts sources from the chapters actually PUBLISHED (in `chapterOrder`), not every reviewed
  // chapter — a reviewed-but-orphaned chapter (not in any outline part) is snapshotted but never shown, so its
  // sources mustn't inflate the note.
  const byId = new Map(reviewed.map((c) => [c.id, c]));
  const publishedChapters = chapterOrder.map((id) => byId.get(id)!).filter(Boolean);

  // Freeze every image the published head references — the cover + every placement in a PUBLISHED chapter — so
  // the shared book/export never changes when the draft images do (§3.8). Snapshot the bytes + record metadata.
  const index = await getStoryImageIndex(fs, key, personId, bookId);
  const referenced = new Set<string>();
  if (book.coverImageId) referenced.add(book.coverImageId);
  for (const c of publishedChapters) {
    for (const pl of c.imagePlacements) referenced.add(pl.imageId);
  }
  for (const id of referenced) await snapshotPublishedImage(fs, key, personId, bookId, id);
  await prunePublishedImages(fs, personId, bookId, referenced);
  const images = index.images.filter((img) => referenced.has(img.id));

  const publishedManifest: PublishedManifest = {
    schemaVersion: 1,
    publishedAt: now.toISOString(),
    title: book.title,
    ...(book.essence ? { essence: book.essence } : {}),
    ...(book.coverImageId ? { coverImageId: book.coverImageId } : {}),
    ...(book.matter ? { matter: book.matter } : {}),
    noteOnBook: noteOnBook(publishedChapters),
    parts,
    chapterOrder,
    images,
  };
  await savePublishedManifest(fs, key, personId, bookId, publishedManifest);
  await saveManifest(fs, key, {
    ...book,
    publishedAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });
  return { ok: true, publishedChapters: reviewed.length };
}

/** The book's current readers (§3.5), resolved to names. */
export async function listReaders(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
): Promise<BookReader[]> {
  const book = await getBook(fs, key, personId, bookId);
  if (!book) return [];
  const out: BookReader[] = [];
  for (const readerId of book.sharedWith) {
    const person = await getPerson(fs, key, readerId);
    if (person) out.push({ personId: readerId, displayName: person.displayName });
  }
  return out;
}

/** Grant a household person read access to the book (§3.5). Refuses the author themselves + a non-household id;
 *  idempotent. Returns the updated reader list. */
export async function grantReader(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  readerPersonId: string,
  now: Date,
): Promise<BookReader[]> {
  const book = await getBook(fs, key, personId, bookId);
  if (!book) return [];
  if (readerPersonId === personId) return listReaders(fs, key, personId, bookId); // can't grant yourself
  const reader = await getPerson(fs, key, readerPersonId);
  if (!reader) return listReaders(fs, key, personId, bookId); // not a household person
  if (!book.sharedWith.includes(readerPersonId)) {
    await saveManifest(fs, key, {
      ...book,
      sharedWith: [...book.sharedWith, readerPersonId],
      updatedAt: now.toISOString(),
    });
  }
  return listReaders(fs, key, personId, bookId);
}

/** Revoke a reader — access ends at their next read (the re-gate). Returns the updated reader list. */
export async function revokeReader(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  readerPersonId: string,
  now: Date,
): Promise<BookReader[]> {
  const book = await getBook(fs, key, personId, bookId);
  if (!book) return [];
  if (book.sharedWith.includes(readerPersonId)) {
    await saveManifest(fs, key, {
      ...book,
      sharedWith: book.sharedWith.filter((id) => id !== readerPersonId),
      updatedAt: now.toISOString(),
    });
  }
  return listReaders(fs, key, personId, bookId);
}

/**
 * Whether the book's Reviewed prose prominently mentions `name` (§3.5) — a cheap word-boundary scan for the
 * gentle "Angel appears throughout this book" note when granting them as a reader. Pure.
 */
export function bookMentionsReader(chapters: BookChapter[], name: string): boolean {
  const needle = name.trim();
  if (needle.length < 2) return false;
  const re = new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  return chapters.some((c) => re.test(c.markdown));
}

/**
 * Every book shared WITH the viewer (§3.5) — published + the viewer still in `sharedWith` (the read-time re-gate,
 * checked here on every call). Cross-person read, but returns ONLY books explicitly shared with the viewer.
 */
export async function listSharedBooks(
  fs: FileSystem,
  key: Uint8Array,
  viewerPersonId: string,
  readAt: Record<string, string> = {},
): Promise<SharedBookSummary[]> {
  const out: SharedBookSummary[] = [];
  for (const author of await listPeople(fs, key)) {
    if (author.id === viewerPersonId) continue;
    for (const book of await listBooks(fs, key, author.id)) {
      if (!book.publishedAt || !book.sharedWith.includes(viewerPersonId)) continue;
      const published = await getPublishedManifest(fs, key, author.id, book.id);
      if (!published) continue;
      // The viewer's device-local last-open for THIS book (§3.6). `neverOpened` gates the one-time
      // notification; `updated` is the quiet marker (author published newer content since the last open).
      const lastReadAt = readAt[book.id];
      const neverOpened = lastReadAt === undefined;
      const updated = neverOpened || published.publishedAt > lastReadAt;
      out.push({
        authorPersonId: author.id,
        authorName: author.displayName,
        bookId: book.id,
        title: published.title,
        publishedAt: published.publishedAt,
        chapterCount: published.chapterOrder.length,
        newChapters: updated ? published.chapterOrder.length : 0,
        neverOpened,
        updated,
      });
    }
  }
  out.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0));
  return out;
}

/**
 * Read a book shared with the viewer — the PUBLISHED head only (§3.6), never the draft. Re-gates on every read
 * (the book must still be published AND the viewer still in `sharedWith`); returns null when access is gone.
 */
export async function readSharedBook(
  fs: FileSystem,
  key: Uint8Array,
  viewerPersonId: string,
  authorPersonId: string,
  bookId: string,
): Promise<StoryReaderView | null> {
  if (authorPersonId === viewerPersonId) return null; // read your own book through the normal surface
  const book = await getBook(fs, key, authorPersonId, bookId);
  if (!book || !book.publishedAt || !book.sharedWith.includes(viewerPersonId)) return null;
  const manifest = await getPublishedManifest(fs, key, authorPersonId, bookId);
  if (!manifest) return null;
  const chapters: ReaderChapter[] = [];
  for (const id of manifest.chapterOrder) {
    const chapter = await getPublishedChapter(fs, key, authorPersonId, bookId, id);
    // Project the MINIMAL reader shape — never the raw BookChapter (its provenance names the author's private
    // sources; it must not cross to a reader, even unrendered — the cross-person "project a minimal shape" rule).
    // `imagePlacements` IS safe to project (imageId/anchor/caption only) — the bytes come through the re-gated
    // `readSharedImage`.
    if (chapter)
      chapters.push({
        id: chapter.id,
        title: chapter.title,
        markdown: chapter.markdown,
        imagePlacements: chapter.imagePlacements,
      });
  }
  const author = await getPerson(fs, key, authorPersonId);
  return {
    authorPersonId,
    authorName: author?.displayName ?? 'Someone',
    bookId,
    manifest,
    chapters,
  };
}

/**
 * Serve a PUBLISHED image's bytes to a granted reader (§3.6) — re-gated on every read (the book must still be
 * published, the viewer still in `sharedWith`, and the image must belong to the published head). Null otherwise.
 * The reader never touches the draft images; only the frozen `published/images/` snapshot.
 */
export async function readSharedImage(
  fs: FileSystem,
  key: Uint8Array,
  viewerPersonId: string,
  authorPersonId: string,
  bookId: string,
  imageId: string,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  if (authorPersonId === viewerPersonId) return null;
  const book = await getBook(fs, key, authorPersonId, bookId);
  if (!book || !book.publishedAt || !book.sharedWith.includes(viewerPersonId)) return null;
  const manifest = await getPublishedManifest(fs, key, authorPersonId, bookId);
  const entry = manifest?.images.find((i) => i.id === imageId);
  if (!entry) return null; // not part of the published head
  const bytes = await getPublishedImageBytes(fs, key, authorPersonId, bookId, imageId);
  return bytes ? { bytes, mime: entry.mime } : null;
}

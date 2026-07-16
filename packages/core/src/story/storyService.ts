import type { FileSystem } from '../host';
import { uuid } from '../id';
import {
  BookChapterSchema,
  BookManifestSchema,
  BookOutlineSchema,
  ExclusionListSchema,
  LifeTimelineSchema,
  type BookChapter,
  type BookConfig,
  type BookManifest,
  type BookOutline,
  type BookTypeId,
  type ExclusionItem,
  type LifeTimeline,
  type StoryBookBundle,
} from '../schemas';
import { readEncryptedJson, writeEncryptedJson } from '../vault';

/**
 * Your Story persistence (64-your-story §4/§5.7). A book lives under `people/<personId>/story/books/<bookId>/`
 * as encrypted `.enc` files (markdown content is a string inside the encrypted JSON — the app's "markdown
 * content" convention, never plain `.md` at rest). Per-person only: a book's `personId` is its subject, and
 * the bridge scopes every `story:*` channel to the active person (the trust boundary). No AI here — this is
 * pure vault I/O; generation is `storyGenerationService`.
 */

function booksDir(personId: string): string {
  return `people/${personId}/story/books`;
}
function bookDir(personId: string, bookId: string): string {
  return `${booksDir(personId)}/${bookId}`;
}
function manifestPath(personId: string, bookId: string): string {
  return `${bookDir(personId, bookId)}/book.enc`;
}
function outlinePath(personId: string, bookId: string): string {
  return `${bookDir(personId, bookId)}/outline.enc`;
}
function timelinePath(personId: string, bookId: string): string {
  return `${bookDir(personId, bookId)}/timeline.enc`;
}
function exclusionsPath(personId: string, bookId: string): string {
  return `${bookDir(personId, bookId)}/exclusions.enc`;
}
function chaptersDir(personId: string, bookId: string): string {
  return `${bookDir(personId, bookId)}/chapters`;
}
function chapterPath(personId: string, bookId: string, chapterId: string): string {
  return `${chaptersDir(personId, bookId)}/${chapterId}.enc`;
}

// --- Manifest / book lifecycle ---------------------------------------------------------------------------

export async function saveManifest(
  fs: FileSystem,
  key: Uint8Array,
  manifest: BookManifest,
): Promise<void> {
  await writeEncryptedJson(fs, manifestPath(manifest.personId, manifest.id), manifest, key);
}

/** Create a new book (status `outlining`), persist its manifest, and return it. */
export async function createBook(
  fs: FileSystem,
  key: Uint8Array,
  input: {
    personId: string;
    type: BookTypeId;
    title: string;
    config: BookConfig;
    now: Date;
  },
): Promise<BookManifest> {
  const at = input.now.toISOString();
  const manifest: BookManifest = {
    id: uuid(),
    schemaVersion: 1,
    personId: input.personId,
    type: input.type,
    title: input.title.trim() || 'Your Story',
    config: input.config,
    status: 'outlining',
    sharedWith: [],
    createdAt: at,
    updatedAt: at,
  };
  await saveManifest(fs, key, manifest);
  return manifest;
}

export async function getBook(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
): Promise<BookManifest | null> {
  const raw = await readEncryptedJson(fs, manifestPath(personId, bookId), key);
  if (!raw) return null;
  const manifest = BookManifestSchema.parse(raw);
  // Defense in depth: only serve a book whose subject matches the folder (the insight/goal precedent).
  return manifest.personId === personId ? manifest : null;
}

/** A person's books, newest-updated first. Skips non-book folder entries (a stray file / missing book.enc). */
export async function listBooks(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<BookManifest[]> {
  const out: BookManifest[] = [];
  for (const entry of await fs.list(booksDir(personId))) {
    if (entry.endsWith('.enc')) continue; // book ids are folders; skip any stray file
    const manifest = await getBook(fs, key, personId, entry);
    if (manifest) out.push(manifest);
  }
  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  return out;
}

/** Merge a patch into a book's manifest and re-save (bumps `updatedAt`). Returns the updated manifest, or
 *  null if the book is gone. `personId`/`id`/`schemaVersion`/`createdAt`/`type` are never patchable. */
export async function updateBook(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  patch: Partial<
    Pick<
      BookManifest,
      'title' | 'config' | 'essence' | 'status' | 'coverImageId' | 'sharedWith' | 'publishedAt'
    >
  >,
  now: Date,
): Promise<BookManifest | null> {
  const existing = await getBook(fs, key, personId, bookId);
  if (!existing) return null;
  const updated: BookManifest = { ...existing, ...patch, updatedAt: now.toISOString() };
  await saveManifest(fs, key, updated);
  return updated;
}

/** Delete a book and every file under it (the whole folder). */
export async function deleteBook(fs: FileSystem, personId: string, bookId: string): Promise<void> {
  await fs.remove(bookDir(personId, bookId));
}

// --- Outline / timeline / exclusions ---------------------------------------------------------------------

export async function saveOutline(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  outline: BookOutline,
): Promise<void> {
  await writeEncryptedJson(fs, outlinePath(personId, bookId), outline, key);
}

export async function getOutline(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
): Promise<BookOutline | null> {
  const raw = await readEncryptedJson(fs, outlinePath(personId, bookId), key);
  return raw ? BookOutlineSchema.parse(raw) : null;
}

export async function saveTimeline(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  timeline: LifeTimeline,
): Promise<void> {
  await writeEncryptedJson(fs, timelinePath(personId, bookId), timeline, key);
}

export async function getTimeline(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
): Promise<LifeTimeline | null> {
  const raw = await readEncryptedJson(fs, timelinePath(personId, bookId), key);
  return raw ? LifeTimelineSchema.parse(raw) : null;
}

export async function getExclusions(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
): Promise<ExclusionItem[]> {
  const raw = await readEncryptedJson(fs, exclusionsPath(personId, bookId), key);
  return raw ? ExclusionListSchema.parse(raw).items : [];
}

export async function saveExclusions(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  items: ExclusionItem[],
): Promise<void> {
  await writeEncryptedJson(fs, exclusionsPath(personId, bookId), { schemaVersion: 1, items }, key);
}

// --- Chapters (draft head) -------------------------------------------------------------------------------

export async function saveChapter(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  chapter: BookChapter,
): Promise<void> {
  await writeEncryptedJson(fs, chapterPath(personId, bookId, chapter.id), chapter, key);
}

export async function getChapter(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  chapterId: string,
): Promise<BookChapter | null> {
  const raw = await readEncryptedJson(fs, chapterPath(personId, bookId, chapterId), key);
  return raw ? BookChapterSchema.parse(raw) : null;
}

/** Every draft-head chapter of a book, in outline order (`partId` then `order`). */
export async function listChapters(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
): Promise<BookChapter[]> {
  const out: BookChapter[] = [];
  for (const name of await fs.list(chaptersDir(personId, bookId))) {
    if (!name.endsWith('.enc')) continue;
    const raw = await readEncryptedJson(fs, `${chaptersDir(personId, bookId)}/${name}`, key);
    if (!raw) continue;
    out.push(BookChapterSchema.parse(raw));
  }
  out.sort((a, b) => (a.partId === b.partId ? a.order - b.order : a.partId < b.partId ? -1 : 1));
  return out;
}

// --- Foundations + outline approval ----------------------------------------------------------------------

/** Persist the foundations pass output (essence on the manifest + outline + timeline). Status stays
 *  `outlining` — the person reviews/edits the outline, then approves it (`approveOutline`). */
export async function applyFoundations(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  foundations: { essence: string; outline: BookOutline; timeline: LifeTimeline },
  now: Date,
): Promise<BookManifest | null> {
  const manifest = await updateBook(
    fs,
    key,
    personId,
    bookId,
    { essence: foundations.essence },
    now,
  );
  if (!manifest) return null;
  await saveOutline(fs, key, personId, bookId, { ...foundations.outline, approved: false });
  await saveTimeline(fs, key, personId, bookId, foundations.timeline);
  return manifest;
}

/** Approve the (possibly edited) outline: mark it approved + move the book to `drafting` (chapter drafting
 *  begins in slice B). Returns the updated manifest, or null if the book/outline is gone. */
export async function approveOutline(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  outline: BookOutline,
  now: Date,
): Promise<BookManifest | null> {
  const manifest = await getBook(fs, key, personId, bookId);
  if (!manifest) return null;
  await saveOutline(fs, key, personId, bookId, { ...outline, approved: true });
  return updateBook(fs, key, personId, bookId, { status: 'drafting' }, now);
}

/** The composite a book detail view needs in one read: manifest + outline + timeline + chapters
 *  (`StoryBookBundle` — the IPC view type in schemas). */
export async function readBookBundle(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
): Promise<StoryBookBundle | null> {
  const manifest = await getBook(fs, key, personId, bookId);
  if (!manifest) return null;
  return {
    manifest,
    outline: await getOutline(fs, key, personId, bookId),
    timeline: await getTimeline(fs, key, personId, bookId),
    chapters: await listChapters(fs, key, personId, bookId),
  };
}

import { decryptBytes, encryptBytes, isEncryptedEnvelope } from '../crypto';
import type { FileSystem } from '../host';
import { uuid } from '../id';
import {
  BookChapterSchema,
  BookManifestSchema,
  BookOutlineSchema,
  ChapterMarkupSchema,
  ExclusionListSchema,
  LifeTimelineSchema,
  PublishedManifestSchema,
  StoryImageIndexSchema,
  StoryInterviewStateSchema,
  StoryProposalListSchema,
  StoryTodoListSchema,
  type BookChapter,
  type BookConfig,
  type BookManifest,
  type BookOutline,
  type BookTypeId,
  type ChapterMarkup,
  type ExclusionItem,
  type LifeTimeline,
  type PublishedManifest,
  type StoryBookBundle,
  type StoryImageEntry,
  type StoryImageIndex,
  type StoryInterviewState,
  type StoryProposalList,
  type StoryTodoList,
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
function publishedDir(personId: string, bookId: string): string {
  return `${bookDir(personId, bookId)}/published`;
}
function publishedManifestPath(personId: string, bookId: string): string {
  return `${publishedDir(personId, bookId)}/manifest.enc`;
}
function publishedChapterPath(personId: string, bookId: string, chapterId: string): string {
  return `${publishedDir(personId, bookId)}/${chapterId}.enc`;
}
function publishedImagesDir(personId: string, bookId: string): string {
  return `${publishedDir(personId, bookId)}/images`;
}
function publishedImageBytesPath(personId: string, bookId: string, imageId: string): string {
  return `${publishedImagesDir(personId, bookId)}/${imageId}.enc`;
}
function markupPath(personId: string, bookId: string, chapterId: string): string {
  return `${bookDir(personId, bookId)}/markup/${chapterId}.enc`;
}
function todosPath(personId: string, bookId: string): string {
  return `${bookDir(personId, bookId)}/todos.enc`;
}
function proposalsPath(personId: string, bookId: string): string {
  return `${bookDir(personId, bookId)}/proposals.enc`;
}
function interviewPath(personId: string, bookId: string): string {
  return `${bookDir(personId, bookId)}/interview.enc`;
}
function imagesDir(personId: string, bookId: string): string {
  return `${bookDir(personId, bookId)}/images`;
}
function imageIndexPath(personId: string, bookId: string): string {
  return `${imagesDir(personId, bookId)}/index.enc`;
}
function imageBytesPath(personId: string, bookId: string, imageId: string): string {
  return `${imagesDir(personId, bookId)}/${imageId}.enc`;
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
      | 'title'
      | 'config'
      | 'essence'
      | 'status'
      | 'coverImageId'
      | 'matter'
      | 'sharedWith'
      | 'publishedAt'
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

/** Clear the book's cover pointer (deleting the optional field cleanly — `updateBook`'s patch can't express
 *  "remove a field" under exactOptionalPropertyTypes). Used when the current cover image is deleted. */
export async function clearBookCover(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  now: Date,
): Promise<void> {
  const existing = await getBook(fs, key, personId, bookId);
  if (!existing?.coverImageId) return;
  const updated: BookManifest = { ...existing, updatedAt: now.toISOString() };
  delete updated.coverImageId;
  await saveManifest(fs, key, updated);
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

// --- Markup (the per-chapter suggestion layer) + the book-level to-do roll-up (§3.3) ---------------------

/** A chapter's markup layer, or an empty one when nothing's been marked up yet (never null — the caller
 *  always gets a valid layer to append to). */
export async function getMarkup(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  chapterId: string,
): Promise<ChapterMarkup> {
  const raw = await readEncryptedJson(fs, markupPath(personId, bookId, chapterId), key);
  return raw ? ChapterMarkupSchema.parse(raw) : { schemaVersion: 1, chapterId, marks: [] };
}

export async function saveMarkup(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  markup: ChapterMarkup,
): Promise<void> {
  await writeEncryptedJson(fs, markupPath(personId, bookId, markup.chapterId), markup, key);
}

/** The denormalized book-level to-do roll-up (§3.3.2) — one read for the overview "To do" list; the source of
 *  truth stays each chapter's markup. Empty (never null) when nothing's been added. */
export async function getTodos(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
): Promise<StoryTodoList> {
  const raw = await readEncryptedJson(fs, todosPath(personId, bookId), key);
  return raw ? StoryTodoListSchema.parse(raw) : { schemaVersion: 1, todos: [] };
}

export async function saveTodos(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  todos: StoryTodoList,
): Promise<void> {
  await writeEncryptedJson(fs, todosPath(personId, bookId), todos, key);
}

// --- Structural proposals (stored alongside the outline, §5.4) --------------------------------------------

export async function getProposals(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
): Promise<StoryProposalList> {
  const raw = await readEncryptedJson(fs, proposalsPath(personId, bookId), key);
  return raw ? StoryProposalListSchema.parse(raw) : { schemaVersion: 1, proposals: [] };
}

export async function saveProposals(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  list: StoryProposalList,
): Promise<void> {
  await writeEncryptedJson(fs, proposalsPath(personId, bookId), list, key);
}

// --- Interview state (the gap engine, §5.5) --------------------------------------------------------------

const EMPTY_INTERVIEW: StoryInterviewState = {
  schemaVersion: 1,
  askedPrompts: [],
  frameworkCoverage: {
    chapters: false,
    scenes: {},
    challenges: false,
    ideology: false,
    futureScript: false,
  },
  photoAnswers: [],
};

export async function getInterviewState(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
): Promise<StoryInterviewState> {
  const raw = await readEncryptedJson(fs, interviewPath(personId, bookId), key);
  return raw ? StoryInterviewStateSchema.parse(raw) : { ...EMPTY_INTERVIEW };
}

export async function saveInterviewState(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  state: StoryInterviewState,
): Promise<void> {
  await writeEncryptedJson(fs, interviewPath(personId, bookId), state, key);
}

/** Append a photo-elicited Q&A to the interview corpus (§3.7). The gap engine + generation read these. */
export async function addPhotoAnswer(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  answer: { imageId: string; question: string; answer: string },
  now: Date,
): Promise<void> {
  const state = await getInterviewState(fs, key, personId, bookId);
  await saveInterviewState(fs, key, personId, bookId, {
    ...state,
    photoAnswers: [...state.photoAnswers, { ...answer, at: now.toISOString() }],
  });
}

/** The photo Q&A answered so far (for the "Photos" panel). */
export async function getPhotoAnswers(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
): Promise<StoryInterviewState['photoAnswers']> {
  return (await getInterviewState(fs, key, personId, bookId)).photoAnswers;
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

// --- Published head (what readers see, §3.5) -------------------------------------------------------------

export async function savePublishedManifest(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  manifest: PublishedManifest,
): Promise<void> {
  await writeEncryptedJson(fs, publishedManifestPath(personId, bookId), manifest, key);
}

export async function getPublishedManifest(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
): Promise<PublishedManifest | null> {
  const raw = await readEncryptedJson(fs, publishedManifestPath(personId, bookId), key);
  return raw ? PublishedManifestSchema.parse(raw) : null;
}

export async function savePublishedChapter(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  chapter: BookChapter,
): Promise<void> {
  await writeEncryptedJson(fs, publishedChapterPath(personId, bookId, chapter.id), chapter, key);
}

export async function getPublishedChapter(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  chapterId: string,
): Promise<BookChapter | null> {
  const raw = await readEncryptedJson(fs, publishedChapterPath(personId, bookId, chapterId), key);
  return raw ? BookChapterSchema.parse(raw) : null;
}

/** Remove any previously-published chapter no longer in the new published set (a chapter un-reviewed since the
 *  last publish must not linger in the reader's head). */
export async function prunePublishedChapters(
  fs: FileSystem,
  personId: string,
  bookId: string,
  keepIds: Set<string>,
): Promise<void> {
  for (const name of await fs.list(publishedDir(personId, bookId))) {
    if (!name.endsWith('.enc') || name === 'manifest.enc') continue;
    const id = name.slice(0, -'.enc'.length);
    if (!keepIds.has(id)) await fs.remove(`${publishedDir(personId, bookId)}/${name}`);
  }
}

// --- Images (§3.8/§4.4) ----------------------------------------------------------------------------------

/** The book's image index (metadata for cover / illustrations / uploads). Empty when the book has none. */
export async function getStoryImageIndex(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
): Promise<StoryImageIndex> {
  const raw = await readEncryptedJson(fs, imageIndexPath(personId, bookId), key);
  return raw ? StoryImageIndexSchema.parse(raw) : { schemaVersion: 1, images: [] };
}

export async function saveStoryImageIndex(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  index: StoryImageIndex,
): Promise<void> {
  await writeEncryptedJson(fs, imageIndexPath(personId, bookId), index, key);
}

/** Encrypt + store an image's bytes at `images/<imageId>.enc` (the `08` §13.2 `encryptBytes` envelope). */
export async function saveStoryImageBytes(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  imageId: string,
  bytes: Uint8Array,
): Promise<void> {
  const envelope = await encryptBytes(bytes, key);
  await fs.writeAtomic(
    imageBytesPath(personId, bookId, imageId),
    new TextEncoder().encode(JSON.stringify(envelope)),
  );
}

/** Read + decrypt an image's bytes; null if absent or unreadable. */
export async function getStoryImageBytes(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  imageId: string,
): Promise<Uint8Array | null> {
  const raw = await fs.read(imageBytesPath(personId, bookId, imageId));
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(raw));
    if (!isEncryptedEnvelope(parsed)) return null;
    return await decryptBytes(parsed, key);
  } catch {
    return null;
  }
}

/** Store an uploaded photo (bytes already downscaled + EXIF-stripped in the renderer, spec 45): encrypt the
 *  bytes + add an `uploaded` index entry (optionally chapter-anchored). Returns the new entry. */
export async function addUploadedPhoto(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  photo: { bytes: Uint8Array; mime: string; chapterId?: string },
  now: Date,
): Promise<StoryImageEntry> {
  const imageId = uuid();
  await saveStoryImageBytes(fs, key, personId, bookId, imageId, photo.bytes);
  const entry: StoryImageEntry = {
    id: imageId,
    kind: 'uploaded',
    mime: photo.mime,
    createdAt: now.toISOString(),
    ...(photo.chapterId ? { chapterId: photo.chapterId } : {}),
  };
  const index = await getStoryImageIndex(fs, key, personId, bookId);
  await saveStoryImageIndex(fs, key, personId, bookId, {
    ...index,
    images: [...index.images, entry],
  });
  return entry;
}

/** Stamp a caption + vision notes onto an existing image's index entry (the photo Q&A analysis result). */
export async function setStoryImageAnalysis(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  imageId: string,
  analysis: { caption?: string; visionNotes?: string },
): Promise<void> {
  const index = await getStoryImageIndex(fs, key, personId, bookId);
  let changed = false;
  const images = index.images.map((img) => {
    if (img.id !== imageId) return img;
    changed = true;
    return {
      ...img,
      ...(analysis.caption !== undefined ? { caption: analysis.caption } : {}),
      ...(analysis.visionNotes !== undefined ? { visionNotes: analysis.visionNotes } : {}),
    };
  });
  if (changed) await saveStoryImageIndex(fs, key, personId, bookId, { ...index, images });
}

/** Remove an image's bytes AND its index entry (used by regenerate-cover cleanup + explicit delete). */
export async function removeStoryImage(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  imageId: string,
): Promise<void> {
  await fs.remove(imageBytesPath(personId, bookId, imageId));
  const index = await getStoryImageIndex(fs, key, personId, bookId);
  const next = index.images.filter((img) => img.id !== imageId);
  if (next.length !== index.images.length) {
    await saveStoryImageIndex(fs, key, personId, bookId, { ...index, images: next });
  }
}

// --- Published images (§3.8) — frozen bytes the reader/export use ---------------------------------------

/** Snapshot a draft image's bytes into the published head (`published/images/<id>.enc`) so a later draft edit
 *  never changes the shared book. No-op if the draft image is missing. */
export async function snapshotPublishedImage(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  imageId: string,
): Promise<void> {
  const bytes = await getStoryImageBytes(fs, key, personId, bookId, imageId);
  if (!bytes) return;
  const envelope = await encryptBytes(bytes, key);
  await fs.writeAtomic(
    publishedImageBytesPath(personId, bookId, imageId),
    new TextEncoder().encode(JSON.stringify(envelope)),
  );
}

/** Read a PUBLISHED image's bytes (the frozen snapshot); null if absent/unreadable. */
export async function getPublishedImageBytes(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  imageId: string,
): Promise<Uint8Array | null> {
  const raw = await fs.read(publishedImageBytesPath(personId, bookId, imageId));
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(raw));
    if (!isEncryptedEnvelope(parsed)) return null;
    return await decryptBytes(parsed, key);
  } catch {
    return null;
  }
}

/** Remove any published image no longer referenced by the new published head. */
export async function prunePublishedImages(
  fs: FileSystem,
  personId: string,
  bookId: string,
  keepIds: Set<string>,
): Promise<void> {
  for (const name of await fs.list(publishedImagesDir(personId, bookId))) {
    if (!name.endsWith('.enc')) continue;
    const id = name.slice(0, -'.enc'.length);
    if (!keepIds.has(id)) await fs.remove(`${publishedImagesDir(personId, bookId)}/${name}`);
  }
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

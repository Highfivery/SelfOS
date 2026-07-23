import { decryptBytes, encryptBytes, isEncryptedEnvelope } from '../crypto';
import type { FileSystem } from '../host';
import { uuid } from '../id';
import {
  BookChapterSchema,
  BookManifestSchema,
  BookOutlineSchema,
  ChapterHistorySchema,
  ChapterMarkupSchema,
  ExclusionListSchema,
  LifeTimelineSchema,
  PublishedManifestSchema,
  QuoteListSchema,
  StoryImageIndexSchema,
  StoryInterviewStateSchema,
  StoryProposalListSchema,
  StoryTodoListSchema,
  type BookChapter,
  type BookConfig,
  type BookManifest,
  type BookOutline,
  type BookTypeId,
  type ChapterHistory,
  type ChapterMarkup,
  type ChapterVersion,
  type ExclusionItem,
  type LifeTimeline,
  type PublishedManifest,
  type QuoteCandidate,
  type StoryBookBundle,
  type StoryImageEntry,
  type StoryImageIndex,
  type StoryInterviewState,
  type StoryProposalList,
  type StoryTodoList,
} from '../schemas';
import { readEncryptedJson, writeEncryptedJson } from '../vault';
import { enforceProtected } from './storyMarkup';
import { mergeGeneratedTimeline } from './storyTimeline';

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
function quotesPath(personId: string, bookId: string): string {
  return `${bookDir(personId, bookId)}/quotes.enc`;
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
/** Chapter version history lives in its OWN dir (not `chapters/`) so `listChapters`' `.enc` scan never
 *  tries to parse a history file as a chapter (one stray file must never brick the whole book). */
function historyDir(personId: string, bookId: string): string {
  return `${bookDir(personId, bookId)}/history`;
}
function chapterHistoryPath(personId: string, bookId: string, chapterId: string): string {
  return `${historyDir(personId, bookId)}/${chapterId}.enc`;
}
function archiveDir(personId: string, bookId: string): string {
  return `${bookDir(personId, bookId)}/archive`;
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
  const trimmedTitle = input.title.trim();
  const manifest: BookManifest = {
    id: uuid(),
    schemaVersion: 1,
    personId: input.personId,
    type: input.type,
    // A blank title means "let the biographer name it" (§3.2): stamp a placeholder + mark it auto so the
    // foundations pass overwrites it with a title drawn from the content. A supplied title is the person's own.
    title: trimmedTitle || 'Your Story',
    ...(trimmedTitle ? {} : { titleAuto: true }),
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
      | 'titleAuto'
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

/** Rewrite-from-scratch archives kept before the newest one drops off (each is a full drafted-state copy;
 *  three covers "I rewrote twice and want the original back" without unbounded growth). */
export const ARCHIVE_KEEP = 3;

/** Raw-copy one already-encrypted file (no decrypt — the bytes move verbatim). Missing source → no-op. */
async function copyRaw(fs: FileSystem, from: string, to: string): Promise<void> {
  const bytes = await fs.read(from);
  if (bytes) await fs.writeAtomic(to, bytes);
}

/**
 * Archive the whole drafted state (manifest incl. essence/title, outline, timeline, every chapter + its
 * version history) into `archive/<timestamp>/` before a from-scratch rewrite discards it (§13.9). Encrypted
 * bytes are copied verbatim — nothing is decrypted. Keeps the newest `ARCHIVE_KEEP` archives. There is no UI
 * over archives yet (deliberate: the safety net ships tonight, a browser can follow) — the data survives in
 * the vault either way.
 */
export async function archiveDraftState(
  fs: FileSystem,
  personId: string,
  bookId: string,
  now: Date,
): Promise<void> {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const dest = `${archiveDir(personId, bookId)}/${stamp}`;
  await copyRaw(fs, manifestPath(personId, bookId), `${dest}/book.enc`);
  await copyRaw(fs, outlinePath(personId, bookId), `${dest}/outline.enc`);
  await copyRaw(fs, timelinePath(personId, bookId), `${dest}/timeline.enc`);
  for (const name of await fs.list(chaptersDir(personId, bookId))) {
    if (!name.endsWith('.enc')) continue;
    await copyRaw(fs, `${chaptersDir(personId, bookId)}/${name}`, `${dest}/chapters/${name}`);
  }
  for (const name of await fs.list(historyDir(personId, bookId))) {
    if (!name.endsWith('.enc')) continue;
    await copyRaw(fs, `${historyDir(personId, bookId)}/${name}`, `${dest}/history/${name}`);
  }
  // Prune to the newest ARCHIVE_KEEP (the timestamp names sort lexicographically = chronologically).
  const archives = (await fs.list(archiveDir(personId, bookId))).sort();
  for (const old of archives.slice(0, Math.max(0, archives.length - ARCHIVE_KEEP))) {
    await fs.remove(`${archiveDir(personId, bookId)}/${old}`);
  }
}

/**
 * Rewrite a book from scratch (64 §13.6.6) — reset it to the pre-draft state so the standard full-draft flow
 * writes a fresh outline + fresh chapters. Returns the reset manifest, or null if the book is gone.
 *
 * KEEPS the person's investments: `config`, `title` (+ `titleAuto` — a never-renamed book may be re-titled by
 * the fresh foundations, exactly as at first draft), `matter`, uploaded photos + their captions + answers, the
 * cover, `exclusions`, and the interview state; the PUBLISHED head stays until they share again (readers keep
 * their copy). DISCARDS every chapter (and, with it, that chapter's protected blocks, pinned quotes, and image
 * placements — all chapter-bound), pending structural proposals, the essence, the outline + timeline, and every
 * AI-GENERATED illustration (uploaded photos and the cover are `kind:'uploaded'`/`'cover'`, so they survive).
 * No AI here — the caller re-runs the draft (the create-and-draft flow) afterwards.
 */
export async function rewriteBookFromScratch(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  now: Date,
): Promise<BookManifest | null> {
  const existing = await getBook(fs, key, personId, bookId);
  if (!existing) return null;

  // Drafts are sacred (§13.9): before anything is discarded, raw-copy the whole drafted state into
  // `archive/<timestamp>/` — a from-scratch rewrite must never be the irreversible destruction of a book the
  // person may have spent weeks shaping. Best-effort: an archive failure never blocks the rewrite itself.
  try {
    await archiveDraftState(fs, personId, bookId, now);
  } catch {
    // Archiving is a safety net over an explicitly-confirmed destructive action — proceed.
  }

  // Everything that describes the DRAFTED book. Removing the chapters folder also discards each chapter's
  // protected blocks / pinned quotes / image placements (they live on the chapter). `fs.remove` is a
  // recursive, force delete — tolerant of a path that isn't there.
  await fs.remove(chaptersDir(personId, bookId));
  await fs.remove(`${bookDir(personId, bookId)}/markup`);
  // Version history describes the discarded chapters — archived above, then dropped with them.
  await fs.remove(historyDir(personId, bookId));
  await fs.remove(proposalsPath(personId, bookId));
  await fs.remove(outlinePath(personId, bookId));
  // The chronology is THEIRS, not the draft's (§16.2): keep every moment the person added or corrected, and
  // drop only what the biographer proposed. Deleting the file outright was fine when the timeline was
  // invisible AI output — now it is user-authored content, and the confirm dialog promises it's kept.
  const chronology = await getTimeline(fs, key, personId, bookId);
  const mine = (chronology?.events ?? []).filter((event) => event.userEdited);
  if (mine.length > 0 || (chronology?.removed?.length ?? 0) > 0) {
    await saveTimeline(fs, key, personId, bookId, {
      schemaVersion: 1,
      events: mine,
      ...(chronology?.removed?.length ? { removed: chronology.removed } : {}),
    });
  } else {
    await fs.remove(timelinePath(personId, bookId));
  }
  // `todos.enc` is a DENORMALIZED roll-up keyed by chapterId (syncChapterTodos maintains it per chapter); the
  // fresh redraft makes new chapter ids with no marks, so without clearing it the roll-up would keep every
  // pre-rewrite to-do forever, each pointing at a deleted chapter (a phantom "Needs you" entry). To-dos are
  // markup, which we're discarding — so drop the roll-up too.
  await fs.remove(todosPath(personId, bookId));

  // Reap only AI-generated illustrations; keep uploaded photos + the cover.
  const index = await getStoryImageIndex(fs, key, personId, bookId);
  for (const img of index.images) {
    if (img.kind === 'generated') await removeStoryImage(fs, key, personId, bookId, img.id);
  }

  // Reset the manifest to the pre-draft state: no essence, status back to `outlining`. Cover / matter / config /
  // title (+ titleAuto) / sharedWith / publishedAt are untouched.
  const reset: BookManifest = { ...existing, status: 'outlining', updatedAt: now.toISOString() };
  delete reset.essence;
  await saveManifest(fs, key, reset);
  return reset;
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

export async function getQuotes(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
): Promise<QuoteCandidate[]> {
  const raw = await readEncryptedJson(fs, quotesPath(personId, bookId), key);
  return raw ? QuoteListSchema.parse(raw).items : [];
}

export async function saveQuotes(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  items: QuoteCandidate[],
): Promise<void> {
  await writeEncryptedJson(fs, quotesPath(personId, bookId), { schemaVersion: 1, items }, key);
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

/**
 * Delete a chapter's draft-head record, its markup and its version history (64 §16.1). Lossy by definition —
 * the caller confirms first. Tolerant of anything already absent, so a partial delete can be re-run.
 */
export async function deleteChapterRecord(
  fs: FileSystem,
  personId: string,
  bookId: string,
  chapterId: string,
): Promise<void> {
  for (const path of [
    chapterPath(personId, bookId, chapterId),
    markupPath(personId, bookId, chapterId),
    chapterHistoryPath(personId, bookId, chapterId),
  ]) {
    await fs.remove(path).catch(() => undefined);
  }
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

// --- Chapter version history (the draft vault, §13.9) ----------------------------------------------------

/** Superseded versions kept per chapter. 20 rewrites of a 5,000-word chapter ≈ a few hundred KB encrypted —
 *  bounded, and far past what anyone restores to in practice. The oldest drop off. */
export const CHAPTER_HISTORY_CAP = 20;

/** A chapter's archived versions (oldest→newest). Empty (never null) when nothing's been superseded yet. */
export async function getChapterHistory(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  chapterId: string,
): Promise<ChapterHistory> {
  const raw = await readEncryptedJson(fs, chapterHistoryPath(personId, bookId, chapterId), key);
  return raw ? ChapterHistorySchema.parse(raw) : { schemaVersion: 1, chapterId, versions: [] };
}

/**
 * Archive the version a rewrite/revision/restore is about to replace (§13.9). Every path that overwrites a
 * chapter's non-empty prose calls this FIRST, so no text the person has seen is ever silently destroyed.
 * Capped: past `CHAPTER_HISTORY_CAP` the oldest versions drop off.
 */
export async function appendChapterVersion(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  chapterId: string,
  version: ChapterVersion,
): Promise<void> {
  const history = await getChapterHistory(fs, key, personId, bookId, chapterId);
  const versions = [...history.versions, version].slice(-CHAPTER_HISTORY_CAP);
  await writeEncryptedJson(
    fs,
    chapterHistoryPath(personId, bookId, chapterId),
    { ...history, chapterId, versions },
    key,
  );
}

/**
 * Restore an archived version (§13.9): the CURRENT prose is archived first (reason `restore` — restoring is
 * itself undoable), then the chapter takes the version's markdown + provenance + signature as a NEW revision
 * (`status: 'updated'`, so the review flow sees it like any other change; `previousMarkdown` = the replaced
 * text so the ribbon's What-changed diff shows exactly what the restore changed). Protected blocks + pinned
 * quotes are re-enforced against the restored text — a block added AFTER that version was archived must still
 * survive. Returns the restored chapter, or null when the chapter/version is gone.
 */
export async function restoreChapterVersion(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  chapterId: string,
  revision: number,
  now: Date,
): Promise<BookChapter | null> {
  const current = await getChapter(fs, key, personId, bookId, chapterId);
  if (!current) return null;
  const history = await getChapterHistory(fs, key, personId, bookId, chapterId);
  const version = history.versions.find((v) => v.revision === revision);
  if (!version) return null;
  if (current.markdown.trim().length > 0) {
    await appendChapterVersion(fs, key, personId, bookId, chapterId, {
      revision: current.revision,
      markdown: current.markdown,
      provenance: current.provenance,
      sourceSignature: current.sourceSignature,
      savedAt: now.toISOString(),
      reason: 'restore',
    });
  }
  const enforced = enforceProtected(
    version.markdown,
    current.protectedBlocks,
    current.pinnedQuotes,
  );
  const restored: BookChapter = {
    ...current,
    markdown: enforced.markdown,
    revision: current.revision + 1,
    status: 'updated',
    provenance: version.provenance,
    sourceSignature: version.sourceSignature,
    lastGeneratedAt: now.toISOString(),
    previousMarkdown: current.markdown,
  };
  await saveChapter(fs, key, personId, bookId, restored);
  return restored;
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
 *  `outlining` — the person reviews/edits the outline, then approves it (`approveOutline`). When the title is
 *  still auto (the person left it blank, §3.2), the AI-proposed `title` is stamped onto the manifest; a title
 *  the person chose is never overwritten. */
export async function applyFoundations(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  foundations: { title?: string; essence: string; outline: BookOutline; timeline: LifeTimeline },
  now: Date,
): Promise<BookManifest | null> {
  const existing = await getBook(fs, key, personId, bookId);
  if (!existing) return null;
  const proposedTitle = foundations.title?.trim();
  const setTitle = existing.titleAuto === true && proposedTitle ? { title: proposedTitle } : {};
  const manifest = await updateBook(
    fs,
    key,
    personId,
    bookId,
    { essence: foundations.essence, ...setTitle },
    now,
  );
  if (!manifest) return null;
  await saveOutline(fs, key, personId, bookId, { ...foundations.outline, approved: false });
  // Fold the generated chronology into the stored one, KEEPING every hand-edited moment (§16.2): a person
  // who corrected a date must never have that correction quietly reverted by a later pass. This is the
  // promise `TimelineEvent.userEdited` has always encoded — until now nothing honoured it.
  await saveTimeline(
    fs,
    key,
    personId,
    bookId,
    mergeGeneratedTimeline(
      await getTimeline(fs, key, personId, bookId),
      foundations.timeline.events,
    ),
  );
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

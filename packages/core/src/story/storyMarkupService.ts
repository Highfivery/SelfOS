import type { FileSystem } from '../host';
import {
  ChapterMarkupSchema,
  type BookChapter,
  type ChapterMarkup,
  type MarkupMark,
  type PinnedQuote,
  type StoryMarkPatch,
  type StoryTodoEntry,
  type TextAnchor,
} from '../schemas';
import { applyInlineEdit, pinQuote } from './storyMarkup';
import {
  getChapter,
  getMarkup,
  getTodos,
  saveChapter,
  saveMarkup,
  saveTodos,
} from './storyService';

/**
 * Non-AI persistence for the markup layer (64-your-story §3.3) — the wrappers the renderer/bridge call to add,
 * edit, and undo marks, plus the two INSTANT ops (inline edit → protected block, pin) that transform + save a
 * chapter with no model call. The AI batch revision (`applyMarkup`) lives in `storyGenerationService`; this is
 * everything around it. Every mark mutation keeps the book-level to-do roll-up in sync (§3.3.2).
 */

/** Rebuild the book-level to-do roll-up entries for ONE chapter from its markup, replacing that chapter's
 *  prior entries (the source of truth stays the chapter's markup; this denormalized copy is the overview's
 *  one-read list). Called by every write here AND by `applyMarkup` (which stamps `ask` to-dos applied), so the
 *  roll-up never drifts from the chapters' markup regardless of which path mutated a mark. */
export async function syncChapterTodos(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  chapterId: string,
  marks: MarkupMark[],
): Promise<void> {
  const roll = await getTodos(fs, key, personId, bookId);
  const others = roll.todos.filter((t) => t.chapterId !== chapterId);
  const mine: StoryTodoEntry[] = marks
    .filter((m): m is Extract<MarkupMark, { kind: 'todo' }> => m.kind === 'todo')
    .map((m) => ({
      id: m.id,
      chapterId,
      kind: m.todoKind,
      text: m.text,
      status: m.status,
      createdAt: m.createdAt,
    }));
  await saveTodos(fs, key, personId, bookId, {
    schemaVersion: 1,
    todos: [...others, ...mine],
  });
}

async function writeMarks(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  chapterId: string,
  marks: MarkupMark[],
): Promise<ChapterMarkup> {
  const markup: ChapterMarkup = ChapterMarkupSchema.parse({ schemaVersion: 1, chapterId, marks });
  await saveMarkup(fs, key, personId, bookId, markup);
  await syncChapterTodos(fs, key, personId, bookId, chapterId, markup.marks);
  return markup;
}

/** Add a mark (comment · delete · to-do) to a chapter's suggestion layer. */
export async function addMark(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  chapterId: string,
  mark: MarkupMark,
): Promise<ChapterMarkup> {
  const markup = await getMarkup(fs, key, personId, bookId, chapterId);
  return writeMarks(fs, key, personId, bookId, chapterId, [...markup.marks, mark]);
}

/** Remove a mark (undo before apply). No-op if the id isn't present. */
export async function removeMark(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  chapterId: string,
  markId: string,
): Promise<ChapterMarkup> {
  const markup = await getMarkup(fs, key, personId, bookId, chapterId);
  return writeMarks(
    fs,
    key,
    personId,
    bookId,
    chapterId,
    markup.marks.filter((m) => m.id !== markId),
  );
}

/** Update a mark in place (edit a comment's text, undo a delete, mark a to-do done, attach an assignment).
 *  Returns the updated markup, or null when the mark isn't found OR the patch is invalid for the mark's kind
 *  (e.g. a to-do status onto a delete) — the schema re-validates on write, and an invalid combination degrades
 *  to null rather than throwing, so a bad renderer patch can never become an unhandled rejection. */
export async function updateMark(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  chapterId: string,
  markId: string,
  patch: StoryMarkPatch,
): Promise<ChapterMarkup | null> {
  const markup = await getMarkup(fs, key, personId, bookId, chapterId);
  if (!markup.marks.some((m) => m.id === markId)) return null;
  const marks = markup.marks.map((m) =>
    m.id === markId
      ? ({
          ...m,
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.text !== undefined ? { text: patch.text } : {}),
          ...(patch.assignmentId !== undefined ? { assignmentId: patch.assignmentId } : {}),
        } as MarkupMark)
      : m,
  );
  // Guard the patch is valid for the mark's kind BEFORE writing (discriminatedUnion validates status↔kind).
  if (!ChapterMarkupSchema.safeParse({ schemaVersion: 1, chapterId, marks }).success) return null;
  return writeMarks(fs, key, personId, bookId, chapterId, marks);
}

/** INSTANT inline edit (§3.3): replace the anchored span with the person's own words + record it as a
 *  protected block, then persist. Returns the updated chapter, or null if the anchor is orphaned or the
 *  chapter is gone. */
export async function editPassage(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  chapterId: string,
  anchor: TextAnchor,
  newText: string,
): Promise<BookChapter | null> {
  const chapter = await getChapter(fs, key, personId, bookId, chapterId);
  if (!chapter) return null;
  const edited = applyInlineEdit(chapter, anchor, newText);
  if (!edited) return null;
  await saveChapter(fs, key, personId, bookId, edited);
  return edited;
}

/** INSTANT pin (§3.3): mark a passage untouchable "in your own words", then persist. */
export async function pinPassage(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  chapterId: string,
  anchor: TextAnchor,
  text: string,
  sourceRef?: PinnedQuote['sourceRef'],
): Promise<BookChapter | null> {
  const chapter = await getChapter(fs, key, personId, bookId, chapterId);
  if (!chapter) return null;
  const pinned = pinQuote(chapter, anchor, text, sourceRef);
  if (!pinned) return null;
  await saveChapter(fs, key, personId, bookId, pinned);
  return pinned;
}

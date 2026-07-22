import { uuid } from '../id';
import type { FileSystem } from '../host';
import type { BookChapter, BookOutline, OutlineChapter, OutlinePart } from '../schemas';
import {
  appendChapterVersion,
  getChapter,
  getChapterHistory,
  getMarkup,
  getOutline,
  getStoryImageIndex,
  saveChapter,
  saveMarkup,
  saveOutline,
  saveStoryImageIndex,
  deleteChapterRecord as removeChapterRecord,
} from './storyService';
import { syncChapterTodos } from './storyMarkupService';

/**
 * Manual outline control (64 §16.1) — the deterministic, **AI-free** outline mutations.
 *
 * Every one of these already existed inside `applyStructuralProposal`, reachable ONLY by approving an AI
 * proposal: a person who knows their own life better than the model couldn't move a chapter without asking
 * the model to suggest it (#291). They live here so the proposal path and the manual path share ONE
 * implementation of the invariants rather than drifting:
 *
 *  - **Order is consistent by construction.** Every mutation re-numbers its part's chapters and re-syncs the
 *    draft-head records, so an edit can never leave a chapter double-ordered or pointing at the wrong part.
 *  - **Drafted prose is never silently destroyed** (§13.9). Delete is the only discarding operation and the
 *    UI confirms it; a MERGE concatenates both chapters' prose (and carries the person's protected blocks,
 *    pinned quotes and image placements) instead of dropping the second chapter's writing.
 *  - **Staleness reflects what actually changed.** A split or merge stales the affected chapters (their
 *    prose no longer matches their brief); a rename or reorder does NOT — the material didn't change, and
 *    staling would provoke a pointless metered rewrite.
 *
 * No AI, no metering, no new storage.
 */

/** The outcome of a manual outline edit — never throws on a vanished id, so a stale UI degrades honestly. */
export interface OutlineEditResult {
  ok: boolean;
  message?: string;
}

const NOT_FOUND_CHAPTER = 'That chapter is no longer in the outline.';
const NOT_FOUND_PART = 'That part is no longer in the outline.';

/** A fresh, unwritten chapter record for a newly-outlined chapter (`stale` = "needs writing"). */
export function chapterShell(
  id: string,
  partId: string,
  order: number,
  title: string,
): BookChapter {
  return {
    id,
    schemaVersion: 1,
    partId,
    order,
    title,
    markdown: '',
    revision: 0,
    status: 'stale',
    sourceSignature: '',
    provenance: [],
    protectedBlocks: [],
    pinnedQuotes: [],
    imagePlacements: [],
  };
}

/** Re-sync every existing draft-head chapter in a part to the outline's order (an insert/reorder shifts them). */
export async function syncPartChapterOrder(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  part: { id: string; chapters: OutlineChapter[] },
): Promise<void> {
  for (let i = 0; i < part.chapters.length; i += 1) {
    const oc = part.chapters[i]!;
    const bc = await getChapter(fs, key, personId, bookId, oc.id);
    if (bc && (bc.order !== i || bc.partId !== part.id)) {
      await saveChapter(fs, key, personId, bookId, { ...bc, order: i, partId: part.id });
    }
  }
}

/**
 * Forget a chapter completely: its record, markup and history (via `removeChapterRecord`) PLUS the two
 * denormalized places that would otherwise keep pointing at it — the book-level to-do roll-up (a phantom
 * "Needs you" entry that nothing could ever clear, since its markup file is gone) and the image index.
 * Every removal path goes through here, so none of them can forget half the job.
 */
async function forgetChapter(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  bookIdChapter: string,
): Promise<void> {
  await syncChapterTodos(fs, key, personId, bookId, bookIdChapter, []);
  const index = await getStoryImageIndex(fs, key, personId, bookId);
  if (index?.images.some((img) => img.chapterId === bookIdChapter)) {
    await saveStoryImageIndex(fs, key, personId, bookId, {
      ...index,
      images: index.images.filter((img) => img.chapterId !== bookIdChapter),
    });
  }
  await removeChapterRecord(fs, personId, bookId, bookIdChapter);
}

/** Renumber a part's chapters to their array position (the one place `order` is assigned). */
function renumber(part: OutlinePart): void {
  part.chapters.forEach((c, i) => {
    c.order = i;
  });
}

/** Locate a chapter and its owning part. */
function findChapter(
  outline: BookOutline,
  chapterId: string,
): { part: OutlinePart; index: number } | null {
  for (const part of outline.parts) {
    const index = part.chapters.findIndex((c) => c.id === chapterId);
    if (index >= 0) return { part, index };
  }
  return null;
}

/** Read the outline, run `edit` against it, and persist — the shared shape of every mutation below. */
async function withOutline(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  edit: (outline: BookOutline) => Promise<OutlineEditResult>,
): Promise<OutlineEditResult> {
  const outline = await getOutline(fs, key, personId, bookId);
  if (!outline) return { ok: false, message: 'This book has no outline yet.' };
  return edit(outline);
}

/** Add an empty part at the end of the book. */
export async function addPart(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  args: { title: string },
): Promise<OutlineEditResult> {
  const title = args.title.trim();
  if (!title) return { ok: false, message: 'A part needs a title.' };
  return withOutline(fs, key, personId, bookId, async (outline) => {
    outline.parts.push({ id: uuid(), title, chapters: [] });
    await saveOutline(fs, key, personId, bookId, outline);
    return { ok: true };
  });
}

/** Rename a part. Purely a label — nothing stales. */
export async function renamePart(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  args: { partId: string; title: string },
): Promise<OutlineEditResult> {
  const title = args.title.trim();
  if (!title) return { ok: false, message: 'A part needs a title.' };
  return withOutline(fs, key, personId, bookId, async (outline) => {
    const part = outline.parts.find((p) => p.id === args.partId);
    if (!part) return { ok: false, message: NOT_FOUND_PART };
    part.title = title;
    await saveOutline(fs, key, personId, bookId, outline);
    return { ok: true };
  });
}

/**
 * Delete a part **and every chapter in it** — lossy, so the caller confirms first (§16.1). Refuses to remove
 * the last part, since a book with no parts has nowhere to put a chapter.
 */
export async function deletePart(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  args: { partId: string },
): Promise<OutlineEditResult> {
  return withOutline(fs, key, personId, bookId, async (outline) => {
    const index = outline.parts.findIndex((p) => p.id === args.partId);
    if (index < 0) return { ok: false, message: NOT_FOUND_PART };
    if (outline.parts.length === 1) {
      return { ok: false, message: 'A book needs at least one part.' };
    }
    const [removed] = outline.parts.splice(index, 1);
    await saveOutline(fs, key, personId, bookId, outline);
    for (const chapter of removed?.chapters ?? []) {
      await forgetChapter(fs, key, personId, bookId, chapter.id);
    }
    return { ok: true };
  });
}

/** Add a chapter to a part, after `afterChapterId` when given (else at the end). */
export async function addChapter(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  args: {
    partId: string;
    title: string;
    brief?: string | undefined;
    afterChapterId?: string | undefined;
  },
): Promise<OutlineEditResult> {
  const title = args.title.trim();
  if (!title) return { ok: false, message: 'A chapter needs a title.' };
  return withOutline(fs, key, personId, bookId, async (outline) => {
    const part = outline.parts.find((p) => p.id === args.partId);
    if (!part) return { ok: false, message: NOT_FOUND_PART };
    const at = args.afterChapterId
      ? part.chapters.findIndex((c) => c.id === args.afterChapterId)
      : -1;
    const insertAt = at >= 0 ? at + 1 : part.chapters.length;
    const id = uuid();
    part.chapters.splice(insertAt, 0, {
      id,
      title,
      brief: args.brief?.trim() ?? '',
      lifeAreas: [],
      order: insertAt,
    });
    renumber(part);
    await saveOutline(fs, key, personId, bookId, outline);
    await saveChapter(fs, key, personId, bookId, chapterShell(id, part.id, insertAt, title));
    await syncPartChapterOrder(fs, key, personId, bookId, part);
    return { ok: true };
  });
}

/**
 * Rename a chapter (and optionally re-word its brief). The title change is mirrored onto the draft-head
 * record so the Chapters grid and the reader agree. A rename does NOT stale the chapter — the prose is still
 * the prose. Changing the BRIEF does, because the brief is what the next write is measured against.
 */
export async function renameChapter(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  args: { chapterId: string; title: string; brief?: string | undefined },
): Promise<OutlineEditResult> {
  const title = args.title.trim();
  if (!title) return { ok: false, message: 'A chapter needs a title.' };
  return withOutline(fs, key, personId, bookId, async (outline) => {
    const found = findChapter(outline, args.chapterId);
    if (!found) return { ok: false, message: NOT_FOUND_CHAPTER };
    const oc = found.part.chapters[found.index]!;
    const briefChanged = args.brief !== undefined && args.brief.trim() !== oc.brief;
    oc.title = title;
    if (args.brief !== undefined) oc.brief = args.brief.trim();
    await saveOutline(fs, key, personId, bookId, outline);
    const bc = await getChapter(fs, key, personId, bookId, args.chapterId);
    if (bc) {
      await saveChapter(fs, key, personId, bookId, {
        ...bc,
        title,
        // Only a re-worded brief changes what the chapter is SUPPOSED to say; a retitle doesn't.
        ...(briefChanged && bc.markdown.trim() ? { status: 'stale' as const } : {}),
      });
    }
    return { ok: true };
  });
}

/**
 * Move a chapter within its part or to another part, landing at `toIndex` (clamped). Reordering never
 * stales: the chapter says what it always said, it just sits somewhere else.
 */
export async function moveChapter(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  args: { chapterId: string; toPartId: string; toIndex: number },
): Promise<OutlineEditResult> {
  return withOutline(fs, key, personId, bookId, async (outline) => {
    const found = findChapter(outline, args.chapterId);
    if (!found) return { ok: false, message: NOT_FOUND_CHAPTER };
    const target = outline.parts.find((p) => p.id === args.toPartId);
    if (!target) return { ok: false, message: NOT_FOUND_PART };

    const [moved] = found.part.chapters.splice(found.index, 1);
    if (!moved) return { ok: false, message: NOT_FOUND_CHAPTER };
    const index = Math.max(0, Math.min(Math.trunc(args.toIndex), target.chapters.length));
    target.chapters.splice(index, 0, moved);
    renumber(found.part);
    if (target !== found.part) renumber(target);
    await saveOutline(fs, key, personId, bookId, outline);
    await syncPartChapterOrder(fs, key, personId, bookId, found.part);
    if (target !== found.part) await syncPartChapterOrder(fs, key, personId, bookId, target);
    return { ok: true };
  });
}

/**
 * Split one chapter into two. The original keeps its prose (now stale — it's meant to say less), and the new
 * sibling is an unwritten shell, exactly as the AI `splitChapter` proposal has always done.
 */
export async function splitChapter(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  args: {
    chapterId: string;
    firstTitle: string;
    secondTitle: string;
    firstBrief?: string | undefined;
    secondBrief?: string | undefined;
  },
): Promise<OutlineEditResult> {
  const firstTitle = args.firstTitle.trim();
  const secondTitle = args.secondTitle.trim();
  if (!firstTitle || !secondTitle) return { ok: false, message: 'Both chapters need a title.' };
  return withOutline(fs, key, personId, bookId, async (outline) => {
    const found = findChapter(outline, args.chapterId);
    if (!found) return { ok: false, message: NOT_FOUND_CHAPTER };
    const { part, index } = found;
    const original = part.chapters[index]!;
    original.title = firstTitle;
    // Narrowing the first half's brief is what makes the split meaningful — without it the chapter is
    // still SUPPOSED to say everything it already says, so a rewrite would just reproduce it.
    const narrowed = args.firstBrief !== undefined && args.firstBrief.trim() !== original.brief;
    if (args.firstBrief !== undefined) original.brief = args.firstBrief.trim();
    const secondId = uuid();
    part.chapters.splice(index + 1, 0, {
      id: secondId,
      title: secondTitle,
      brief: args.secondBrief?.trim() ?? '',
      ...(original.eraFrom ? { eraFrom: original.eraFrom } : {}),
      ...(original.eraTo ? { eraTo: original.eraTo } : {}),
      lifeAreas: original.lifeAreas,
      order: index + 1,
    });
    renumber(part);
    await saveOutline(fs, key, personId, bookId, outline);
    const bc = await getChapter(fs, key, personId, bookId, args.chapterId);
    if (bc) {
      await saveChapter(fs, key, personId, bookId, {
        ...bc,
        title: firstTitle,
        // Stale ONLY when the brief narrowed: written prose now covers more than the chapter is meant to,
        // so the next pass has something new to aim at. A title-only split changes nothing to rewrite
        // against, and staling would provoke a metered rewrite that reproduces the same chapter (§16.1).
        ...(narrowed && bc.markdown.trim() ? { status: 'stale' as const } : {}),
      });
    }
    await saveChapter(
      fs,
      key,
      personId,
      bookId,
      chapterShell(secondId, part.id, index + 1, secondTitle),
    );
    await syncPartChapterOrder(fs, key, personId, bookId, part);
    return { ok: true };
  });
}

/**
 * Merge `chapterId` INTO `intoChapterId`, then remove the source from the outline.
 *
 * The prose is **concatenated, never discarded** (§13.9 — drafts are sacred): the merged chapter keeps both
 * texts, and the person's protected blocks, pinned quotes and image placements come across with them (all
 * three anchor by quote/paragraph text, which survives concatenation verbatim). The result is stale, since
 * two chapters' prose stitched together is not yet one chapter's writing.
 */
export async function mergeChapters(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  args: { chapterId: string; intoChapterId: string; title?: string | undefined },
): Promise<OutlineEditResult> {
  if (args.chapterId === args.intoChapterId) {
    return { ok: false, message: 'Pick two different chapters to merge.' };
  }
  return withOutline(fs, key, personId, bookId, async (outline) => {
    const source = findChapter(outline, args.chapterId);
    const target = findChapter(outline, args.intoChapterId);
    if (!source || !target) return { ok: false, message: NOT_FOUND_CHAPTER };

    const sourceOutline = source.part.chapters[source.index]!;
    const targetOutline = target.part.chapters[target.index]!;
    const title = args.title?.trim() || targetOutline.title;

    const sourceChapter = await getChapter(fs, key, personId, bookId, args.chapterId);
    const targetChapter = await getChapter(fs, key, personId, bookId, args.intoChapterId);

    // Outline: the target absorbs the source's brief + life areas, then the source is removed.
    targetOutline.title = title;
    targetOutline.brief = [targetOutline.brief, sourceOutline.brief]
      .map((b) => b.trim())
      .filter(Boolean)
      .join('\n\n');
    targetOutline.lifeAreas = [
      ...new Set([...targetOutline.lifeAreas, ...sourceOutline.lifeAreas]),
    ];
    if (sourceOutline.eraFrom && !targetOutline.eraFrom)
      targetOutline.eraFrom = sourceOutline.eraFrom;
    if (sourceOutline.eraTo) targetOutline.eraTo = sourceOutline.eraTo;
    source.part.chapters.splice(source.index, 1);
    renumber(source.part);
    if (target.part !== source.part) renumber(target.part);
    await saveOutline(fs, key, personId, bookId, outline);

    // The target may be OUTLINED BUT NEVER DRAFTED (no record yet — routine after a budget-stopped draft
    // pass), so start from a shell rather than skipping the write: skipping it would delete the source
    // below and take its prose with it, while reporting success. That is the exact §13.9 loss this op
    // exists to prevent.
    const base =
      targetChapter ?? chapterShell(args.intoChapterId, target.part.id, target.index, title);
    const bothTexts = [base.markdown, sourceChapter?.markdown ?? '']
      .map((m) => m.trim())
      .filter(Boolean);
    await saveChapter(fs, key, personId, bookId, {
      ...base,
      title,
      markdown: bothTexts.join('\n\n'),
      provenance: [...base.provenance, ...(sourceChapter?.provenance ?? [])],
      protectedBlocks: [...base.protectedBlocks, ...(sourceChapter?.protectedBlocks ?? [])],
      pinnedQuotes: [...base.pinnedQuotes, ...(sourceChapter?.pinnedQuotes ?? [])],
      imagePlacements: [...base.imagePlacements, ...(sourceChapter?.imagePlacements ?? [])],
      // The kept `previousMarkdown` described a pre-rewrite version of the TARGET alone, so diffing the
      // merged text against it would show the whole source chapter as an "edit". Drop it.
      previousMarkdown: undefined,
      // Two chapters' prose stitched together isn't one chapter's writing yet.
      ...(bothTexts.length > 0 ? { status: 'stale' as const } : {}),
    });

    // The source's MARKS anchor to prose that survives verbatim into the merged chapter (the same argument
    // that carries protected blocks + pins), so carry them over rather than deleting the person's comments
    // and to-dos; its superseded drafts join the target's history too, newest last, capped as ever.
    const sourceMarks = (await getMarkup(fs, key, personId, bookId, args.chapterId))?.marks ?? [];
    if (sourceMarks.length > 0) {
      const targetMarkup = await getMarkup(fs, key, personId, bookId, args.intoChapterId);
      const marks = [...(targetMarkup?.marks ?? []), ...sourceMarks];
      await saveMarkup(fs, key, personId, bookId, {
        schemaVersion: 1,
        chapterId: args.intoChapterId,
        marks,
      });
      await syncChapterTodos(fs, key, personId, bookId, args.intoChapterId, marks);
    }
    const sourceVersions = (await getChapterHistory(fs, key, personId, bookId, args.chapterId))
      .versions;
    for (const version of sourceVersions) {
      // Reuse the audited append (it owns the CHAPTER_HISTORY_CAP trim) rather than writing history by hand.
      await appendChapterVersion(fs, key, personId, bookId, args.intoChapterId, version);
    }
    await forgetChapter(fs, key, personId, bookId, args.chapterId);
    await syncPartChapterOrder(fs, key, personId, bookId, source.part);
    if (target.part !== source.part) {
      await syncPartChapterOrder(fs, key, personId, bookId, target.part);
    }
    return { ok: true };
  });
}

/** Remove a chapter and its prose — lossy, so the caller confirms first (§16.1). */
export async function deleteChapter(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  args: { chapterId: string },
): Promise<OutlineEditResult> {
  return withOutline(fs, key, personId, bookId, async (outline) => {
    const found = findChapter(outline, args.chapterId);
    if (!found) return { ok: false, message: NOT_FOUND_CHAPTER };
    found.part.chapters.splice(found.index, 1);
    renumber(found.part);
    await saveOutline(fs, key, personId, bookId, outline);
    await forgetChapter(fs, key, personId, bookId, args.chapterId);
    await syncPartChapterOrder(fs, key, personId, bookId, found.part);
    return { ok: true };
  });
}

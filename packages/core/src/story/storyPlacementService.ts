import { runClaude, type AiDeps } from '../questionnaires/aiCall';
import type { FileSystem } from '../host';
import type { BookChapter, ImagePlacement } from '../schemas';
import { chapterParagraphs } from './storyText';
import { getChapter, getStoryImageIndex, saveChapter } from './storyService';

/**
 * Your Story image placement (64-your-story §3.8, Phase H3). A cover / illustration / uploaded photo can be
 * anchored INTO a chapter's prose — after a specific paragraph — so the reader view + export interleave it
 * (owner decision 2026-07-16: **AI-suggested anchor**, the author accepts or moves it). A placement lives on
 * `BookChapter.imagePlacements` ({imageId, afterAnchor `p<index>`, caption}). The suggestion is one small
 * metered call; setting/moving/removing is instant + no-AI. Placements are deduped by imageId (one spot per
 * image per chapter).
 */

/** The anchor for "after the Nth paragraph" — mirrors the provenance `p<index>` convention. */
export function paragraphAnchor(index: number): string {
  return `p${index}`;
}

/** Parse a `p<index>` anchor back to its 0-based index; null if malformed. */
export function anchorIndex(anchor: string): number | null {
  const m = /^p(\d+)$/.exec(anchor);
  return m ? Number(m[1]) : null;
}

/**
 * Ask Claude which paragraph an image best follows (§3.8, AI-suggested anchor). Reads the chapter's paragraphs
 * + the image's caption/vision notes, returns a `p<index>` anchor clamped to the chapter. A failed/AI-off call
 * is surfaced honestly so the caller can still place it manually (never a dead-end).
 */
export async function suggestImagePlacement(
  deps: AiDeps,
  args: { bookId: string; chapterId: string; imageId: string },
): Promise<{ ok: true; afterAnchor: string } | { ok: false; reason: string; message: string }> {
  const chapter = await getChapter(deps.fs, deps.key, deps.personId, args.bookId, args.chapterId);
  if (!chapter)
    return { ok: false, reason: 'ERROR', message: 'That chapter could no longer be found.' };
  const paras = chapterParagraphs(chapter.markdown);
  if (paras.length === 0) return { ok: true, afterAnchor: paragraphAnchor(0) };

  const index = await getStoryImageIndex(deps.fs, deps.key, deps.personId, args.bookId);
  const entry = index.images.find((i) => i.id === args.imageId);
  const label = entry?.caption || entry?.visionNotes || 'an image for this chapter';

  const system =
    'You place an image within a book chapter. Given the numbered paragraphs and the image caption, reply with ' +
    'ONLY the number of the paragraph the image should appear AFTER (0-based). No words, just the number.';
  const user = [
    `Image caption: ${label}`,
    'Paragraphs:',
    ...paras.map((p, i) => `${i}. ${p.slice(0, 240)}`),
  ].join('\n');

  const call = await runClaude(deps, system, user, 'story.vision', 20);
  if (!call.ok) return { ok: false, reason: call.reason, message: call.message };

  const parsed = Number.parseInt(call.text.trim().match(/\d+/)?.[0] ?? '', 10);
  const clamped = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), paras.length - 1) : 0;
  return { ok: true, afterAnchor: paragraphAnchor(clamped) };
}

/**
 * Place (or move) an image within a chapter: upsert a placement deduped by imageId. The image must exist in the
 * book's index; the anchor is clamped to a valid paragraph. Instant + no-AI. Returns the updated chapter.
 */
export async function setImagePlacement(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  chapterId: string,
  placement: { imageId: string; afterAnchor: string; caption?: string },
): Promise<BookChapter | null> {
  const chapter = await getChapter(fs, key, personId, bookId, chapterId);
  if (!chapter) return null;
  const index = await getStoryImageIndex(fs, key, personId, bookId);
  if (!index.images.some((i) => i.id === placement.imageId)) return null; // unknown image

  // Clamp the anchor to a real paragraph (never persist an off-the-end anchor).
  const paras = chapterParagraphs(chapter.markdown);
  const idx = anchorIndex(placement.afterAnchor);
  const safeAnchor = paragraphAnchor(
    idx === null ? 0 : Math.min(Math.max(idx, 0), Math.max(paras.length - 1, 0)),
  );

  const next: ImagePlacement = {
    imageId: placement.imageId,
    afterAnchor: safeAnchor,
    caption: placement.caption ?? '',
  };
  const others = chapter.imagePlacements.filter((p) => p.imageId !== placement.imageId);
  const updated: BookChapter = { ...chapter, imagePlacements: [...others, next] };
  await saveChapter(fs, key, personId, bookId, updated);
  return updated;
}

/** Remove an image's placement from a chapter (the image itself is untouched). Returns the updated chapter. */
export async function removeImagePlacement(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  chapterId: string,
  imageId: string,
): Promise<BookChapter | null> {
  const chapter = await getChapter(fs, key, personId, bookId, chapterId);
  if (!chapter) return null;
  const remaining = chapter.imagePlacements.filter((p) => p.imageId !== imageId);
  if (remaining.length === chapter.imagePlacements.length) return chapter;
  const updated: BookChapter = { ...chapter, imagePlacements: remaining };
  await saveChapter(fs, key, personId, bookId, updated);
  return updated;
}

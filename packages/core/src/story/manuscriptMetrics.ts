import type { BookChapter } from '../schemas';
import { countWords } from './storyText';

/**
 * Manuscript metrics for Your Story (64-your-story §16.5, #301) — a deterministic, AI-free read of how long
 * the book is and whether it's balanced. Pure: no crypto, no I/O, no other story imports beyond the shared
 * `countWords`, so the renderer can import it through the lean `@selfos/core/story-metrics` subpath (the
 * `story-diff` / `story-matter` precedent) without dragging in the crypto-laden story barrel.
 *
 * Counts come from the drafted `markdown` with inline emphasis stripped, so a chapter's count matches what a
 * reader would actually read (the stored markdown has SRC citation markers already stripped at generation
 * time, and generation emits no headings/lists/tables — only inline `*italics*` — so removing emphasis is the
 * whole of the "strip markup" the spec asks for; a stray markdown link, which generation never emits, would be
 * off by at most a token). Only WRITTEN chapters (non-empty markdown) count toward the length and average; an
 * unwritten shell contributes nothing and is never flagged.
 */

/** A chapter is much longer than average at or above this multiple of the mean written-chapter length. */
const OUTLIER_LONG = 2;
/** …and much shorter at or below this fraction of the mean. */
const OUTLIER_SHORT = 0.4;
/** Balance flags only fire once there are enough written chapters for a mean to be meaningful — flagging an
 *  "outlier" among one or two chapters is noise (with two, one being long forces the other to look short). */
const MIN_CHAPTERS_FOR_BALANCE = 3;

export type ChapterOutlier = 'long' | 'short' | null;

export interface ChapterMetric {
  id: string;
  title: string;
  /** Reader-visible word count (0 for an unwritten chapter). */
  words: number;
  /** Fraction of the whole book this chapter is (0..1); 0 when the book has no words. */
  share: number;
  /** `'long'`/`'short'` when the chapter is a pacing outlier vs the mean written chapter; else null. */
  outlier: ChapterOutlier;
}

export interface ManuscriptMetrics {
  /** Total reader-visible words across every written chapter. */
  totalWords: number;
  /** How many chapters have prose (unwritten shells excluded). */
  writtenCount: number;
  /** Mean words per WRITTEN chapter (0 when none are written). */
  averageWords: number;
  /** One entry per chapter, in the order given. */
  chapters: ChapterMetric[];
}

/**
 * Reader-visible word count: strip inline emphasis so `**word**` and a bare `*` don't inflate the count, then
 * reuse the shared `countWords`. Keeps parity with the reader render, which drops those marks.
 */
export function readerWordCount(markdown: string): number {
  const stripped = markdown.replace(/(\*\*|__|\*|_|`)/g, '');
  return countWords(stripped);
}

/** Whether a chapter has any prose (mirrors the renderer's written-vs-unwritten split). */
function isWritten(chapter: BookChapter): boolean {
  return chapter.markdown.trim().length > 0;
}

/**
 * Compute per-chapter and whole-book metrics. Deterministic and total — an empty book (no chapters, or none
 * written) yields all zeros and an empty/zeroed chapter list, never NaN.
 */
export function manuscriptMetrics(chapters: BookChapter[]): ManuscriptMetrics {
  const words = new Map<string, number>();
  for (const chapter of chapters) {
    words.set(chapter.id, isWritten(chapter) ? readerWordCount(chapter.markdown) : 0);
  }

  const writtenCount = chapters.filter(isWritten).length;
  const totalWords = [...words.values()].reduce((sum, n) => sum + n, 0);
  const averageWords = writtenCount === 0 ? 0 : Math.round(totalWords / writtenCount);
  const flagBalance = writtenCount >= MIN_CHAPTERS_FOR_BALANCE && averageWords > 0;

  const chapterMetrics = chapters.map((chapter): ChapterMetric => {
    const w = words.get(chapter.id) ?? 0;
    const share = totalWords === 0 ? 0 : w / totalWords;
    let outlier: ChapterOutlier = null;
    // Only WRITTEN chapters are pacing outliers — an unwritten shell is a gap, not an imbalance.
    if (flagBalance && w > 0) {
      if (w >= averageWords * OUTLIER_LONG) outlier = 'long';
      else if (w <= averageWords * OUTLIER_SHORT) outlier = 'short';
    }
    return { id: chapter.id, title: chapter.title, words: w, share, outlier };
  });

  return { totalWords, writtenCount, averageWords, chapters: chapterMetrics };
}

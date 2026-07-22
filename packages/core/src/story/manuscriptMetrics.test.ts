import { describe, expect, it } from 'vitest';
import type { BookChapter } from '../schemas';
import { manuscriptMetrics, readerWordCount } from './manuscriptMetrics';

/** A minimal written/unwritten chapter — only the fields the metrics read matter. */
function chapter(id: string, markdown: string, title = id): BookChapter {
  return {
    id,
    schemaVersion: 1,
    partId: 'p1',
    order: 0,
    title,
    markdown,
    revision: 0,
    status: 'reviewed',
    sourceSignature: '',
    provenance: [],
    protectedBlocks: [],
    pinnedQuotes: [],
    imagePlacements: [],
  };
}

/** Build a chapter with exactly `n` reader-visible words. */
function words(id: string, n: number): BookChapter {
  return chapter(id, Array.from({ length: n }, (_, i) => `w${i}`).join(' '));
}

describe('manuscriptMetrics (64 §16.5)', () => {
  it('counts reader-visible words, stripping inline emphasis', () => {
    // 4 words, but with **bold** and *italic* markers a naive count would inflate.
    expect(readerWordCount('The **quiet** *machine* hums.')).toBe(4);
    // A bare stray asterisk isn't its own word.
    expect(readerWordCount('one * two')).toBe(2);
    expect(readerWordCount('')).toBe(0);
    expect(readerWordCount('   ')).toBe(0);
  });

  it('an empty book is all zeros, never NaN', () => {
    const m = manuscriptMetrics([]);
    expect(m).toEqual({ totalWords: 0, writtenCount: 0, averageWords: 0, chapters: [] });
  });

  it('unwritten shells contribute nothing and are never flagged', () => {
    const m = manuscriptMetrics([words('a', 100), chapter('b', ''), chapter('c', '   ')]);
    expect(m.totalWords).toBe(100);
    expect(m.writtenCount).toBe(1);
    expect(m.averageWords).toBe(100);
    const shells = m.chapters.filter((c) => c.id !== 'a');
    expect(shells.every((c) => c.words === 0 && c.share === 0 && c.outlier === null)).toBe(true);
    // A single written chapter is 100% of the book — a full share, but not a pacing outlier.
    expect(m.chapters.find((c) => c.id === 'a')).toMatchObject({ share: 1, outlier: null });
  });

  it('computes share and average across written chapters', () => {
    const m = manuscriptMetrics([words('a', 100), words('b', 300)]);
    expect(m.totalWords).toBe(400);
    expect(m.writtenCount).toBe(2);
    expect(m.averageWords).toBe(200);
    expect(m.chapters.find((c) => c.id === 'a')!.share).toBeCloseTo(0.25);
    expect(m.chapters.find((c) => c.id === 'b')!.share).toBeCloseTo(0.75);
  });

  it('does NOT flag balance outliers with fewer than three written chapters', () => {
    // b is 4× a's length, but with only two chapters that is not enough to call it an imbalance.
    const m = manuscriptMetrics([words('a', 100), words('b', 400)]);
    expect(m.chapters.every((c) => c.outlier === null)).toBe(true);
  });

  it('flags long and short chapters once there are enough for a meaningful mean', () => {
    // avg over four written = (100 + 500 + 250 + 250)/4 = 275.
    const m = manuscriptMetrics([
      words('short', 100), // ≤ 0.4 × 275 = 110 → short
      words('long', 500), // ≥ 2 × 275 = 550? no — 500 < 550, so NOT long
      words('mid1', 250),
      words('mid2', 250),
    ]);
    expect(m.averageWords).toBe(275);
    expect(m.chapters.find((c) => c.id === 'short')!.outlier).toBe('short');
    expect(m.chapters.find((c) => c.id === 'long')!.outlier).toBe(null);
    expect(m.chapters.find((c) => c.id === 'mid1')!.outlier).toBe(null);
  });

  it('a chapter at or above twice the mean is a long outlier', () => {
    // avg = (100 + 100 + 400)/3 = 200; 400 ≥ 2×200 → long; the two 100s ≤ 0.4×200=80? no, 100>80 → not short.
    const m = manuscriptMetrics([words('a', 100), words('b', 100), words('big', 400)]);
    expect(m.averageWords).toBe(200);
    expect(m.chapters.find((c) => c.id === 'big')!.outlier).toBe('long');
    expect(m.chapters.filter((c) => c.id !== 'big').every((c) => c.outlier === null)).toBe(true);
  });

  it('preserves the given chapter order', () => {
    const m = manuscriptMetrics([words('c', 10), words('a', 20), words('b', 30)]);
    expect(m.chapters.map((c) => c.id)).toEqual(['c', 'a', 'b']);
  });
});

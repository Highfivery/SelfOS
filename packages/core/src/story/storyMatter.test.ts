import { describe, expect, it } from 'vitest';
import { BOOK_BOUNDARY_LINE, colophonLines, mdSafeMatter, missingMatter } from './storyMatter';

describe('structured front & back matter (64 §16.3)', () => {
  it('says what SelfOS is and is not — the wording is the point, not just the line', () => {
    // Asserting `toContain(BOOK_BOUNDARY_LINE)` elsewhere is tautological: softening the sentence would
    // still pass. Pin the part that carries the §8.2 meaning.
    expect(BOOK_BOUNDARY_LINE).toContain('not a medical record');
    expect(BOOK_BOUNDARY_LINE).toContain('reflection, not assessment');
  });

  it('never prints the boundary twice, even if it is pasted in as a colophon', () => {
    expect(colophonLines({ colophon: BOOK_BOUNDARY_LINE })).toEqual([BOOK_BOUNDARY_LINE]);
  });

  it('neutralizes Markdown that would swallow the boundary in a rendered export', () => {
    // A line-initial `<!--` opens a CommonMark HTML block that runs until `-->` — everything after it,
    // including the boundary, vanishes in GitHub/Obsidian/pandoc. A `.md` given to someone else is
    // normally rendered, not read raw.
    expect(mdSafeMatter('Set in Lora.\n<!--')).not.toContain('<!--');
    expect(mdSafeMatter('```')).not.toMatch(/^```/);
    expect(mdSafeMatter('Nothing special here.')).toBe('Nothing special here.');
  });

  it('always closes with the wellness boundary, colophon or not (§8.2)', () => {
    // The boundary is not the person's to delete: an exported or shared copy leaves the vault, so it can
    // never end without saying what SelfOS is and isn't.
    expect(colophonLines(undefined)).toEqual([BOOK_BOUNDARY_LINE]);
    expect(colophonLines({})).toEqual([BOOK_BOUNDARY_LINE]);
    expect(colophonLines({ colophon: '   ' })).toEqual([BOOK_BOUNDARY_LINE]);
  });

  it('adds the person’s colophon BEFORE the boundary, never instead of it', () => {
    expect(colophonLines({ colophon: 'Set in Lora, over one winter.' })).toEqual([
      'Set in Lora, over one winter.',
      BOOK_BOUNDARY_LINE,
    ]);
  });

  it('names what the book is still missing — a nudge, and never the colophon (which is optional)', () => {
    expect(missingMatter(undefined)).toEqual([
      'a dedication',
      'an epigraph',
      'acknowledgments',
      'a note about you',
    ]);
    expect(
      missingMatter({
        dedication: 'For my father.',
        epigraph: 'The past is never dead.',
        acknowledgments: 'With thanks to…',
        aboutAuthor: 'Ben lives in Ohio.',
      }),
    ).toEqual([]);
    // Whitespace isn't content.
    expect(missingMatter({ dedication: '  ' })).toContain('a dedication');
  });
});

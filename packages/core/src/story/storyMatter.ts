import type { BookMatter } from '../schemas';

/**
 * Structured front & back matter (64 §16.3) — the parts of a book that aren't chapters.
 *
 * `BookMatter` was three free-text boxes (dedication, epigraph, acknowledgments); §16.3 adds
 * about-the-author and a colophon. All additive-optional, so every existing book keeps what it had.
 */

/**
 * The wellness boundary that closes every book (§8.2). It is NOT the person's to delete: a colophon they
 * write is rendered ALONGSIDE this line, never instead of it, so no export or shared copy can end without
 * saying what SelfOS is — and isn't.
 */
export const BOOK_BOUNDARY_LINE =
  'SelfOS is a wellness companion, not a medical record — this book is reflection, not assessment.';

/**
 * The closing lines of a book, in order: the person's own colophon (when they wrote one), then the standing
 * boundary. One helper so the reader, the Markdown export and the PDF export can't drift on the one line
 * that has to be there.
 */
export function colophonLines(matter: BookMatter | undefined): string[] {
  const own = matter?.colophon?.trim();
  // Pasting the boundary in as your own colophon shouldn't print it twice.
  return own && own !== BOOK_BOUNDARY_LINE ? [own, BOOK_BOUNDARY_LINE] : [BOOK_BOUNDARY_LINE];
}

/** Which matter a book is still missing — a light nudge on the Settings tab, never a gate (§16.3). */
export function missingMatter(matter: BookMatter | undefined): string[] {
  const missing: string[] = [];
  if (!matter?.dedication?.trim()) missing.push('a dedication');
  if (!matter?.epigraph?.trim()) missing.push('an epigraph');
  if (!matter?.acknowledgments?.trim()) missing.push('acknowledgments');
  if (!matter?.aboutAuthor?.trim()) missing.push('a note about you');
  return missing;
}

/**
 * Neutralize the two Markdown constructs that can swallow everything after them — an unterminated HTML
 * comment (`<!--`, a CommonMark HTML block that interrupts a paragraph and runs until `-->`) and an unclosed
 * code fence. Author-written matter is emitted raw into the Markdown export, so without this a colophon
 * ending in `<!--` hides the §8.2 boundary line in any renderer with HTML enabled — and a `.md` handed to
 * someone else is normally rendered, not read raw. The HTML export escapes instead; this is its counterpart.
 */
export function mdSafeMatter(text: string): string {
  return text.replace(/<!--/g, '<!\u2011\u2011').replace(/^(\s*)(```|~~~)/gm, '$1\u200b$2');
}

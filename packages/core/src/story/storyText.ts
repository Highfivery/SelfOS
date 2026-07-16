import type { ChapterProvenanceEntry, StorySourceRef } from '../schemas';

/**
 * Pure text helpers for Your Story chapters (64-your-story §5.3) — no crypto, no I/O, no other story imports,
 * so both the generation service and the markup engine share ONE paragraph-split + marker rule without an
 * import cycle. The draft-view renderer keeps its own inline copy of the split (it can't import the crypto-
 * laden story barrel); this is the single source of truth the core anchors against.
 */

export const SOURCE_MARKER = /\[\[SRC:([^\]]*)\]\]/g;

/** Split a chapter's stored markdown into paragraphs (`p<index>` over blank-line-separated non-empty blocks).
 *  Both the anchoring (`stripSourceMarkers`, which calls this on the CLEANED text) and the draft-view renderer
 *  split through this exact rule, so a paragraph's sources always line up with its `p<index>`. */
export function chapterParagraphs(markdown: string): string[] {
  return markdown
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
}

/**
 * Strip the model's per-paragraph `[[SRC:sN,sN]]` citation markers from a chapter's markdown, resolving the
 * `sN` tags to `StorySourceRef`s via `tagToRef` and recording them as the chapter's provenance (anchored to
 * the paragraph index `p<N>`). The markers NEVER render (the stripCoachMarkers precedent). An unknown tag is
 * dropped; a paragraph with no valid citation contributes no provenance entry. Pure + tested.
 */
export function stripSourceMarkers(
  markdown: string,
  tagToRef: Map<string, StorySourceRef>,
): { markdown: string; provenance: ChapterProvenanceEntry[] } {
  const provenance: ChapterProvenanceEntry[] = [];
  const outParagraphs: string[] = [];
  for (const block of markdown.split(/\n{2,}/)) {
    const refs: StorySourceRef[] = [];
    const seen = new Set<string>();
    for (const match of block.matchAll(SOURCE_MARKER)) {
      for (const rawTag of (match[1] ?? '').split(',')) {
        const tag = rawTag.trim();
        const ref = tagToRef.get(tag);
        if (ref && !seen.has(tag)) {
          seen.add(tag);
          refs.push(ref);
        }
      }
    }
    // Removing a marker can leave an internal blank line — e.g. an own-line `[[SRC:s0]]` between two lines
    // cleans to a `\n\n` that splits the block in two. So re-split the CLEANED text with the SAME function
    // the reader uses (`chapterParagraphs` over the stored markdown); anchoring and rendering then can't
    // diverge. The block's citations attach to its FIRST resulting paragraph; a marker-only block yields no
    // paragraph (and drops its refs, having no prose to anchor to).
    const cleanParas = chapterParagraphs(block.replace(SOURCE_MARKER, ''));
    cleanParas.forEach((para, i) => {
      if (i === 0 && refs.length > 0) provenance.push({ anchor: `p${outParagraphs.length}`, refs });
      outParagraphs.push(para);
    });
  }
  return { markdown: outParagraphs.join('\n\n').trim(), provenance };
}

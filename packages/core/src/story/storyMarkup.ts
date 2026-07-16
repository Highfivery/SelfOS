import type { BookChapter, PinnedQuote, ProtectedBlock, TextAnchor } from '../schemas';
import { chapterParagraphs } from './storyText';

/**
 * The Your Story markup mechanics (64-your-story §3.3/§5.3) — PURE, no AI, no I/O. Three jobs:
 *
 *  1. Resolve a `TextAnchor` against the live markdown (exact-then-fuzzy by paragraph + quoted span), so a
 *     mark placed on a span survives light re-flow; an anchor that no longer resolves is ORPHANED — returned
 *     as `null` so the caller surfaces it for re-placement, never silently drops or reapplies it (§5.3).
 *  2. Apply the INSTANT, no-AI marks — inline **Edit** (replace a span with the person's own words → the
 *     edited span becomes a protected block) and **Pin** (mark a sentence untouchable).
 *  3. ENFORCE protected blocks + pinned quotes after any (re)generation: verify each is present byte-verbatim
 *     and, if a rewrite dropped one, splice the person's own words back in (code, not prompt — §5.3/§5.4).
 *
 * The AI batch revision (`applyMarkup`) lives in `storyGenerationService`; this module is the deterministic
 * half it and the instant ops both build on.
 */

/** A resolved anchor: the paragraph it lives in and the char span within it (`start`..`end`). */
export interface ResolvedAnchor {
  paragraphIndex: number;
  start: number;
  end: number;
}

/** `p<n>` → n, else null. Paragraph ids are the `chapterParagraphs` index, matching provenance anchors. */
function paragraphIndexOf(paragraphId: string): number | null {
  const m = /^p(\d+)$/.exec(paragraphId);
  return m ? Number(m[1]) : null;
}

/** Find `anchor.quote` in a paragraph, disambiguating by `prefix`/`suffix` when it occurs more than once. */
function locateQuote(paragraph: string, anchor: TextAnchor): { start: number; end: number } | null {
  const quote = anchor.quote ?? '';
  if (quote.length === 0) return null;
  const occurrences: number[] = [];
  for (let at = paragraph.indexOf(quote); at >= 0; at = paragraph.indexOf(quote, at + 1)) {
    occurrences.push(at);
  }
  if (occurrences.length === 0) return null;
  const hasDisambiguator = Boolean(anchor.prefix || anchor.suffix);
  const match = occurrences.find((at) => {
    const before = paragraph.slice(Math.max(0, at - (anchor.prefix?.length ?? 0)), at);
    const after = paragraph.slice(
      at + quote.length,
      at + quote.length + (anchor.suffix?.length ?? 0),
    );
    return (
      (!anchor.prefix || before.endsWith(anchor.prefix)) &&
      (!anchor.suffix || after.startsWith(anchor.suffix))
    );
  });
  if (match != null) return { start: match, end: match + quote.length };
  // No occurrence satisfied the disambiguator. If the quote is UNIQUE it merely moved (its context changed) →
  // resolve it. But if it appears MULTIPLE times and a disambiguator was recorded, we can't tell which is the
  // intended span → orphan it rather than guess the wrong one (§5.3 "never silently reapplied").
  if (hasDisambiguator && occurrences.length > 1) return null;
  const first = occurrences[0]!;
  return { start: first, end: first + quote.length };
}

/**
 * Resolve a `TextAnchor` against the current markdown. A paragraph-level anchor (no `quote`) resolves to the
 * whole paragraph at its index. A span anchor tries its recorded paragraph first, then scans every paragraph
 * (light re-flow may have shifted the index) for the quoted text. Returns `null` when it no longer
 * resolves — the ORPHANED case (§5.3).
 */
export function resolveAnchor(markdown: string, anchor: TextAnchor): ResolvedAnchor | null {
  const paras = chapterParagraphs(markdown);
  const recorded = paragraphIndexOf(anchor.paragraphId);
  if (!anchor.quote) {
    // Paragraph-level anchor. If a `prefix` (the paragraph's opening text) is recorded, resolve by CONTENT so
    // the mark survives re-flow (an inserted paragraph before it) — and orphan when that opening text is gone.
    // With no prefix this is a bare index resolve that CAN'T detect re-flow (a mark can shift onto a different
    // paragraph); callers should record a prefix for paragraph-level marks so they re-resolve safely.
    if (anchor.prefix) {
      const byPrefix = paras.findIndex((p) => p.startsWith(anchor.prefix!));
      if (byPrefix < 0) return null;
      return { paragraphIndex: byPrefix, start: 0, end: paras[byPrefix]!.length };
    }
    if (recorded == null || recorded < 0 || recorded >= paras.length) return null;
    return { paragraphIndex: recorded, start: 0, end: paras[recorded]!.length };
  }
  // Try the recorded paragraph first, then the rest (a rewrite may have moved the span to a new index).
  const order =
    recorded != null && recorded >= 0 && recorded < paras.length
      ? [recorded, ...paras.map((_, i) => i).filter((i) => i !== recorded)]
      : paras.map((_, i) => i);
  for (const i of order) {
    const span = locateQuote(paras[i]!, anchor);
    if (span) return { paragraphIndex: i, start: span.start, end: span.end };
  }
  return null;
}

/**
 * Apply an INSTANT inline edit (§3.3): replace the anchored span with the person's own `newText`, and record
 * that new text as a protected block a later rewrite must preserve verbatim. Returns the updated chapter, or
 * `null` if the anchor is orphaned (can't edit a span that no longer exists — the caller surfaces it).
 */
export function applyInlineEdit(
  chapter: BookChapter,
  anchor: TextAnchor,
  newText: string,
): BookChapter | null {
  const resolved = resolveAnchor(chapter.markdown, anchor);
  if (!resolved) return null;
  const paras = chapterParagraphs(chapter.markdown);
  const para = paras[resolved.paragraphIndex]!;
  paras[resolved.paragraphIndex] =
    para.slice(0, resolved.start) + newText + para.slice(resolved.end);
  const markdown = paras.join('\n\n');
  // The edited span becomes a protected block, anchored to the NEW text so enforcement re-finds it.
  const block: ProtectedBlock = {
    anchor: { paragraphId: `p${resolved.paragraphIndex}`, quote: newText },
    text: newText,
  };
  return { ...chapter, markdown, protectedBlocks: [...chapter.protectedBlocks, block] };
}

/**
 * Pin a sentence "in your own words" (§3.3): instant, no-AI — marks the anchored text untouchable so no
 * rewrite paraphrases it. Returns the updated chapter, or `null` if the anchor is orphaned.
 */
export function pinQuote(
  chapter: BookChapter,
  anchor: TextAnchor,
  text: string,
  sourceRef?: PinnedQuote['sourceRef'],
): BookChapter | null {
  if (!resolveAnchor(chapter.markdown, anchor)) return null;
  const pin: PinnedQuote = { anchor, text, ...(sourceRef ? { sourceRef } : {}) };
  return { ...chapter, pinnedQuotes: [...chapter.pinnedQuotes, pin] };
}

export interface EnforceResult {
  markdown: string;
  /** How many protected/pinned texts a rewrite had dropped and this re-inserted (0 on a compliant draft). */
  reinserted: number;
}

/**
 * ENFORCE that every protected block + pinned quote survives a (re)generation byte-verbatim (§5.3/§5.4). This
 * is code, not prompt: any text missing from the new markdown is spliced back — appended to its anchored
 * paragraph if that still resolves, else as a trailing paragraph — so the person's own words can never be
 * lost, even if the model ignored the instruction. A compliant draft is returned unchanged (`reinserted: 0`).
 */
export function enforceProtected(
  markdown: string,
  protectedBlocks: ProtectedBlock[],
  pinnedQuotes: PinnedQuote[],
): EnforceResult {
  const mustKeep = [
    ...protectedBlocks.map((b) => ({ anchor: b.anchor, text: b.text })),
    ...pinnedQuotes.map((q) => ({ anchor: q.anchor, text: q.text })),
  ];
  let out = markdown;
  let reinserted = 0;
  for (const item of mustKeep) {
    const text = item.text.trim();
    if (text.length === 0 || out.includes(text)) continue; // already present verbatim
    const paras = chapterParagraphs(out);
    const idx = paragraphIndexOf(item.anchor.paragraphId);
    if (idx != null && idx >= 0 && idx < paras.length) {
      paras[idx] = `${paras[idx]} ${text}`.trim();
      out = paras.join('\n\n');
    } else {
      out = `${out}\n\n${text}`.trim();
    }
    reinserted += 1;
  }
  return { markdown: out, reinserted };
}

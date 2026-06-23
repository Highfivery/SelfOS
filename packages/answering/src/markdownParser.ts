// A hand-rolled, dependency-free Markdown parser for the curated subset SelfOS renders from AI prose
// (34-rich-text-rendering §3.1). It produces a small AST so the security + streaming behaviour is
// unit-testable without React, and so the SAME parser drives the Electron renderer, the iOS WebView, and
// the relay Worker page (the component lives in @selfos/answering for exactly that reuse).
//
// Security & streaming invariants (the reason this is bespoke, not a Markdown library):
//   - It NEVER emits raw HTML. The output is only ever our own node types, built from matched Markdown
//     tokens, so a model string like `<script>…` or `<img onerror=…>` becomes literal TEXT — never a live
//     element, never a DOM/network side effect. This protects the renderer-is-offline guarantee (§8).
//   - Image syntax (`![alt](url)`) is DROPPED entirely (no network fetch from a model string).
//   - Links are parsed but NEUTERED — a `link` node carries only its text; no URL/scheme survives into the
//     AST, so there is no `href` for the renderer to follow regardless of `javascript:`/`data:` schemes.
//   - It never throws. Unterminated constructs mid-stream (`**stay`, a dangling `` ` `` or `[`) degrade to
//     literal text and resolve once the closing delimiter arrives — so a streaming buffer re-parses cleanly
//     every chunk (§3.3).

/** An inline (within-paragraph) node. `link` is neutered — text only, no href (§11). */
export type InlineNode =
  | { type: 'text'; value: string }
  | { type: 'strong'; children: InlineNode[] }
  | { type: 'em'; children: InlineNode[] }
  | { type: 'code'; value: string }
  | { type: 'link'; text: string };

/** A list item; `sublist` is the single permitted level of nesting (lists clamp to 2 levels, §7). */
export interface ListItem {
  children: InlineNode[];
  sublist?: { ordered: boolean; items: ListItem[] };
}

/** A block-level node. Headings clamp to level 3/4 (§3.1) so prose never out-titles its card. */
export type Block =
  | { type: 'paragraph'; children: InlineNode[] }
  | { type: 'heading'; level: 3 | 4; children: InlineNode[] }
  | { type: 'blockquote'; children: InlineNode[] }
  | { type: 'list'; ordered: boolean; items: ListItem[] }
  | { type: 'hr' };

const HR_RE = /^\s*([-*_])\1{2,}\s*$/;
const FENCE_RE = /^\s*(```|~~~)/;
const HEADING_RE = /^\s*(#{1,6})\s+(.*)$/;
const QUOTE_RE = /^\s*>/;
const UNORDERED_RE = /^(\s*)[-*]\s+(.*)$/;
const ORDERED_RE = /^(\s*)\d+[.)]\s+(.*)$/;

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
}

/**
 * Parse a single line/run of inline Markdown into nodes. Recursive for emphasis. A delimiter only becomes
 * formatting when its closing partner is found; otherwise it is emitted literally (the streaming-safety
 * rule). `<`/`>` are always literal — raw HTML is never interpreted.
 */
export function parseInline(src: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let buf = '';
  const flush = (): void => {
    if (buf) {
      nodes.push({ type: 'text', value: buf });
      buf = '';
    }
  };

  let i = 0;
  while (i < src.length) {
    const ch = src[i] as string;

    // Image — drop the whole `![alt](url)` construct (no embedding, no network).
    if (ch === '!' && src[i + 1] === '[') {
      const link = matchLink(src, i + 1);
      if (link) {
        i = link.end;
        continue;
      }
      buf += ch;
      i += 1;
      continue;
    }

    // Link — neutered: keep the text, discard the URL (no scheme survives, so no href is ever rendered).
    if (ch === '[') {
      const link = matchLink(src, i);
      if (link) {
        flush();
        nodes.push({ type: 'link', text: link.text });
        i = link.end;
        continue;
      }
      buf += ch;
      i += 1;
      continue;
    }

    // Inline code — literal content between single backticks (no nested parsing).
    if (ch === '`') {
      const close = src.indexOf('`', i + 1);
      if (close !== -1) {
        flush();
        nodes.push({ type: 'code', value: src.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
      buf += ch;
      i += 1;
      continue;
    }

    // Strong — `**…**` / `__…__` (checked before single-char emphasis).
    if ((ch === '*' || ch === '_') && src[i + 1] === ch) {
      const close = findClose(src, i + 2, ch + ch);
      if (close !== -1) {
        flush();
        nodes.push({ type: 'strong', children: parseInline(src.slice(i + 2, close)) });
        i = close + 2;
        continue;
      }
      buf += ch;
      i += 1;
      continue;
    }

    // Emphasis — `*…*` / `_…_`. For `_`, require word boundaries so `snake_case` stays literal.
    if (ch === '*' || ch === '_') {
      if (ch === '_' && isWordChar(src[i - 1])) {
        buf += ch;
        i += 1;
        continue;
      }
      const close = findClose(src, i + 1, ch);
      if (close !== -1 && close > i + 1) {
        flush();
        nodes.push({ type: 'em', children: parseInline(src.slice(i + 1, close)) });
        i = close + 1;
        continue;
      }
      buf += ch;
      i += 1;
      continue;
    }

    buf += ch;
    i += 1;
  }

  flush();
  return nodes;
}

/** Find the closing delimiter for emphasis. For `_`, the close must not sit between word chars. */
function findClose(src: string, from: number, delim: string): number {
  let idx = src.indexOf(delim, from);
  while (idx !== -1) {
    if (delim === '_') {
      // `_close_` is only a delimiter at a word boundary — the char after the closing `_` must not be a
      // word char (otherwise it's an intra-word underscore like `a_b`).
      const after = src[idx + delim.length];
      if (!isWordChar(after)) return idx;
    } else {
      return idx;
    }
    idx = src.indexOf(delim, idx + 1);
  }
  return -1;
}

/** Match `[text](url)` starting at `open` (the `[`). Returns the text + end index, or null if malformed. */
function matchLink(src: string, open: number): { text: string; end: number } | null {
  if (src[open] !== '[') return null;
  const closeBracket = src.indexOf(']', open + 1);
  if (closeBracket === -1) return null;
  if (src[closeBracket + 1] !== '(') return null;
  const closeParen = src.indexOf(')', closeBracket + 2);
  if (closeParen === -1) return null;
  return { text: src.slice(open + 1, closeBracket), end: closeParen + 1 };
}

function listMatch(line: string): { indent: number; ordered: boolean; text: string } | null {
  const u = line.match(UNORDERED_RE);
  if (u) return { indent: (u[1] ?? '').length, ordered: false, text: u[2] ?? '' };
  const o = line.match(ORDERED_RE);
  if (o) return { indent: (o[1] ?? '').length, ordered: true, text: o[2] ?? '' };
  return null;
}

function isBlockStart(line: string): boolean {
  return (
    line.trim() === '' ||
    HR_RE.test(line) ||
    FENCE_RE.test(line) ||
    HEADING_RE.test(line) ||
    QUOTE_RE.test(line) ||
    listMatch(line) !== null
  );
}

/** Parse a list (and one level of nested sublist) starting at `lines[start]`. */
function parseList(
  lines: string[],
  start: number,
  depth: number,
): { list: Extract<Block, { type: 'list' }>; next: number } {
  const first = listMatch(lines[start] as string);
  const ordered = first ? first.ordered : false;
  const baseIndent = first ? first.indent : 0;
  const items: ListItem[] = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i] as string;
    if (line.trim() === '') break;
    const m = listMatch(line);
    if (!m || m.indent < baseIndent) break;
    // A more-indented item belongs to the previous item's sublist, handled below — not at this level.
    if (m.indent > baseIndent) break;

    i += 1;
    let sublist: ListItem['sublist'];
    // Collect a single nested level (lists clamp to 2 levels — deeper indentation is not recursed into).
    if (depth < 1 && i < lines.length) {
      const nextM = listMatch(lines[i] as string);
      if (nextM && nextM.indent > baseIndent) {
        const sub = parseList(lines, i, depth + 1);
        sublist = { ordered: sub.list.ordered, items: sub.list.items };
        i = sub.next;
      }
    }
    items.push(
      sublist ? { children: parseInline(m.text), sublist } : { children: parseInline(m.text) },
    );
  }

  return { list: { type: 'list', ordered, items }, next: i };
}

/**
 * Parse a Markdown string into the block AST. Pure + total: any input (including raw HTML, tables, or a
 * truncated stream) yields a valid `Block[]` and never throws. Unsupported constructs degrade to their
 * text content.
 */
export function parseMarkdown(src: string): Block[] {
  const lines = (src ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] as string;

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    // Thematic break.
    if (HR_RE.test(line)) {
      blocks.push({ type: 'hr' });
      i += 1;
      continue;
    }

    // Code fence (unsupported) — strip to its text content, rendered as a plain paragraph (never a live
    // code block, never raw markup).
    if (FENCE_RE.test(line)) {
      i += 1;
      const content: string[] = [];
      while (i < lines.length && !FENCE_RE.test(lines[i] as string)) {
        content.push(lines[i] as string);
        i += 1;
      }
      if (i < lines.length) i += 1; // closing fence
      const text = content.join(' ').trim();
      if (text) blocks.push({ type: 'paragraph', children: parseInline(text) });
      continue;
    }

    // Heading — clamp: `#`/`##`/`###` → h3, deeper → h4 (so prose never out-titles its card).
    const h = line.match(HEADING_RE);
    if (h) {
      const level: 3 | 4 = (h[1] as string).length <= 3 ? 3 : 4;
      blocks.push({ type: 'heading', level, children: parseInline((h[2] as string).trim()) });
      i += 1;
      continue;
    }

    // Blockquote — consume consecutive `>` lines.
    if (QUOTE_RE.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && QUOTE_RE.test(lines[i] as string)) {
        quote.push((lines[i] as string).replace(/^\s*>\s?/, ''));
        i += 1;
      }
      blocks.push({ type: 'blockquote', children: parseInline(quote.join(' ').trim()) });
      continue;
    }

    // List.
    if (listMatch(line)) {
      const { list, next } = parseList(lines, i, 0);
      blocks.push(list);
      i = next;
      continue;
    }

    // Paragraph — gather until a blank line or a new block start. Lines join with a space (soft wraps).
    const para: string[] = [];
    while (i < lines.length && !isBlockStart(lines[i] as string)) {
      para.push((lines[i] as string).trim());
      i += 1;
    }
    const text = para.join(' ').trim();
    if (text) blocks.push({ type: 'paragraph', children: parseInline(text) });
  }

  return blocks;
}

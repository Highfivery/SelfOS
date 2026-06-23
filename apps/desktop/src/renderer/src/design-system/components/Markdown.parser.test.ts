import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown, type Block, type InlineNode } from '@selfos/answering';

// Pure-AST tests for the hand-rolled Markdown parser (34-rich-text-rendering §10). The parser is the
// security + streaming boundary, so it is tested without React: assert the SHAPE of the output, and that
// unsupported/hostile constructs degrade to text and never throw.

const types = (nodes: InlineNode[]): string[] => nodes.map((n) => n.type);
function text(nodes: InlineNode[]): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case 'text':
          return n.value;
        case 'code':
          return n.value;
        case 'link':
          return n.text;
        case 'strong':
        case 'em':
          return text(n.children);
        default:
          return '';
      }
    })
    .join('');
}

/** Narrow the first block to a list (or fail the test). */
function firstList(blocks: Block[]): Extract<Block, { type: 'list' }> {
  const block = blocks[0];
  if (!block || block.type !== 'list') throw new Error(`expected a list, got ${block?.type}`);
  return block;
}

describe('parseInline — supported emphasis', () => {
  it('parses **bold**', () => {
    const nodes = parseInline('a **bold** b');
    expect(types(nodes)).toEqual(['text', 'strong', 'text']);
    const strong = nodes[1];
    expect(strong?.type).toBe('strong');
    if (strong?.type === 'strong') expect(text(strong.children)).toBe('bold');
  });

  it('parses *italic* and _italic_', () => {
    expect(types(parseInline('an *x* word'))).toEqual(['text', 'em', 'text']);
    expect(types(parseInline('an _y_ word'))).toEqual(['text', 'em', 'text']);
  });

  it('keeps intra-word underscores literal (snake_case)', () => {
    const nodes = parseInline('a snake_case_name b');
    expect(types(nodes)).toEqual(['text']);
    expect(text(nodes)).toBe('a snake_case_name b');
  });

  it('parses `inline code` literally (no nested parsing)', () => {
    const nodes = parseInline('use `a_b**c**` now');
    expect(types(nodes)).toEqual(['text', 'code', 'text']);
    const code = nodes[1];
    if (code?.type === 'code') expect(code.value).toBe('a_b**c**');
  });
});

describe('parseInline — links neutered, images dropped', () => {
  it('keeps link text but carries NO url/href (neutered)', () => {
    const nodes = parseInline('see [the site](https://example.com) now');
    expect(types(nodes)).toEqual(['text', 'link', 'text']);
    const link = nodes[1];
    expect(link?.type).toBe('link');
    if (link?.type === 'link') {
      expect(link.text).toBe('the site');
      // The AST has no place to put a URL — there is no field to leak a scheme into.
      expect(Object.keys(link)).toEqual(['type', 'text']);
    }
  });

  it('rejects javascript: and data: schemes by never carrying any href', () => {
    for (const src of [
      '[click](javascript:alert(1))',
      '[x](data:text/html,<script>alert(1)</script>)',
    ]) {
      const nodes = parseInline(src);
      const link = nodes.find((n) => n.type === 'link');
      expect(link?.type).toBe('link');
      // Only `text` survives — no url, no scheme.
      if (link?.type === 'link') expect(Object.keys(link)).toEqual(['type', 'text']);
    }
  });

  it('drops image syntax entirely', () => {
    const nodes = parseInline('before ![alt](http://x/y.png) after');
    expect(text(nodes)).toBe('before  after');
    expect(nodes.some((n) => n.type === 'link')).toBe(false);
  });
});

describe('parseInline — streaming safety', () => {
  it('renders unterminated emphasis literally', () => {
    expect(text(parseInline('**stay'))).toBe('**stay');
    expect(types(parseInline('**stay'))).toEqual(['text']);
  });

  it('resolves once the closing delimiter arrives', () => {
    expect(types(parseInline('**stayed**'))).toEqual(['strong']);
  });

  it('renders a dangling backtick / open bracket literally', () => {
    expect(text(parseInline('a `code'))).toBe('a `code');
    expect(text(parseInline('a [link'))).toBe('a [link');
  });
});

describe('parseInline — raw HTML is never interpreted', () => {
  it('treats tags as literal text', () => {
    const nodes = parseInline('hi <script>alert(1)</script> there');
    expect(types(nodes)).toEqual(['text']);
    expect(text(nodes)).toBe('hi <script>alert(1)</script> there');
  });
});

describe('parseMarkdown — blocks', () => {
  it('splits paragraphs on blank lines', () => {
    const blocks = parseMarkdown('one\n\ntwo');
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'paragraph']);
  });

  it('clamps headings to h3 (#/##/###) and h4 (deeper)', () => {
    const blocks = parseMarkdown('# A\n\n### B\n\n#### C\n\n###### D');
    const headings = blocks.filter(
      (b): b is Extract<Block, { type: 'heading' }> => b.type === 'heading',
    );
    expect(headings.map((h) => h.level)).toEqual([3, 3, 4, 4]);
  });

  it('parses bulleted and numbered lists', () => {
    const ul = firstList(parseMarkdown('- a\n- b'));
    expect(ul.ordered).toBe(false);
    expect(ul.items).toHaveLength(2);
    const ol = firstList(parseMarkdown('1. a\n2. b'));
    expect(ol.ordered).toBe(true);
  });

  it('supports one level of nested list (clamped to 2 levels)', () => {
    const list = firstList(parseMarkdown('- a\n  - a1\n  - a2\n- b'));
    expect(list.items).toHaveLength(2);
    expect(list.items[0]?.sublist?.items).toHaveLength(2);
  });

  it('parses blockquotes and thematic breaks', () => {
    expect(parseMarkdown('> quoted')[0]?.type).toBe('blockquote');
    expect(parseMarkdown('---')[0]?.type).toBe('hr');
    expect(parseMarkdown('***')[0]?.type).toBe('hr');
  });
});

describe('parseMarkdown — unsupported constructs degrade safely', () => {
  it('strips a code fence to its text content (no live code block)', () => {
    const blocks = parseMarkdown('```js\nalert(1)\n```');
    expect(blocks.every((b) => b.type === 'paragraph')).toBe(true);
  });

  it('renders a table row as literal paragraph text', () => {
    const blocks = parseMarkdown('| a | b |\n| - | - |');
    expect(blocks.every((b) => b.type !== 'list' && b.type !== 'heading')).toBe(true);
  });

  it('never throws on arbitrary / hostile input', () => {
    for (const src of [
      '',
      '   ',
      '<script>alert(1)</script>',
      '**',
      '###',
      '- ',
      '> ',
      '![](',
      '[](',
      '`'.repeat(50),
      '*'.repeat(50),
    ]) {
      expect(() => parseMarkdown(src)).not.toThrow();
    }
  });

  it('returns no blocks for empty/whitespace input', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('   \n  ')).toEqual([]);
  });
});

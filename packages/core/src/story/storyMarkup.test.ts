import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { BookChapter, ChapterMarkup, StoryTodoList, TextAnchor } from '../schemas';
import { applyInlineEdit, enforceProtected, pinQuote, resolveAnchor } from './storyMarkup';
import { getMarkup, getTodos, saveMarkup, saveTodos } from './storyService';

const MD = 'The garage smelled of cut pine.\n\nHe watched the lathe turn, and said nothing.';

function chapter(over: Partial<BookChapter> = {}): BookChapter {
  return {
    id: 'c1',
    schemaVersion: 1,
    partId: 'p1',
    order: 0,
    title: 'The Garage',
    markdown: MD,
    revision: 1,
    status: 'new',
    sourceSignature: '',
    provenance: [],
    protectedBlocks: [],
    pinnedQuotes: [],
    imagePlacements: [],
    ...over,
  };
}

describe('resolveAnchor (64 §5.3)', () => {
  it('resolves a paragraph-level anchor (no quote) to the whole paragraph', () => {
    expect(resolveAnchor(MD, { paragraphId: 'p1' })).toEqual({
      paragraphIndex: 1,
      start: 0,
      end: 'He watched the lathe turn, and said nothing.'.length,
    });
  });

  it('returns null for a paragraph index that no longer exists (orphaned)', () => {
    expect(resolveAnchor(MD, { paragraphId: 'p5' })).toBeNull();
  });

  it('resolves a span by its quoted text within the recorded paragraph', () => {
    const r = resolveAnchor(MD, { paragraphId: 'p0', quote: 'cut pine' });
    expect(r).not.toBeNull();
    expect(MD.split(/\n{2,}/)[0]!.slice(r!.start, r!.end)).toBe('cut pine');
  });

  it('finds a span that light re-flow moved to a different paragraph index', () => {
    // The quote was anchored at p0, but the markdown now has an extra opening paragraph → it lives at p1.
    const reflowed = 'A new opening line.\n\n' + MD;
    const r = resolveAnchor(reflowed, { paragraphId: 'p0', quote: 'cut pine' });
    expect(r?.paragraphIndex).toBe(1); // followed the text, not the stale index
  });

  it('returns null when the quoted span is gone (orphaned, never silently reapplied)', () => {
    expect(resolveAnchor(MD, { paragraphId: 'p0', quote: 'sawdust' })).toBeNull();
  });

  it('disambiguates a repeated quote by prefix/suffix', () => {
    const md = 'red door and a red door again';
    const withSuffix: TextAnchor = { paragraphId: 'p0', quote: 'red door', suffix: ' again' };
    const r = resolveAnchor(md, withSuffix);
    expect(r?.start).toBe(md.lastIndexOf('red door')); // the second occurrence, per the suffix
  });

  it('orphans a repeated quote when the disambiguator no longer matches any occurrence', () => {
    // Two occurrences, but the recorded suffix (" again") is gone from both → can't tell which → orphan,
    // never guess the wrong span (§5.3).
    const md = 'red door and a red door too';
    expect(
      resolveAnchor(md, { paragraphId: 'p0', quote: 'red door', suffix: ' again' }),
    ).toBeNull();
  });

  it('still resolves a UNIQUE quote whose recorded context changed (it merely moved)', () => {
    // One occurrence; its prefix no longer matches, but a unique span that simply shifted should resolve.
    const md = 'A different lead-in, then cut pine.';
    const r = resolveAnchor(md, { paragraphId: 'p0', quote: 'cut pine', prefix: 'smelled of ' });
    expect(r).not.toBeNull();
    expect(md.slice(r!.start, r!.end)).toBe('cut pine');
  });

  it('resolves a paragraph-level anchor by its recorded prefix after re-flow', () => {
    const reflowed = 'A brand-new opening.\n\n' + MD; // the original p0 is now p1
    const r = resolveAnchor(reflowed, { paragraphId: 'p0', prefix: 'The garage smelled' });
    expect(r?.paragraphIndex).toBe(1); // followed the opening text, not the stale index
  });

  it('orphans a paragraph-level anchor when its recorded opening text is gone', () => {
    expect(
      resolveAnchor(MD, { paragraphId: 'p0', prefix: 'A paragraph that no longer exists' }),
    ).toBeNull();
  });
});

describe('applyInlineEdit (64 §3.3) — instant, no AI', () => {
  it('replaces the span with the person’s words and protects the new text', () => {
    const edited = applyInlineEdit(
      chapter(),
      { paragraphId: 'p0', quote: 'cut pine' },
      'cold steel',
    );
    expect(edited).not.toBeNull();
    expect(edited!.markdown).toContain('The garage smelled of cold steel.');
    expect(edited!.markdown).not.toContain('cut pine');
    // The edit is now a protected block anchored to the NEW text.
    expect(edited!.protectedBlocks).toEqual([
      { anchor: { paragraphId: 'p0', quote: 'cold steel' }, text: 'cold steel' },
    ]);
  });

  it('refuses an orphaned span (returns null, never edits the wrong place)', () => {
    expect(applyInlineEdit(chapter(), { paragraphId: 'p0', quote: 'nope' }, 'x')).toBeNull();
  });
});

describe('pinQuote (64 §3.3)', () => {
  it('pins a resolvable span, or refuses an orphaned one', () => {
    const pinned = pinQuote(
      chapter(),
      { paragraphId: 'p1', quote: 'said nothing' },
      'said nothing',
    );
    expect(pinned?.pinnedQuotes[0]?.text).toBe('said nothing');
    expect(pinQuote(chapter(), { paragraphId: 'p1', quote: 'sang loudly' }, 'x')).toBeNull();
  });
});

describe('enforceProtected (64 §5.3/§5.4) — code-enforced preservation', () => {
  it('leaves a compliant rewrite untouched', () => {
    const res = enforceProtected(MD, [{ anchor: { paragraphId: 'p0' }, text: 'cut pine' }], []);
    expect(res.reinserted).toBe(0);
    expect(res.markdown).toBe(MD);
  });

  it('splices a dropped protected block back into its anchored paragraph', () => {
    const rewrite = 'The garage smelled of something.\n\nHe watched the lathe turn.';
    const res = enforceProtected(
      rewrite,
      [{ anchor: { paragraphId: 'p0', quote: 'cut pine' }, text: 'cut pine' }],
      [],
    );
    expect(res.reinserted).toBe(1);
    expect(res.markdown).toContain('cut pine'); // the person’s own words survive the rewrite
    // Appended to its anchored paragraph (p0), not the tail.
    expect(res.markdown.split(/\n{2,}/)[0]).toContain('cut pine');
  });

  it('splices a dropped pinned quote back, appending as a trailing paragraph when its anchor is gone', () => {
    const rewrite = 'Only one short paragraph now.';
    const res = enforceProtected(
      rewrite,
      [],
      [{ anchor: { paragraphId: 'p9', quote: 'said nothing' }, text: 'said nothing' }],
    );
    expect(res.reinserted).toBe(1);
    expect(res.markdown.endsWith('said nothing')).toBe(true);
  });
});

describe('markup + to-do persistence (64 §3.3)', () => {
  const key = generateMasterKey();

  it('round-trips a chapter markup layer and the book-level to-do roll-up', async () => {
    const fs = memFileSystem();
    // Empty by default (never null).
    expect((await getMarkup(fs, key, 'me', 'b1', 'c1')).marks).toEqual([]);
    expect((await getTodos(fs, key, 'me', 'b1')).todos).toEqual([]);

    const markup: ChapterMarkup = {
      schemaVersion: 1,
      chapterId: 'c1',
      marks: [
        {
          id: 'm1',
          kind: 'delete',
          anchor: { paragraphId: 'p0', quote: 'cut pine' },
          status: 'pending',
          createdAt: 'now',
        },
      ],
    };
    await saveMarkup(fs, key, 'me', 'b1', markup);
    expect((await getMarkup(fs, key, 'me', 'b1', 'c1')).marks[0]?.id).toBe('m1');

    const todos: StoryTodoList = {
      schemaVersion: 1,
      todos: [
        {
          id: 't1',
          chapterId: 'c1',
          kind: 'remind',
          text: 'upload Dad’s shop photo',
          status: 'open',
          createdAt: 'now',
        },
      ],
    };
    await saveTodos(fs, key, 'me', 'b1', todos);
    expect((await getTodos(fs, key, 'me', 'b1')).todos[0]?.text).toBe('upload Dad’s shop photo');
  });
});

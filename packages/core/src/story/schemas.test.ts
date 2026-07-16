import { describe, expect, it } from 'vitest';
import {
  BookChapterSchema,
  BookConfigSchema,
  BookManifestSchema,
  BookOutlineSchema,
  ChapterMarkupSchema,
  ExclusionListSchema,
  LifeTimelineSchema,
  MarkupMarkSchema,
  StoryInterviewStateSchema,
  StoryTodoListSchema,
} from '../schemas';

describe('Your Story schemas (64)', () => {
  it('BookConfig applies the owner-approved defaults', () => {
    const cfg = BookConfigSchema.parse({});
    expect(cfg).toEqual({ voice: 'third', style: 'warm', length: 'standard', autoRefresh: true });
  });

  it('BookManifest round-trips and defaults sharedWith to []', () => {
    const manifest = BookManifestSchema.parse({
      id: 'b1',
      schemaVersion: 1,
      personId: 'p1',
      type: 'biography',
      title: 'The Story of Ben',
      config: BookConfigSchema.parse({}),
      status: 'outlining',
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
    });
    expect(manifest.sharedWith).toEqual([]);
    expect(manifest.publishedAt).toBeUndefined();
  });

  it('BookChapter defaults the collection fields so a bare chapter parses', () => {
    const chapter = BookChapterSchema.parse({
      id: 'c1',
      schemaVersion: 1,
      partId: 'part1',
      order: 0,
      title: 'The Garage on Linden Street',
      status: 'new',
    });
    expect(chapter.markdown).toBe('');
    expect(chapter.revision).toBe(0);
    expect(chapter.provenance).toEqual([]);
    expect(chapter.protectedBlocks).toEqual([]);
    expect(chapter.pinnedQuotes).toEqual([]);
    expect(chapter.imagePlacements).toEqual([]);
  });

  it('ChapterStatus accepts the full lifecycle incl. updated', () => {
    for (const status of ['generating', 'new', 'updated', 'stale', 'reviewed'] as const) {
      expect(
        BookChapterSchema.parse({
          id: 'c',
          schemaVersion: 1,
          partId: 'p',
          order: 0,
          title: 't',
          status,
        }).status,
      ).toBe(status);
    }
  });

  it('MarkupMark is discriminated on kind (comment / delete / todo)', () => {
    const comment = MarkupMarkSchema.parse({
      id: 'm1',
      kind: 'comment',
      anchor: { paragraphId: 'para1', quote: 'the lathe' },
      intent: 'addContext',
      text: "it was my grandfather's",
      createdAt: '2026-07-15T00:00:00.000Z',
    });
    expect(comment.kind).toBe('comment');
    if (comment.kind === 'comment') expect(comment.status).toBe('open'); // default

    const del = MarkupMarkSchema.parse({
      id: 'm2',
      kind: 'delete',
      anchor: { paragraphId: 'para2' },
      createdAt: '2026-07-15T00:00:00.000Z',
    });
    if (del.kind === 'delete') expect(del.status).toBe('pending'); // default

    const todo = MarkupMarkSchema.parse({
      id: 'm3',
      kind: 'todo',
      text: 'go deeper on the winter Dad got sick',
      todoKind: 'questions',
      createdAt: '2026-07-15T00:00:00.000Z',
    });
    if (todo.kind === 'todo') {
      expect(todo.status).toBe('open'); // default
      expect(todo.anchor).toBeUndefined(); // to-dos may be chapter-level (no anchor)
    }

    expect(() => MarkupMarkSchema.parse({ id: 'x', kind: 'nope' })).toThrow();
  });

  it('a comment mark can carry the flag-to-Memory hand-off id', () => {
    const m = MarkupMarkSchema.parse({
      id: 'm',
      kind: 'comment',
      anchor: { paragraphId: 'p' },
      intent: 'fix',
      text: 'wrong sister',
      flagInsightId: 'insight-9',
      createdAt: '2026-07-15T00:00:00.000Z',
    });
    if (m.kind === 'comment') expect(m.flagInsightId).toBe('insight-9');
  });

  it('empty container schemas default to empty collections', () => {
    expect(ChapterMarkupSchema.parse({ schemaVersion: 1, chapterId: 'c1' }).marks).toEqual([]);
    expect(StoryTodoListSchema.parse({ schemaVersion: 1 }).todos).toEqual([]);
    expect(ExclusionListSchema.parse({ schemaVersion: 1 }).items).toEqual([]);
    expect(BookOutlineSchema.parse({ schemaVersion: 1 }).parts).toEqual([]);
    expect(BookOutlineSchema.parse({ schemaVersion: 1 }).approved).toBe(false);
    expect(LifeTimelineSchema.parse({ schemaVersion: 1 }).events).toEqual([]);
  });

  it('StoryInterviewState builds a complete framework-coverage default', () => {
    const state = StoryInterviewStateSchema.parse({ schemaVersion: 1 });
    expect(state.askedPrompts).toEqual([]);
    expect(state.photoAnswers).toEqual([]);
    expect(state.frameworkCoverage).toEqual({
      chapters: false,
      scenes: {},
      challenges: false,
      ideology: false,
      futureScript: false,
    });
  });

  it('an exclusion item carries its scope kind', () => {
    const list = ExclusionListSchema.parse({
      schemaVersion: 1,
      items: [
        { id: 'e1', kind: 'person', value: 'person-ex', createdAt: '2026-07-15T00:00:00.000Z' },
        { id: 'e2', kind: 'topic', value: 'the divorce', createdAt: '2026-07-15T00:00:00.000Z' },
      ],
    });
    expect(list.items.map((i) => i.kind)).toEqual(['person', 'topic']);
  });
});

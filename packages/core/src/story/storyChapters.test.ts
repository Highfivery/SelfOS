import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import type { ClaudeClient, ClaudeUsage } from '../host';
import { memFileSystem } from '../host/memFileSystem';
import { saveInsight } from '../insights';
import { savePerson } from '../people';
import type { AiDeps } from '../questionnaires';
import { costOf, setPersonBudget } from '../usage';
import type {
  BookOutline,
  DeleteMark,
  Insight,
  LifeTimeline,
  MarkupMark,
  Person,
  StorySourceRef,
} from '../schemas';
import {
  applyMarkup,
  chapterParagraphs,
  generateBookChapters,
  generateChapter,
  pendingRevisionMarks,
  stripSourceMarkers,
} from './storyGenerationService';
import { addMark } from './storyMarkupService';
import {
  applyFoundations,
  approveOutline,
  createBook,
  getBook,
  getChapter,
  getMarkup,
  getTodos,
  saveChapter,
  saveMarkup,
} from './storyService';

const key = generateMasterKey();
const now = new Date('2026-07-15T00:00:00.000Z');

const USAGE: ClaudeUsage = {
  inputTokens: 500,
  outputTokens: 400,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
};
function fakeClient(text: string): ClaudeClient {
  return { send: async () => text, stream: async () => ({ text, usage: USAGE }) };
}
/** Returns each text in turn (then repeats the last) — so different chapters in one orchestrator run get
 *  different replies (e.g. one empty → fails, the next real → succeeds). */
function sequenceClient(texts: string[]): ClaudeClient {
  let i = 0;
  const next = (): string => texts[Math.min(i, texts.length - 1)] ?? '';
  return {
    send: async () => next(),
    stream: async () => {
      const text = next();
      i += 1;
      return { text, usage: USAGE };
    },
  };
}
function deps(fs: ReturnType<typeof memFileSystem>, client: ClaudeClient): AiDeps {
  return { fs, key, client, apiKey: 'sk', model: 'claude-sonnet-4-6', personId: 'me', now };
}

const person: Person = {
  id: 'me',
  schemaVersion: 2,
  displayName: 'Ben',
  isSubject: true,
  tags: [],
  createdAt: 'now',
  updatedAt: 'now',
};
const insight: Insight = {
  id: 'i1',
  schemaVersion: 1,
  source: 'session',
  subjectPersonId: 'me',
  summary: 'A childhood in a machine shop.',
  facts: [
    {
      id: 'f1',
      text: 'His father worked a lathe with the door open to the cold.',
      shareable: false,
    },
  ],
  confidence: 'medium',
  categories: [],
  approved: true,
  provenance: { at: '2026-05-01T00:00:00.000Z' },
  createdAt: 'now',
  updatedAt: 'now',
};
const outline: BookOutline = {
  schemaVersion: 1,
  approved: true,
  parts: [
    {
      id: 'p1',
      title: 'Roots',
      chapters: [
        {
          id: 'c1',
          title: 'The Garage',
          brief: 'He learns a machine obeys.',
          lifeAreas: [],
          order: 0,
        },
        {
          id: 'c2',
          title: 'What the House Held',
          brief: 'The quiet after dark.',
          lifeAreas: [],
          order: 1,
        },
      ],
    },
  ],
};
const timeline: LifeTimeline = { schemaVersion: 1, events: [] };

async function seedApprovedBook(fs: ReturnType<typeof memFileSystem>): Promise<string> {
  await savePerson(fs, key, person);
  await saveInsight(fs, key, insight);
  const book = await createBook(fs, key, {
    personId: 'me',
    type: 'biography',
    title: 'The Story of Ben',
    config: { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true },
    now,
  });
  await applyFoundations(
    fs,
    key,
    'me',
    book.id,
    { essence: 'A quiet man.', outline, timeline },
    now,
  );
  await approveOutline(fs, key, 'me', book.id, outline, now);
  return book.id;
}

describe('stripSourceMarkers (64 §5.3)', () => {
  const ref0: StorySourceRef = { kind: 'insight', id: 'i1' };
  const ref1: StorySourceRef = { kind: 'dream', id: 'd1' };
  const map = new Map<string, StorySourceRef>([
    ['s0', ref0],
    ['s1', ref1],
  ]);

  it('strips markers and anchors provenance per paragraph', () => {
    const { markdown, provenance } = stripSourceMarkers(
      'The garage smelled of oil. [[SRC:s0]]\n\nHe watched the shavings fall. [[SRC:s1,s0]]',
      map,
    );
    expect(markdown).not.toContain('[[SRC');
    expect(markdown).toContain('The garage smelled of oil.');
    expect(provenance).toEqual([
      { anchor: 'p0', refs: [ref0] },
      { anchor: 'p1', refs: [ref1, ref0] },
    ]);
  });

  it('drops an unknown tag and dedups repeats; a tagless paragraph gets no provenance', () => {
    const { markdown, provenance } = stripSourceMarkers(
      'One. [[SRC:s0,s0,s9]]\n\nTwo, with nothing to cite.',
      map,
    );
    expect(markdown).not.toContain('[[SRC');
    expect(provenance).toEqual([{ anchor: 'p0', refs: [ref0] }]); // s0 once, s9 dropped, p1 has none
  });

  it('anchors by the OUTPUT paragraph index so a dropped leading block does not shift it', () => {
    // Leading blank → an empty first block that's dropped. The cited paragraph must anchor to p0, not p1,
    // so it matches chapterParagraphs of the stored markdown.
    const { markdown, provenance } = stripSourceMarkers('\n\nFirst. [[SRC:s0]]\n\nSecond.', map);
    const paras = chapterParagraphs(markdown);
    expect(paras).toEqual(['First.', 'Second.']);
    expect(provenance).toEqual([{ anchor: 'p0', refs: [ref0] }]);
    expect(paras[0]).toBe('First.'); // p0 → the first rendered paragraph
  });

  it('re-splits a block whose stripped own-line marker leaves an internal blank, matching the reader', () => {
    // `First half.\n[[SRC:s0]]\nSecond half.` is ONE source block, but cleaning the own-line marker leaves a
    // `\n\n` → the reader's chapterParagraphs sees TWO paragraphs. Anchoring must split the same way (or every
    // later anchor drifts): the block's refs attach to its first paragraph, and the stored markdown re-splits
    // back to exactly those paragraphs.
    const { markdown, provenance } = stripSourceMarkers(
      'First half.\n[[SRC:s0]]\nSecond half.\n\nA new thought. [[SRC:s1]]',
      map,
    );
    const paras = chapterParagraphs(markdown);
    expect(paras).toEqual(['First half.', 'Second half.', 'A new thought.']);
    expect(provenance).toEqual([
      { anchor: 'p0', refs: [ref0] }, // the first block's citation → its first paragraph
      { anchor: 'p2', refs: [ref1] }, // the third paragraph, not p1 — no drift
    ]);
  });
});

describe('generateChapter (64 §5.3)', () => {
  it('generates a chapter: clean markdown + provenance, status new, revision 1', async () => {
    const fs = memFileSystem();
    const bookId = await seedApprovedBook(fs);
    const res = await generateChapter(
      deps(
        fs,
        fakeClient('The garage smelled of cut pine. [[SRC:s0]]\n\nHe watched, and said nothing.'),
      ),
      { bookId, chapterId: 'c1' },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.chapter.markdown).not.toContain('[[SRC');
    expect(res.chapter.markdown).toContain('cut pine');
    expect(res.chapter.status).toBe('new');
    expect(res.chapter.revision).toBe(1);
    // A first draft has nothing to diff against — no retained prior text (§13.5).
    expect(res.chapter.previousMarkdown).toBeUndefined();
    expect(res.chapter.partId).toBe('p1');
    expect(res.chapter.title).toBe('The Garage'); // from the outline, never the model
    expect(res.chapter.provenance[0]?.refs[0]?.id).toBe('i1'); // s0 resolved to the seeded insight
    // Persisted.
    const saved = await getChapter(fs, key, 'me', bookId, 'c1');
    expect(saved?.markdown).toContain('cut pine');
  });

  it('a regenerate bumps revision and marks the chapter updated', async () => {
    const fs = memFileSystem();
    const bookId = await seedApprovedBook(fs);
    await generateChapter(deps(fs, fakeClient('First draft.')), { bookId, chapterId: 'c1' });
    const res = await generateChapter(deps(fs, fakeClient('Second draft, richer.')), {
      bookId,
      chapterId: 'c1',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.chapter.status).toBe('updated');
    expect(res.chapter.revision).toBe(2);
    expect(res.chapter.markdown).toContain('Second draft');
    // The prior text is retained so the "What changed" diff can show what the rewrite altered (§13.5).
    expect(res.chapter.previousMarkdown).toBe('First draft.');
  });

  it('an empty reply is an honest failure (never a blank chapter)', async () => {
    const fs = memFileSystem();
    const bookId = await seedApprovedBook(fs);
    const res = await generateChapter(deps(fs, fakeClient('   ')), { bookId, chapterId: 'c1' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('TRUNCATED');
  });

  it('refuses a chapter id that is not in the outline', async () => {
    const fs = memFileSystem();
    const bookId = await seedApprovedBook(fs);
    const res = await generateChapter(deps(fs, fakeClient('x')), { bookId, chapterId: 'nope' });
    expect(res.ok).toBe(false);
  });
});

describe('generateBookChapters — the orchestrator (64 §5.3)', () => {
  it('writes every chapter once, marks the book ready, and is idempotent on re-run', async () => {
    const fs = memFileSystem();
    const bookId = await seedApprovedBook(fs);
    const first = await generateBookChapters(
      deps(fs, fakeClient('A rendered scene. [[SRC:s0]]')),
      bookId,
    );
    expect(first.ok).toBe(true);
    expect(first.generated).toBe(2); // both chapters
    expect((await getBook(fs, key, 'me', bookId))?.status).toBe('ready');
    expect((await getChapter(fs, key, 'me', bookId, 'c1'))?.markdown).toContain('rendered scene');
    expect((await getChapter(fs, key, 'me', bookId, 'c2'))?.markdown).toContain('rendered scene');
    // Re-run generates nothing (both already written, non-stale).
    const second = await generateBookChapters(deps(fs, fakeClient('should not overwrite')), bookId);
    expect(second.generated).toBe(0);
    expect((await getChapter(fs, key, 'me', bookId, 'c1'))?.markdown).not.toContain(
      'should not overwrite',
    );
  });

  it('reports per-chapter progress via onProgress (§3.2): each chapter about-to-write, with a running done count', async () => {
    const fs = memFileSystem();
    const bookId = await seedApprovedBook(fs);
    const seen: { chaptersDone: number; chaptersTotal: number; title: string }[] = [];
    await generateBookChapters(deps(fs, fakeClient('A rendered scene. [[SRC:s0]]')), bookId, (p) =>
      seen.push(p),
    );
    // One update per chapter, in order, total constant, done climbing (0 then 1) as each starts.
    expect(seen).toHaveLength(2);
    expect(seen.every((p) => p.chaptersTotal === 2)).toBe(true);
    expect(seen.map((p) => p.chaptersDone)).toEqual([0, 1]);
    expect(seen.map((p) => p.title.length > 0)).toEqual([true, true]);
  });

  it('stops cleanly on BUDGET, leaves the book unfinished, and resumes when the budget is raised', async () => {
    const fs = memFileSystem();
    const bookId = await seedApprovedBook(fs);
    // A budget that admits exactly ONE chapter's cost: after c1 records usage, c2's pre-call check trips over.
    await setPersonBudget(fs, key, 'me', {
      limitUsd: costOf('claude-sonnet-4-6', USAGE),
      period: 'week',
      warnRatio: 0.8,
    });
    const first = await generateBookChapters(deps(fs, fakeClient('Scene. [[SRC:s0]]')), bookId);
    expect(first.ok).toBe(true);
    expect(first.generated).toBe(1); // c1 only — c2 stopped at the budget
    expect(first.reason).toBe('BUDGET');
    expect((await getBook(fs, key, 'me', bookId))?.status).not.toBe('ready'); // not fully drafted
    expect(await getChapter(fs, key, 'me', bookId, 'c1')).not.toBeNull();
    expect(await getChapter(fs, key, 'me', bookId, 'c2')).toBeNull();

    // Raise the budget → the queue resumes, writes only the remaining c2, and the book becomes ready.
    await setPersonBudget(fs, key, 'me', { limitUsd: 100, period: 'week', warnRatio: 0.8 });
    const second = await generateBookChapters(
      deps(fs, fakeClient('Second scene. [[SRC:s0]]')),
      bookId,
    );
    expect(second.generated).toBe(1); // just c2 (c1 already written → skipped)
    expect((await getBook(fs, key, 'me', bookId))?.status).toBe('ready');
    expect(await getChapter(fs, key, 'me', bookId, 'c2')).not.toBeNull();
  });

  it('writes what it can when one chapter fails, leaves the book unfinished, and stays quiet (partial)', async () => {
    const fs = memFileSystem();
    const bookId = await seedApprovedBook(fs);
    // c1 gets an empty reply (an honest per-chapter failure); c2 gets real prose.
    const res = await generateBookChapters(
      deps(fs, sequenceClient(['   ', 'A written scene. [[SRC:s0]]'])),
      bookId,
    );
    expect(res.ok).toBe(true); // a partial pass is a success — progress is visible in the overview
    expect(res.generated).toBe(1);
    expect((await getBook(fs, key, 'me', bookId))?.status).not.toBe('ready'); // c1 still unwritten
    expect(await getChapter(fs, key, 'me', bookId, 'c1')).toBeNull();
    expect((await getChapter(fs, key, 'me', bookId, 'c2'))?.markdown).toContain('written scene');
  });

  it('surfaces an honest failure when EVERY chapter fails (never a silent dead-end)', async () => {
    const fs = memFileSystem();
    const bookId = await seedApprovedBook(fs);
    const res = await generateBookChapters(deps(fs, fakeClient('   ')), bookId); // every reply empty
    expect(res.ok).toBe(false);
    expect(res.generated).toBe(0);
    expect(res.reason).toBe('TRUNCATED');
    expect(res.message).toBeTruthy();
    expect((await getBook(fs, key, 'me', bookId))?.status).not.toBe('ready');
  });

  it('rewrites a stale chapter but never a reviewed one', async () => {
    const fs = memFileSystem();
    const bookId = await seedApprovedBook(fs);
    await generateBookChapters(deps(fs, fakeClient('Original prose. [[SRC:s0]]')), bookId);
    // c1 is reviewed (locked); c2 is flagged stale (new material to fold in).
    const c1 = await getChapter(fs, key, 'me', bookId, 'c1');
    const c2 = await getChapter(fs, key, 'me', bookId, 'c2');
    if (!c1 || !c2) throw new Error('seed failed');
    await saveChapter(fs, key, 'me', bookId, { ...c1, status: 'reviewed' });
    await saveChapter(fs, key, 'me', bookId, { ...c2, status: 'stale' });

    const res = await generateBookChapters(
      deps(fs, fakeClient('Fresh rewrite. [[SRC:s0]]')),
      bookId,
    );
    expect(res.generated).toBe(1); // only the stale c2
    expect((await getChapter(fs, key, 'me', bookId, 'c1'))?.markdown).toContain('Original prose'); // untouched
    expect((await getChapter(fs, key, 'me', bookId, 'c1'))?.status).toBe('reviewed');
    expect((await getChapter(fs, key, 'me', bookId, 'c2'))?.markdown).toContain('Fresh rewrite');
  });
});

describe('pendingRevisionMarks (64 §5.3)', () => {
  it('includes pending deletes + open addContext/fix comments + open ask to-dos; excludes the rest', () => {
    const anchor = { paragraphId: 'p0', quote: 'x' };
    const marks: MarkupMark[] = [
      { id: 'd1', kind: 'delete', anchor, status: 'pending', createdAt: 'n' },
      { id: 'd2', kind: 'delete', anchor, status: 'applied', createdAt: 'n' }, // already applied
      {
        id: 'c1',
        kind: 'comment',
        anchor,
        intent: 'addContext',
        text: 'a',
        status: 'open',
        createdAt: 'n',
      },
      {
        id: 'c2',
        kind: 'comment',
        anchor,
        intent: 'fix',
        text: 'b',
        status: 'open',
        createdAt: 'n',
      },
      {
        id: 'c3',
        kind: 'comment',
        anchor,
        intent: 'question',
        text: '?',
        status: 'open',
        createdAt: 'n',
      }, // dialogue
      { id: 't1', kind: 'todo', text: 'ask this', todoKind: 'ask', status: 'open', createdAt: 'n' },
      {
        id: 't2',
        kind: 'todo',
        text: 'remind me',
        todoKind: 'remind',
        status: 'open',
        createdAt: 'n',
      }, // personal
      {
        id: 't3',
        kind: 'todo',
        text: 'go deeper',
        todoKind: 'questions',
        status: 'open',
        createdAt: 'n',
      }, // interviews
    ];
    expect(pendingRevisionMarks(marks).map((m) => m.id)).toEqual(['d1', 'c1', 'c2', 't1']);
  });
});

describe('applyMarkup — the batch revision (64 §3.3.1/§5.3)', () => {
  async function seedWrittenChapter(fs: ReturnType<typeof memFileSystem>): Promise<string> {
    const bookId = await seedApprovedBook(fs);
    await generateChapter(deps(fs, fakeClient('The garage smelled of cut pine. [[SRC:s0]]')), {
      bookId,
      chapterId: 'c1',
    });
    return bookId;
  }

  it('applies pending marks: bumps the revision, marks the chapter updated, stamps the marks applied', async () => {
    const fs = memFileSystem();
    const bookId = await seedWrittenChapter(fs);
    const mark: DeleteMark = {
      id: 'd1',
      kind: 'delete',
      anchor: { paragraphId: 'p0', quote: 'cut pine' },
      status: 'pending',
      createdAt: 'now',
    };
    await saveMarkup(fs, key, 'me', bookId, { schemaVersion: 1, chapterId: 'c1', marks: [mark] });

    const res = await applyMarkup(deps(fs, fakeClient('The garage was quiet. [[SRC:s0]]')), {
      bookId,
      chapterId: 'c1',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.chapter.status).toBe('updated');
    expect(res.chapter.revision).toBe(2);
    expect(res.chapter.markdown).toContain('was quiet');
    // The pre-revision text is retained for the "What changed" diff (§13.5).
    expect(res.chapter.previousMarkdown).toContain('cut pine');
    const marks = (await getMarkup(fs, key, 'me', bookId, 'c1')).marks;
    expect(marks[0]?.status).toBe('applied');
    expect((marks[0] as DeleteMark).appliedRevision).toBe(2);
  });

  it('code-enforces a protected block the revision dropped (never loses the person’s words)', async () => {
    const fs = memFileSystem();
    const bookId = await seedWrittenChapter(fs);
    const existing = await getChapter(fs, key, 'me', bookId, 'c1');
    if (!existing) throw new Error('seed');
    await saveChapter(fs, key, 'me', bookId, {
      ...existing,
      protectedBlocks: [
        { anchor: { paragraphId: 'p0', quote: 'my own words' }, text: 'my own words' },
      ],
    });
    await saveMarkup(fs, key, 'me', bookId, {
      schemaVersion: 1,
      chapterId: 'c1',
      marks: [
        {
          id: 'c1m',
          kind: 'comment',
          anchor: { paragraphId: 'p0', quote: 'cut pine' },
          intent: 'addContext',
          text: 'add a detail',
          status: 'open',
          createdAt: 'now',
        },
      ],
    });
    // The fake revision omits the protected text entirely — enforcement must splice it back.
    const res = await applyMarkup(
      deps(fs, fakeClient('A totally rewritten paragraph. [[SRC:s0]]')),
      { bookId, chapterId: 'c1' },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.chapter.markdown).toContain('my own words');
  });

  it('is an honest no-op when there is nothing pending', async () => {
    const fs = memFileSystem();
    const bookId = await seedWrittenChapter(fs);
    const res = await applyMarkup(deps(fs, fakeClient('unused')), { bookId, chapterId: 'c1' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.message).toMatch(/no changes/i);
  });

  it('does not apply a question comment (dialogue, not an edit)', async () => {
    const fs = memFileSystem();
    const bookId = await seedWrittenChapter(fs);
    await saveMarkup(fs, key, 'me', bookId, {
      schemaVersion: 1,
      chapterId: 'c1',
      marks: [
        {
          id: 'q1',
          kind: 'comment',
          anchor: { paragraphId: 'p0', quote: 'cut pine' },
          intent: 'question',
          text: 'why frame it this way?',
          status: 'open',
          createdAt: 'now',
        },
      ],
    });
    const res = await applyMarkup(deps(fs, fakeClient('unused')), { bookId, chapterId: 'c1' });
    expect(res.ok).toBe(false); // a lone question comment leaves nothing to apply
  });

  it('flips an applied ask to-do in the book-level roll-up too (no denormalization drift)', async () => {
    const fs = memFileSystem();
    const bookId = await seedWrittenChapter(fs);
    // Add an `ask` to-do through the real path so the roll-up starts with it `open`.
    await addMark(fs, key, 'me', bookId, 'c1', {
      id: 'a1',
      kind: 'todo',
      text: 'go deeper on the winter he got sick',
      todoKind: 'ask',
      status: 'open',
      createdAt: 'now',
    });
    expect((await getTodos(fs, key, 'me', bookId)).todos[0]?.status).toBe('open');

    const res = await applyMarkup(deps(fs, fakeClient('A deeper scene. [[SRC:s0]]')), {
      bookId,
      chapterId: 'c1',
    });
    expect(res.ok).toBe(true);
    // The chapter markup AND the denormalized roll-up both show the ask to-do applied.
    expect((await getMarkup(fs, key, 'me', bookId, 'c1')).marks[0]?.status).toBe('applied');
    expect((await getTodos(fs, key, 'me', bookId)).todos[0]?.status).toBe('applied');
  });
});

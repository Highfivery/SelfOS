import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import type { ClaudeClient, ClaudeUsage } from '../host';
import { memFileSystem } from '../host/memFileSystem';
import { saveInsight } from '../insights';
import { savePerson } from '../people';
import type { AiDeps } from '../questionnaires';
import type { BookOutline, Insight, LifeTimeline, Person, StorySourceRef } from '../schemas';
import {
  generateBookChapters,
  generateChapter,
  stripSourceMarkers,
} from './storyGenerationService';
import { applyFoundations, approveOutline, createBook, getBook, getChapter } from './storyService';

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
});

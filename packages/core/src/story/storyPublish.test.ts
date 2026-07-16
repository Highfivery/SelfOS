import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import type { ClaudeClient, ClaudeUsage } from '../host';
import { memFileSystem } from '../host/memFileSystem';
import { saveInsight } from '../insights';
import { savePerson } from '../people';
import type { AiDeps } from '../questionnaires';
import type { BookChapter, BookOutline, Insight, LifeTimeline, Person } from '../schemas';
import { generateChapter } from './storyGenerationService';
import {
  bookMentionsReader,
  grantReader,
  listSharedBooks,
  noteOnBook,
  publishBook,
  readSharedBook,
  revokeReader,
} from './storyPublish';
import {
  applyFoundations,
  approveOutline,
  createBook,
  getBook,
  getChapter,
  saveChapter,
} from './storyService';

const key = generateMasterKey();
const now = new Date('2026-07-16T00:00:00.000Z');
const USAGE: ClaudeUsage = {
  inputTokens: 1,
  outputTokens: 1,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
};
const fakeClient = (text: string): ClaudeClient => ({
  send: async () => text,
  stream: async () => ({ text, usage: USAGE }),
});
const deps = (fs: ReturnType<typeof memFileSystem>): AiDeps => ({
  fs,
  key,
  client: fakeClient('The garage. [[SRC:s0]]'),
  apiKey: 'sk',
  model: 'claude-sonnet-4-6',
  personId: 'author',
  now,
});
const person = (id: string, displayName: string): Person => ({
  id,
  schemaVersion: 2,
  displayName,
  isSubject: true,
  tags: [],
  createdAt: 'now',
  updatedAt: 'now',
});
const insight: Insight = {
  id: 'i1',
  schemaVersion: 1,
  source: 'session',
  subjectPersonId: 'author',
  summary: 'A winter.',
  facts: [{ id: 'f1', text: 'the winter was cold', shareable: false }],
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
        { id: 'c1', title: 'The Garage', brief: 'A machine obeys.', lifeAreas: [], order: 0 },
        { id: 'c2', title: 'The Road', brief: 'Leaving home.', lifeAreas: [], order: 1 },
      ],
    },
  ],
};
const timeline: LifeTimeline = { schemaVersion: 1, events: [] };

/** Seed an author with a two-chapter book; c1 is written + Reviewed, c2 is written but NOT reviewed. */
async function seedBook(fs: ReturnType<typeof memFileSystem>): Promise<string> {
  await savePerson(fs, key, person('author', 'Ben'));
  await savePerson(fs, key, person('reader', 'Angel'));
  await saveInsight(fs, key, insight);
  const book = await createBook(fs, key, {
    personId: 'author',
    type: 'biography',
    title: 'The Story of Ben',
    config: { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true },
    now,
  });
  await applyFoundations(
    fs,
    key,
    'author',
    book.id,
    { essence: 'A quiet man.', outline, timeline },
    now,
  );
  await approveOutline(fs, key, 'author', book.id, outline, now);
  await generateChapter(deps(fs), { bookId: book.id, chapterId: 'c1' });
  await generateChapter(deps(fs), { bookId: book.id, chapterId: 'c2' });
  // Mark only c1 Reviewed.
  const c1 = await getChapter(fs, key, 'author', book.id, 'c1');
  await saveChapter(fs, key, 'author', book.id, { ...c1!, status: 'reviewed' });
  return book.id;
}

describe('publishBook (64 §3.5)', () => {
  it('refuses to publish when nothing is Reviewed yet (the review gate)', async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person('author', 'Ben'));
    await saveInsight(fs, key, insight);
    const book = await createBook(fs, key, {
      personId: 'author',
      type: 'biography',
      title: 'x',
      config: { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true },
      now,
    });
    await applyFoundations(fs, key, 'author', book.id, { essence: 'x', outline, timeline }, now);
    await approveOutline(fs, key, 'author', book.id, outline, now);
    await generateChapter(deps(fs), { bookId: book.id, chapterId: 'c1' }); // status 'new', not reviewed
    const res = await publishBook(fs, key, 'author', book.id, now);
    expect(res.ok).toBe(false);
  });

  it('snapshots ONLY Reviewed chapters; a later draft edit does not leak into the published head', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    const res = await publishBook(fs, key, 'author', bookId, now);
    expect(res).toMatchObject({ ok: true, publishedChapters: 1 });
    // The draft manifest is stamped published.
    expect((await getBook(fs, key, 'author', bookId))?.publishedAt).toBeTruthy();

    // Grant the reader, then read the published head: exactly the one Reviewed chapter (c2 is excluded).
    await grantReader(fs, key, 'author', bookId, 'reader', now);
    const view = await readSharedBook(fs, key, 'reader', 'author', bookId);
    expect(view?.chapters.map((c) => c.id)).toEqual(['c1']);
    const originalProse = view!.chapters[0]!.markdown;
    expect(view?.manifest.title).toBe('The Story of Ben');
    expect(view?.manifest.noteOnBook).toContain('never invented');
    // The reader gets the MINIMAL shape only — the author's per-paragraph source provenance never crosses.
    expect(Object.keys(view!.chapters[0]!).sort()).toEqual(['id', 'markdown', 'title']);
    expect('provenance' in view!.chapters[0]!).toBe(false);

    // Edit the DRAFT c1 after publishing — the reader's head is unchanged (snapshot isolation).
    const c1 = await getChapter(fs, key, 'author', bookId, 'c1');
    await saveChapter(fs, key, 'author', bookId, { ...c1!, markdown: 'Rewritten draft prose.' });
    const after = await readSharedBook(fs, key, 'reader', 'author', bookId);
    expect(after?.chapters[0]?.markdown).toBe(originalProse);
  });

  it('re-publishing prunes a chapter that is no longer Reviewed', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    // Review c2 too → publish → head has both.
    const c2 = await getChapter(fs, key, 'author', bookId, 'c2');
    await saveChapter(fs, key, 'author', bookId, { ...c2!, status: 'reviewed' });
    await publishBook(fs, key, 'author', bookId, now);
    await grantReader(fs, key, 'author', bookId, 'reader', now);
    expect((await readSharedBook(fs, key, 'reader', 'author', bookId))?.chapters).toHaveLength(2);
    // Un-review c2 (e.g. it drifted) → re-publish → the head drops it.
    const c2b = await getChapter(fs, key, 'author', bookId, 'c2');
    await saveChapter(fs, key, 'author', bookId, { ...c2b!, status: 'stale' });
    await publishBook(fs, key, 'author', bookId, now);
    expect(
      (await readSharedBook(fs, key, 'reader', 'author', bookId))?.chapters.map((c) => c.id),
    ).toEqual(['c1']);
  });
});

describe('readers + the read-time re-gate (64 §3.5)', () => {
  it('grants/revokes readers; refuses the author + a non-household id', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    // Refuse granting the author themselves + a phantom person.
    expect(await grantReader(fs, key, 'author', bookId, 'author', now)).toEqual([]);
    expect(await grantReader(fs, key, 'author', bookId, 'ghost', now)).toEqual([]);
    // Grant a real household reader.
    const readers = await grantReader(fs, key, 'author', bookId, 'reader', now);
    expect(readers).toEqual([{ personId: 'reader', displayName: 'Angel' }]);
    // Idempotent.
    expect(await grantReader(fs, key, 'author', bookId, 'reader', now)).toHaveLength(1);
    // Revoke.
    expect(await revokeReader(fs, key, 'author', bookId, 'reader', now)).toEqual([]);
  });

  it('a shared book is readable only while published AND still granted (re-gate on every read)', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    // Published but not yet granted → the reader sees nothing.
    await publishBook(fs, key, 'author', bookId, now);
    expect(await listSharedBooks(fs, key, 'reader')).toEqual([]);
    expect(await readSharedBook(fs, key, 'reader', 'author', bookId)).toBeNull();
    // Granted → it appears + reads.
    await grantReader(fs, key, 'author', bookId, 'reader', now);
    const shared = await listSharedBooks(fs, key, 'reader');
    expect(shared).toHaveLength(1);
    expect(shared[0]).toMatchObject({
      authorName: 'Ben',
      title: 'The Story of Ben',
      chapterCount: 1,
    });
    expect(await readSharedBook(fs, key, 'reader', 'author', bookId)).not.toBeNull();
    // Revoke → access ends at the next read (no stale access).
    await revokeReader(fs, key, 'author', bookId, 'reader', now);
    expect(await listSharedBooks(fs, key, 'reader')).toEqual([]);
    expect(await readSharedBook(fs, key, 'reader', 'author', bookId)).toBeNull();
  });

  it('an unpublished book never appears to a granted reader', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    // Grant BEFORE publishing → still nothing to read (no published head).
    await grantReader(fs, key, 'author', bookId, 'reader', now);
    expect(await listSharedBooks(fs, key, 'reader')).toEqual([]);
    expect(await readSharedBook(fs, key, 'reader', 'author', bookId)).toBeNull();
  });
});

describe('honesty note + featured-reader scan', () => {
  it('the note is built from what the chapters actually drew on', () => {
    const chapters: BookChapter[] = [
      {
        id: 'c1',
        schemaVersion: 1,
        partId: 'p1',
        order: 0,
        title: 't',
        markdown: 'Angel was there.',
        revision: 1,
        status: 'reviewed',
        sourceSignature: '',
        provenance: [{ anchor: 'p0', refs: [{ kind: 'insight', id: 'i1', at: 'now' }] }],
        protectedBlocks: [],
        pinnedQuotes: [],
        imagePlacements: [],
      },
    ];
    expect(noteOnBook(chapters)).toContain('1 coaching insights');
    // The featured-reader scan is a word-boundary match.
    expect(bookMentionsReader(chapters, 'Angel')).toBe(true);
    expect(bookMentionsReader(chapters, 'Angela')).toBe(false);
  });
});

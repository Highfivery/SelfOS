import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import type { ClaudeClient, ClaudeUsage } from '../host';
import { memFileSystem } from '../host/memFileSystem';
import { saveInsight } from '../insights';
import { savePerson } from '../people';
import type { AiDeps } from '../questionnaires';
import { recordUsage } from '../usage';
import type { BookChapter, BookOutline, Insight, LifeTimeline, Person } from '../schemas';
import {
  finishEdition,
  isLiving,
  NEXT_EDITION_MATERIAL_THRESHOLD,
  offersNextEdition,
  reopenBook,
} from './storyEditions';
import { runStoryInterviewCadence, STORY_INTERVIEW_WEEKLY_CAP } from './storyInterviewService';
import { applyFoundations, approveOutline, createBook, getBook, saveChapter } from './storyService';

/** Editions + the living/finished lifecycle (72 §3.6/§4.5). */

const key = generateMasterKey();
const now = new Date('2026-08-13T00:00:00.000Z');
const USAGE: ClaudeUsage = {
  inputTokens: 5,
  outputTokens: 5,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
};
const client: ClaudeClient = {
  send: async () => '{}',
  stream: async () => ({ text: '{}', usage: USAGE }),
};
function deps(fs: ReturnType<typeof memFileSystem>): AiDeps {
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
  summary: 'A life.',
  facts: [{ id: 'f1', text: 'the garage', shareable: false }],
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
      chapters: [{ id: 'c1', title: 'One', brief: 'a', lifeAreas: [], order: 0 }],
    },
  ],
};
const timeline: LifeTimeline = { schemaVersion: 1, events: [] };

function chapter(markdown: string): BookChapter {
  return {
    id: 'c1',
    schemaVersion: 1,
    partId: 'p1',
    order: 0,
    title: 'One',
    markdown,
    revision: 1,
    status: 'reviewed',
    sourceSignature: 'sig',
    provenance: [],
    protectedBlocks: [],
    pinnedQuotes: [],
    imagePlacements: [],
    lastGeneratedAt: now.toISOString(),
  };
}

async function seedBook(
  fs: ReturnType<typeof memFileSystem>,
  markdown = 'The garage smelled of oil and cut pine.',
): Promise<string> {
  await savePerson(fs, key, person);
  await saveInsight(fs, key, insight);
  const book = await createBook(fs, key, {
    personId: 'me',
    type: 'biography',
    title: 'The Story of Ben',
    config: { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true },
    now,
  });
  await applyFoundations(fs, key, 'me', book.id, { essence: 'A life.', outline, timeline }, now);
  await approveOutline(fs, key, 'me', book.id, outline, now);
  if (markdown) await saveChapter(fs, key, 'me', book.id, chapter(markdown));
  return book.id;
}

describe('finishEdition (72 §3.6/§4.5)', () => {
  it('freezes what exists as edition 1 and marks the book finished', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);

    const res = await finishEdition(fs, key, 'me', bookId, now);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.edition).toMatchObject({ n: 1, chapterCount: 1 });
    expect(res.edition.wordCount).toBeGreaterThan(0);
    expect(res.book.lifecycle).toBe('finished');
    // The frozen copy is on disk, readable however much the living book changes afterwards.
    expect(await fs.list(`people/me/story/books/${bookId}/editions/1/chapters`)).toEqual([
      'c1.enc',
    ]);
  });

  it('refuses a book with nothing written — "finished" would be a lie about an empty book', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs, '');

    const res = await finishEdition(fs, key, 'me', bookId, now);

    expect(res.ok).toBe(false);
    expect(isLiving((await getBook(fs, key, 'me', bookId))!)).toBe(true);
  });

  it('a second edition is n=2, and the first stays frozen exactly as it was', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    await finishEdition(fs, key, 'me', bookId, now);
    const firstBytes = await fs.read(`people/me/story/books/${bookId}/editions/1/chapters/c1.enc`);

    // The book carries on and changes.
    await saveChapter(fs, key, 'me', bookId, chapter('A completely rewritten chapter.'));
    const second = await finishEdition(fs, key, 'me', bookId, now);

    expect(second.ok && second.edition.n).toBe(2);
    expect(await fs.read(`people/me/story/books/${bookId}/editions/1/chapters/c1.enc`)).toEqual(
      firstBytes,
    );
    expect((await getBook(fs, key, 'me', bookId))?.editions.map((e) => e.n)).toEqual([1, 2]);
  });

  it('reopening is not destructive — the editions stay, the book goes back to living', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    await finishEdition(fs, key, 'me', bookId, now);

    const reopened = await reopenBook(fs, key, 'me', bookId, now);

    expect(isLiving(reopened!)).toBe(true);
    expect(reopened?.editions).toHaveLength(1);
    expect(await fs.list(`people/me/story/books/${bookId}/editions/1/chapters`)).toEqual([
      'c1.enc',
    ]);
  });

  it('a book written before 72 has no lifecycle and is living', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    const book = await getBook(fs, key, 'me', bookId);
    expect(book?.lifecycle).toBeUndefined();
    expect(isLiving(book!)).toBe(true);
  });
});

describe('the finished book keeps growing quietly (72 §3.6)', () => {
  it('stops being interviewed for — that is what "finished" means', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);

    // Living: the cadence runs (whatever it decides).
    expect((await runStoryInterviewCadence(deps(fs), { bookId, auto: false })).outcome).not.toBe(
      'finished',
    );

    await finishEdition(fs, key, 'me', bookId, now);
    expect((await runStoryInterviewCadence(deps(fs), { bookId, auto: false })).outcome).toBe(
      'finished',
    );

    // Reopening resumes it.
    await reopenBook(fs, key, 'me', bookId, now);
    expect((await runStoryInterviewCadence(deps(fs), { bookId, auto: false })).outcome).not.toBe(
      'finished',
    );
  });

  it('offers a next edition only once enough has accumulated, and never for a living book', async () => {
    const finished = { lifecycle: 'finished' as const, editions: [] };
    const living = { lifecycle: 'living' as const, editions: [] };
    expect(offersNextEdition(finished, NEXT_EDITION_MATERIAL_THRESHOLD)).toBe(true);
    expect(offersNextEdition(finished, NEXT_EDITION_MATERIAL_THRESHOLD - 1)).toBe(false);
    expect(offersNextEdition(living, 99)).toBe(false); // already growing — nothing to offer
  });
});

describe('per-book cadence caps (72 §5.4)', () => {
  /**
   * The caps used to count every pass for the PERSON, so starting a second book silently spent the first
   * one's allowance and the first quietly stopped being interviewed for.
   */
  it('one book’s spent allowance does not throttle another', async () => {
    const fs = memFileSystem();
    const bookA = await seedBook(fs);
    const bookB = await createBook(fs, key, {
      personId: 'me',
      type: 'biography',
      title: 'Another Book',
      config: { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true },
      now,
    });
    await applyFoundations(fs, key, 'me', bookB.id, { essence: 'x', outline, timeline }, now);
    await approveOutline(fs, key, 'me', bookB.id, outline, now);

    // Spend book A's whole weekly interview allowance.
    for (let i = 0; i < STORY_INTERVIEW_WEEKLY_CAP; i += 1) {
      await recordUsage(fs, key, {
        id: `u${i}`,
        schemaVersion: 1,
        type: 'story.interview',
        personId: 'me',
        sessionId: bookA,
        model: 'claude-sonnet-4-6',
        at: new Date(now.getTime() - 60_000).toISOString(),
        inputTokens: 1,
        outputTokens: 1,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
        costUsd: 0,
      });
    }

    const a = await runStoryInterviewCadence(deps(fs), { bookId: bookA, auto: false });
    expect(a.outcome).toBe('throttled');
    expect(a.throttleReason).toBe('weeklyCap');

    // Book B still has its own allowance — it is not throttled by A's spend.
    const b = await runStoryInterviewCadence(deps(fs), { bookId: bookB.id, auto: false });
    expect(b.throttleReason).not.toBe('weeklyCap');
  });
});

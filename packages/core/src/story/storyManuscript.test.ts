import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import type { ClaudeClient, ClaudeStreamOptions, ClaudeUsage } from '../host';
import { memFileSystem } from '../host/memFileSystem';
import { saveInsight } from '../insights';
import { savePerson } from '../people';
import type { AiDeps } from '../questionnaires';
import { queryUsage } from '../usage';
import type { BookChapter, BookOutline, Insight, LifeTimeline, Person } from '../schemas';
import { checkContinuity } from './storyContinuity';
import { MIN_CHAPTERS_FOR_MANUSCRIPT, readManuscript } from './storyManuscript';
import { applyFoundations, approveOutline, createBook, saveChapter } from './storyService';

/**
 * The manuscript pass (72 §5.3) — the whole-book read, appending into the same review list the continuity
 * check writes to.
 */

const key = generateMasterKey();
const now = new Date('2026-08-13T00:00:00.000Z');
const USAGE: ClaudeUsage = {
  inputTokens: 500,
  outputTokens: 400,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
};

function capturingClient(text: string): { client: ClaudeClient; prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    client: {
      send: async () => text,
      stream: async (options: ClaudeStreamOptions) => {
        const first = options.messages[0];
        prompts.push(typeof first?.content === 'string' ? first.content : '');
        return { text, usage: USAGE };
      },
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
      chapters: [
        { id: 'c1', title: 'One', brief: 'a', lifeAreas: [], order: 0 },
        { id: 'c2', title: 'Two', brief: 'b', lifeAreas: [], order: 1 },
        { id: 'c3', title: 'Three', brief: 'c', lifeAreas: [], order: 2 },
      ],
    },
  ],
};
const timeline: LifeTimeline = { schemaVersion: 1, events: [] };

function chapter(id: string, title: string, markdown: string): BookChapter {
  return {
    id,
    schemaVersion: 1,
    partId: 'p1',
    order: 0,
    title,
    markdown,
    revision: 1,
    status: 'new',
    sourceSignature: 'sig',
    provenance: [],
    protectedBlocks: [],
    pinnedQuotes: [],
    imagePlacements: [],
    lastGeneratedAt: now.toISOString(),
  };
}

/** Seed a book with `count` written chapters. */
async function seedBook(fs: ReturnType<typeof memFileSystem>, count: number): Promise<string> {
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
  const titles = ['One', 'Two', 'Three'];
  for (let i = 0; i < count; i += 1) {
    await saveChapter(
      fs,
      key,
      'me',
      book.id,
      chapter(`c${i + 1}`, titles[i]!, `The oil in the pan was cold. Again. Chapter ${i + 1}.`),
    );
  }
  return book.id;
}

const FINDINGS = JSON.stringify({
  findings: [
    {
      kind: 'repetition',
      summary: 'The cold oil in the pan opens three chapters running.',
      chapters: ['One', 'Two', 'Three'],
    },
    { kind: 'pacing', summary: 'The twenties pass in a paragraph.', chapters: ['Three'] },
    { kind: 'arc', summary: '', chapters: [] }, // unusable — must drop itself, not the batch
  ],
});

describe('readManuscript (72 §5.3)', () => {
  it('files whole-book findings as review items, and names the metrics it judged pacing against', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs, 3);
    const { client, prompts } = capturingClient(FINDINGS);

    const res = await readManuscript(deps(fs, client), bookId);

    expect(res.ok).toBe(true);
    expect(res.findings.map((f) => f.kind).sort()).toEqual(['pacing', 'repetition']); // the blank dropped
    expect(res.findings.every((f) => f.status === 'pending')).toBe(true);
    // The deterministic word counts ride along free, so pacing is judged against real numbers.
    expect(prompts[0]).toContain('words)');
    // Metered under its own type.
    const events = await queryUsage(fs, key, { from: '2000-01-01', to: '2100-01-01' });
    expect(events.map((e) => e.type)).toEqual(['book.manuscript']);
  });

  it('spends nothing on a book too short to have a shape', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs, MIN_CHAPTERS_FOR_MANUSCRIPT - 1);
    const { client, prompts } = capturingClient(FINDINGS);

    const res = await readManuscript(deps(fs, client), bookId);

    expect(res.ok).toBe(true);
    expect(res.findings).toEqual([]);
    expect(prompts).toHaveLength(0); // no call at all
    expect(await queryUsage(fs, key, { from: '2000-01-01', to: '2100-01-01' })).toEqual([]);
  });

  it('never re-raises a finding the author already dismissed', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs, 3);
    const { client } = capturingClient(FINDINGS);

    const first = await readManuscript(deps(fs, client), bookId);
    expect(first.findings).toHaveLength(2);
    // A second read of an unchanged book proposes the same things — none of them are added again.
    const second = await readManuscript(deps(fs, client), bookId);
    expect(second.findings).toHaveLength(2);
  });

  it('shares one review list with the continuity check, so the author has one place to look', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs, 3);
    const continuityReply = JSON.stringify({
      findings: [{ kind: 'name', summary: "'Ana' in One, 'Anna' in Three", chapters: ['One'] }],
    });

    await checkContinuity(deps(fs, capturingClient(continuityReply).client), bookId);
    const res = await readManuscript(deps(fs, capturingClient(FINDINGS).client), bookId);

    expect(res.ok).toBe(true);
    expect(res.findings.map((f) => f.kind).sort()).toEqual(['name', 'pacing', 'repetition']);
  });

  it('an unparseable reply is an honest failure, not a silent empty read', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs, 3);
    const res = await readManuscript(
      deps(fs, capturingClient('I had a look and it seems fine to me.').client),
      bookId,
    );
    expect(res.ok).toBe(false);
    expect(res.findings).toEqual([]);
  });
});

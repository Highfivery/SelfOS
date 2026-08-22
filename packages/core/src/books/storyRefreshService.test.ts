import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import type { ClaudeClient, ClaudeUsage } from '../host';
import { memFileSystem } from '../host/memFileSystem';
import { saveInsight } from '../insights';
import { savePerson } from '../people';
import type { AiDeps } from '../questionnaires';
import { recordUsage } from '../usage';
import type { BookOutline, Insight, LifeTimeline, Person } from '../schemas';
import { generateChapter } from './storyGenerationService';
import { STORY_STRUCTURE_WEEKLY_CAP, refreshBook } from './storyRefreshService';
import { listStructuralProposals } from './storyStructureService';
import {
  applyFoundations,
  approveOutline,
  createBook,
  getChapter,
  getNewMaterial,
  saveChapter,
  saveOutline,
} from './storyService';
import { chapterShell } from './storyOutline';

const proposalJson = JSON.stringify({
  proposals: [{ kind: 'newChapter', partId: 'p1', title: 'A New Era', brief: 'x', rationale: 'y' }],
});

const key = generateMasterKey();
const now = new Date('2026-07-16T00:00:00.000Z');

const USAGE: ClaudeUsage = {
  inputTokens: 500,
  outputTokens: 400,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
};
function fakeClient(text: string): ClaudeClient {
  return { send: async () => text, stream: async () => ({ text, usage: USAGE }) };
}
function deps(
  fs: ReturnType<typeof memFileSystem>,
  client: ClaudeClient,
  over: Partial<AiDeps> = {},
): AiDeps {
  return {
    fs,
    key,
    client,
    apiKey: 'sk',
    model: 'claude-sonnet-4-6',
    personId: 'me',
    now,
    ...over,
  };
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
function insight(factText: string): Insight {
  return {
    id: 'i1',
    schemaVersion: 1,
    source: 'session',
    subjectPersonId: 'me',
    summary: 'A winter.',
    facts: [{ id: 'f1', text: factText, shareable: false }],
    confidence: 'medium',
    categories: [],
    approved: true,
    provenance: { at: '2026-05-01T00:00:00.000Z' },
    createdAt: 'now',
    updatedAt: 'now',
  };
}
const outline: BookOutline = {
  schemaVersion: 1,
  approved: true,
  parts: [
    {
      id: 'p1',
      title: 'Roots',
      chapters: [
        { id: 'c1', title: 'The Garage', brief: 'A machine obeys.', lifeAreas: [], order: 0 },
      ],
    },
  ],
};
const timeline: LifeTimeline = { schemaVersion: 1, events: [] };

/** Seed a book with one written chapter (signature stamped) that cites insight i1. */
async function seedWrittenBook(fs: ReturnType<typeof memFileSystem>): Promise<string> {
  await savePerson(fs, key, person);
  await saveInsight(fs, key, insight('the winter was cold'));
  const book = await createBook(fs, key, {
    personId: 'me',
    type: 'biography',
    title: 'The Story of Ben',
    config: {
      voice: 'third',
      style: 'warm',
      length: 'standard',
      autoRefresh: true,
      typeOptions: {},
      sourceIds: [],
    },
    now,
  });
  await applyFoundations(fs, key, 'me', book.id, { essence: 'x', outline, timeline }, now);
  await approveOutline(fs, key, 'me', book.id, outline, now);
  await generateChapter(deps(fs, fakeClient('The garage. [[SRC:s0]]')), {
    bookId: book.id,
    chapterId: 'c1',
  });
  return book.id;
}

describe('refreshBook (72 §5.4)', () => {
  /**
   * The behaviour change P2 exists for: the cadence used to mark chapters stale and then REWRITE them, ten a
   * week, unattended. It only ever detects and records now — the rewrite is an explicit act.
   */
  it('records what drifted and rewrites NOTHING', async () => {
    const fs = memFileSystem();
    const bookId = await seedWrittenBook(fs);
    const before = (await getChapter(fs, key, 'me', bookId, 'c1'))?.markdown;
    await saveInsight(fs, key, insight('the winter was brutal'));

    const res = await refreshBook(
      deps(fs, fakeClient('A REWRITE THAT MUST NOT HAPPEN. [[SRC:s0]]')),
      {
        bookId,
        auto: false,
      },
    );

    expect(res.staled).toBe(1);
    expect(res.rewritten).toBe(0);
    const c1 = await getChapter(fs, key, 'me', bookId, 'c1');
    expect(c1?.markdown).toBe(before); // untouched
    // What changed is on record, waiting on the author.
    const entries = (await getNewMaterial(fs, key, 'me', bookId)).entries;
    expect(entries.map((e) => e.chapterId)).toEqual(['c1']);
    expect(entries[0]?.items[0]?.excerpt).toContain('brutal');
  });

  it('records nothing when no chapter has drifted', async () => {
    const fs = memFileSystem();
    const bookId = await seedWrittenBook(fs);
    const res = await refreshBook(deps(fs, fakeClient('unused')), { bookId, auto: false });
    expect(res.staled).toBe(0);
    expect((await getNewMaterial(fs, key, 'me', bookId)).entries).toEqual([]);
  });

  it('files structural proposals on a refresh (they ride the cadence)', async () => {
    const fs = memFileSystem();
    const bookId = await seedWrittenBook(fs);
    const res = await refreshBook(deps(fs, fakeClient(proposalJson)), { bookId, auto: false });
    expect(res.proposalsAdded).toBe(1);
    expect(await listStructuralProposals(fs, key, 'me', bookId)).toHaveLength(1);
  });

  it('caps structural proposals per week — on the manual cadence too', async () => {
    const fs = memFileSystem();
    const bookId = await seedWrittenBook(fs);
    for (let i = 0; i < STORY_STRUCTURE_WEEKLY_CAP; i += 1) {
      await recordUsage(fs, key, {
        id: `s${i}`,
        schemaVersion: 1,
        type: 'story.structure',
        personId: 'me',
        sessionId: bookId, // the caps are per-BOOK now (72 §5.4)
        model: 'claude-sonnet-4-6',
        at: new Date(now.getTime() - 60_000).toISOString(),
        inputTokens: 1,
        outputTokens: 1,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
        costUsd: 0,
      });
    }
    const res = await refreshBook(deps(fs, fakeClient(proposalJson)), { bookId, auto: false });
    expect(res.proposalsAdded ?? 0).toBe(0);
    expect(await listStructuralProposals(fs, key, 'me', bookId)).toHaveLength(0);
  });

  /**
   * 72 §5.4 — an unwritten shell is not drift. It carries no signature, so it can't be detected as changed,
   * and it must never consume anything: a first draft belongs to the explicit "Write the remaining N".
   */
  it('never files a proposal against a never-written shell', async () => {
    const fs = memFileSystem();
    const bookId = await seedWrittenBook(fs);
    const withShell: BookOutline = {
      ...outline,
      parts: [
        {
          ...outline.parts[0]!,
          chapters: [
            ...outline.parts[0]!.chapters,
            { id: 'c2', title: 'The Tank', brief: 'Never written.', lifeAreas: [], order: 1 },
          ],
        },
      ],
    };
    await saveOutline(fs, key, 'me', bookId, withShell);
    await saveChapter(fs, key, 'me', bookId, chapterShell('c2', 'p1', 1, 'The Tank'));
    await saveInsight(fs, key, insight('the winter was bitter'));

    await refreshBook(deps(fs, fakeClient('unused')), { bookId, auto: true });

    const entries = (await getNewMaterial(fs, key, 'me', bookId)).entries;
    expect(entries.map((e) => e.chapterId)).toEqual(['c1']); // the written one only
    const shell = await getChapter(fs, key, 'me', bookId, 'c2');
    expect(shell?.markdown).toBe('');
    expect(shell?.revision).toBe(0);
  });
});

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
import {
  STORY_STRUCTURE_WEEKLY_CAP,
  STORY_WEEKLY_AUTO_CAP,
  refreshBook,
} from './storyRefreshService';
import { listStructuralProposals } from './storyStructureService';
import { applyFoundations, approveOutline, createBook, getChapter } from './storyService';

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
    config: { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true },
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

describe('refreshBook (64 §3.4/§5.4)', () => {
  it('marks a drifted chapter stale, then auto-rewrites it (manual refresh, uncapped)', async () => {
    const fs = memFileSystem();
    const bookId = await seedWrittenBook(fs);
    // Edit the cited insight → the chapter has drifted.
    await saveInsight(fs, key, insight('the winter was brutal'));
    const res = await refreshBook(deps(fs, fakeClient('The garage, rewritten. [[SRC:s0]]')), {
      bookId,
      auto: false,
    });
    expect(res.staled).toBe(1);
    expect(res.rewritten).toBe(1);
    const c1 = await getChapter(fs, key, 'me', bookId, 'c1');
    expect(c1?.status).toBe('updated'); // rewritten → no longer stale
    expect(c1?.markdown).toContain('rewritten');
  });

  it('does nothing to rewrite when no chapter has drifted', async () => {
    const fs = memFileSystem();
    const bookId = await seedWrittenBook(fs);
    const res = await refreshBook(deps(fs, fakeClient('unused')), { bookId, auto: false });
    expect(res.staled).toBe(0);
    expect(res.rewritten).toBe(0);
  });

  it('the auto cadence respects the weekly cap; a manual refresh bypasses it', async () => {
    const fs = memFileSystem();
    const bookId = await seedWrittenBook(fs);
    await saveInsight(fs, key, insight('the winter was brutal')); // drift it
    // Seed the weekly cap's worth of story.chapter passes in the trailing week.
    for (let i = 0; i < STORY_WEEKLY_AUTO_CAP; i += 1) {
      await recordUsage(fs, key, {
        id: `u${i}`,
        schemaVersion: 1,
        type: 'story.chapter',
        personId: 'me',
        model: 'claude-sonnet-4-6',
        at: new Date(now.getTime() - 60_000).toISOString(),
        inputTokens: 1,
        outputTokens: 1,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
        costUsd: 0,
      });
    }
    // Auto: capped → marks stale but rewrites nothing.
    const capped = await refreshBook(deps(fs, fakeClient('nope')), { bookId, auto: true });
    expect(capped.capped).toBe(true);
    expect(capped.rewritten).toBe(0);
    expect((await getChapter(fs, key, 'me', bookId, 'c1'))?.status).toBe('stale'); // staled, not rewritten

    // A manual "Refresh now" is the deliberate force-past-the-cap path → rewrites (still budget-gated).
    const forced = await refreshBook(deps(fs, fakeClient('Forced rewrite. [[SRC:s0]]')), {
      bookId,
      auto: false,
    });
    expect(forced.rewritten).toBe(1);
    expect((await getChapter(fs, key, 'me', bookId, 'c1'))?.markdown).toContain('Forced rewrite');
  });

  it('the auto cadence marks stale but never rewrites during a crisis', async () => {
    const fs = memFileSystem();
    const bookId = await seedWrittenBook(fs);
    await saveInsight(fs, key, insight('the winter was brutal'));
    const res = await refreshBook(deps(fs, fakeClient('nope')), {
      bookId,
      auto: true,
      crisis: true,
    });
    expect(res.staled).toBe(1);
    expect(res.rewritten).toBe(0);
    expect((await getChapter(fs, key, 'me', bookId, 'c1'))?.status).toBe('stale');
  });

  it('files structural proposals on a refresh (they ride the cadence)', async () => {
    const fs = memFileSystem();
    const bookId = await seedWrittenBook(fs);
    // Nothing has drifted → no rewrite; the structural pass returns one proposal.
    const res = await refreshBook(deps(fs, fakeClient(proposalJson)), { bookId, auto: false });
    expect(res.rewritten).toBe(0);
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
    expect(res.proposalsAdded ?? 0).toBe(0); // capped — even a manual refresh doesn't force a structural pass
    expect(await listStructuralProposals(fs, key, 'me', bookId)).toHaveLength(0);
  });

  it('the auto cadence files no proposals during a crisis', async () => {
    const fs = memFileSystem();
    const bookId = await seedWrittenBook(fs);
    const res = await refreshBook(deps(fs, fakeClient(proposalJson)), {
      bookId,
      auto: true,
      crisis: true,
    });
    expect(res.proposalsAdded ?? 0).toBe(0);
    expect(await listStructuralProposals(fs, key, 'me', bookId)).toHaveLength(0);
  });
});

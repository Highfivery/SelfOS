import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import type { ClaudeClient, ClaudeUsage } from '../host';
import { memFileSystem } from '../host/memFileSystem';
import { saveInsight } from '../insights';
import { savePerson } from '../people';
import type { AiDeps } from '../questionnaires';
import type { BookOutline, Insight, LifeTimeline, Person } from '../schemas';
import { computeStoryHomeSignal } from './storyHome';
import { markStaleChapters } from './storyFreshness';
import { generateChapter } from './storyGenerationService';
import { applyFoundations, approveOutline, createBook, saveProposals } from './storyService';

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
const deps = (fs: ReturnType<typeof memFileSystem>, client: ClaudeClient): AiDeps => ({
  fs,
  key,
  client,
  apiKey: 'sk',
  model: 'claude-sonnet-4-6',
  personId: 'me',
  now,
});
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

describe('computeStoryHomeSignal (64 §5.6)', () => {
  it('reports no book for a person who never started one', async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person);
    expect(await computeStoryHomeSignal(fs, key, 'me')).toMatchObject({ hasBook: false });
  });

  it('counts stale (drifted), unwritten, and pending-proposal signals', async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person);
    await saveInsight(fs, key, insight);
    const book = await createBook(fs, key, {
      personId: 'me',
      type: 'biography',
      title: 'The Story of Ben',
      config: { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true },
      now,
    });
    await applyFoundations(fs, key, 'me', book.id, { essence: 'x', outline, timeline }, now);
    await approveOutline(fs, key, 'me', book.id, outline, now);
    // Write only c1 → c2 stays unwritten. Then drift c1 (edit its cited insight) so it goes stale on next signal.
    await generateChapter(deps(fs, fakeClient('The garage. [[SRC:s0]]')), {
      bookId: book.id,
      chapterId: 'c1',
    });

    // c2 is un-drafted → unwritten:1; nothing stale/pending yet.
    expect(await computeStoryHomeSignal(fs, key, 'me')).toMatchObject({
      hasBook: true,
      staleChapters: 0,
      unwrittenChapters: 1,
      pendingProposals: 0,
    });

    // Drift c1 (its cited source changed), and seed a pending proposal.
    await saveInsight(fs, key, {
      ...insight,
      facts: [{ id: 'f1', text: 'the winter was brutal', shareable: false }],
    });
    await saveProposals(fs, key, 'me', book.id, {
      schemaVersion: 1,
      proposals: [
        {
          id: 'pr1',
          kind: 'prologueRewrite',
          rationale: 'x',
          createdAt: now.toISOString(),
          status: 'pending',
          chapterId: 'c1',
        },
      ],
    });
    // Mark c1 stale (mark-stale is free) so the drift shows in the signal.
    await markStaleChapters(fs, key, 'me', book.id);

    const sig = await computeStoryHomeSignal(fs, key, 'me');
    expect(sig).toMatchObject({
      hasBook: true,
      staleChapters: 1, // c1 drifted (written + stale)
      unwrittenChapters: 1, // c2 still un-drafted
      pendingProposals: 1,
    });
    expect(sig.signature).toBe(`${book.id}:1:1:1`);
  });
});

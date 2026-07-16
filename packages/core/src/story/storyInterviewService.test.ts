import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import type { ClaudeClient, ClaudeUsage } from '../host';
import { memFileSystem } from '../host/memFileSystem';
import { savePerson } from '../people';
import { saveInsight } from '../insights';
import { listAssignments, getAssignmentSnapshot } from '../questionnaires/assignmentService';
import type { AiDeps } from '../questionnaires/generationService';
import type {
  BookOutline,
  Insight,
  LifeTimeline,
  Person,
  StoryFrameworkCoverage,
} from '../schemas';
import {
  computeStoryCompleteness,
  getStoryCompleteness,
  mintStoryCheckInFromTodo,
  runGapPass,
} from './storyInterviewService';
import { generateChapter } from './storyGenerationService';
import { applyFoundations, approveOutline, createBook } from './storyService';

const key = generateMasterKey();
const now = new Date('2026-07-16T00:00:00.000Z');

const USAGE: ClaudeUsage = {
  inputTokens: 10,
  outputTokens: 20,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
};
function fakeClient(text: string): ClaudeClient {
  return {
    send: () => Promise.resolve(text),
    stream: (_options, onDelta) => {
      onDelta(text);
      return Promise.resolve({ text, usage: USAGE });
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

const validQuestions = JSON.stringify([
  { type: 'shortText', prompt: 'What was that winter like, day to day?', required: false },
  { type: 'shortText', prompt: 'Who was in the house with you then?', required: false },
]);

describe('mintStoryCheckInFromTodo (64 §5.5)', () => {
  it('mints a story check-in as an in-app self-send carrying storyProvenance', async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person);
    const res = await mintStoryCheckInFromTodo(deps(fs, fakeClient(validQuestions)), {
      bookId: 'b1',
      focus: 'the winter he got sick',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const assignments = await listAssignments(fs, key, { senderPersonId: 'me' });
    const a = assignments.find((x) => x.id === res.assignmentId);
    expect(a).toBeTruthy();
    expect(a?.recipient).toMatchObject({ kind: 'person', personId: 'me' }); // a self-send
    expect(a?.channel).toBe('inApp');
    // The frozen snapshot carries the book provenance so the Inbox shows the biographer eyebrow.
    const snap = await getAssignmentSnapshot(fs, key, res.assignmentId);
    expect(snap?.storyProvenance).toMatchObject({
      bookId: 'b1',
      gapBrief: 'the winter he got sick',
    });
  });

  it('returns an honest failure on an empty reply and persists nothing', async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person);
    const res = await mintStoryCheckInFromTodo(deps(fs, fakeClient('')), {
      bookId: 'b1',
      focus: 'x',
    });
    expect(res.ok).toBe(false);
    expect(await listAssignments(fs, key, { senderPersonId: 'me' })).toEqual([]); // no orphan send
  });

  it('refuses an empty focus without calling the model', async () => {
    const fs = memFileSystem();
    let called = false;
    const spyClient: ClaudeClient = {
      send: () => {
        called = true;
        return Promise.resolve('');
      },
      stream: () => {
        called = true;
        return Promise.resolve({ text: '', usage: USAGE });
      },
    };
    const res = await mintStoryCheckInFromTodo(deps(fs, spyClient), { bookId: 'b1', focus: '   ' });
    expect(res.ok).toBe(false);
    expect(called).toBe(false);
  });
});

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
const insight: Insight = {
  id: 'i1',
  schemaVersion: 1,
  source: 'session',
  subjectPersonId: 'me',
  summary: 'A winter.',
  facts: [{ id: 'f1', text: 'the winter was cold', shareable: false }],
  confidence: 'medium',
  categories: [],
  approved: true,
  provenance: { at: '2026-05-01T00:00:00.000Z' },
  createdAt: 'now',
  updatedAt: 'now',
};

async function seedBook(fs: ReturnType<typeof memFileSystem>): Promise<string> {
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
  await generateChapter(deps(fs, fakeClient('The garage. [[SRC:s0]]')), {
    bookId: book.id,
    chapterId: 'c1',
  });
  return book.id;
}

describe('computeStoryCompleteness (64 §3.6)', () => {
  const cover = (over: Partial<StoryFrameworkCoverage> = {}): StoryFrameworkCoverage => ({
    chapters: false,
    scenes: {},
    challenges: false,
    ideology: false,
    futureScript: false,
    ...over,
  });

  it('an empty coverage is "just beginning" at ratio 0', () => {
    expect(computeStoryCompleteness(cover())).toMatchObject({
      stage: 'beginning',
      ratio: 0,
      covered: 0,
      total: 12,
    });
  });

  it('climbs the qualitative ladder as dimensions fill in', () => {
    // 3/12 → takingShape (≥0.25).
    expect(
      computeStoryCompleteness(
        cover({ chapters: true, scenes: { highPoint: true }, challenges: true }),
      ).stage,
    ).toBe('takingShape');
    // 10/12 → richlyTold (≥0.8).
    const scenes = Object.fromEntries(
      [
        'highPoint',
        'lowPoint',
        'turningPoint',
        'positiveChildhood',
        'negativeChildhood',
        'vividAdult',
      ].map((k) => [k, true]),
    );
    expect(
      computeStoryCompleteness(
        cover({ chapters: true, scenes, challenges: true, ideology: true, futureScript: true }),
      ).stage,
    ).toBe('richlyTold');
  });
});

const gapJson = JSON.stringify({
  coverage: {
    chapters: true,
    scenes: { highPoint: true, lowPoint: false, unknownScene: true },
    challenges: true,
    ideology: false,
    futureScript: false,
  },
  gaps: [
    {
      dimension: 'sensory',
      label: 'The kitchen',
      focus: 'What did the kitchen smell like?',
      priority: 5,
    },
    {
      dimension: 'lowPoint',
      label: 'A hard season',
      focus: 'Tell me about a low point.',
      priority: 9,
    },
    { dimension: 'x', label: '', focus: '   ', priority: 3 }, // dropped (blank focus)
  ],
});

describe('runGapPass (64 §3.7)', () => {
  it('scores coverage, emits prioritized gaps, and persists the coverage', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    const res = await runGapPass(deps(fs, fakeClient(gapJson)), { bookId });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Gaps sorted priority-desc, blank-focus dropped, invented scene key ignored in coverage.
    expect(res.gaps.map((g) => g.dimension)).toEqual(['lowPoint', 'sensory']);
    // covered = chapters + highPoint + challenges = 3 of 12 → takingShape.
    expect(res.completeness).toMatchObject({ covered: 3, total: 12, stage: 'takingShape' });
    // Persisted: a later cheap read reflects the same coverage (no AI).
    expect(await getStoryCompleteness(fs, key, 'me', bookId)).toMatchObject({
      covered: 3,
      stage: 'takingShape',
    });
  });

  it('is a no-op (no spend) when the book has no outline yet', async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person);
    const book = await createBook(fs, key, {
      personId: 'me',
      type: 'biography',
      title: 'Empty',
      config: { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true },
      now,
    });
    let streamed = false;
    const client: ClaudeClient = {
      send: () => Promise.resolve(''),
      stream: () => {
        streamed = true;
        return Promise.resolve({ text: '', usage: USAGE });
      },
    };
    const res = await runGapPass(deps(fs, client), { bookId: book.id });
    expect(res.ok && res.gaps).toEqual([]);
    expect(streamed).toBe(false);
  });

  it('reports an honest failure on an unparseable reply', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    const res = await runGapPass(deps(fs, fakeClient('I could not do that.')), { bookId });
    expect(res.ok).toBe(false);
  });
});

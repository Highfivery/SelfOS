import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import type { ClaudeClient, ClaudeUsage } from '../host';
import { memFileSystem } from '../host/memFileSystem';
import { savePerson } from '../people';
import { saveInsight } from '../insights';
import {
  createAssignment,
  getAssignment,
  getAssignmentSnapshot,
  listAssignments,
  updateAssignmentStatus,
} from '../questionnaires/assignmentService';
import { saveQuestionnaire } from '../questionnaires/questionnaireService';
import { saveResponse } from '../questionnaires/responseService';
import type { AiDeps } from '../questionnaires/generationService';
import type {
  BookChapter,
  BookOutline,
  Insight,
  LifeTimeline,
  Person,
  StoryFrameworkCoverage,
} from '../schemas';
import { recordUsage } from '../usage';
import {
  STORY_INTERVIEW_WEEKLY_CAP,
  askGap,
  computePartCoverage,
  computeStoryCompleteness,
  getStoryCompleteness,
  getStoryGaps,
  listAnsweredStoryCheckIns,
  mintStoryCheckInFromTodo,
  mintTodoCheckIn,
  resolveSentQuestionTodos,
  runGapPass,
  runStoryInterviewCadence,
} from './storyInterviewService';
import { generateChapter } from './storyGenerationService';
import { addMark } from './storyMarkupService';
import {
  applyFoundations,
  approveOutline,
  createBook,
  getInterviewState,
  getTodos,
  saveChapter,
} from './storyService';

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
function depsAt(fs: ReturnType<typeof memFileSystem>, client: ClaudeClient, at: Date): AiDeps {
  return { fs, key, client, apiKey: 'sk', model: 'claude-sonnet-4-6', personId: 'me', now: at };
}
/** A fake that answers the gap-pass prompt with `gap` JSON and every other call (the mint) with `questions`. */
function routingClient(gap: string, questions: string): ClaudeClient {
  const pick = (opts: { messages?: readonly { content?: unknown }[] }): string =>
    String(opts?.messages?.[0]?.content ?? '').includes('EIGHT KEY SCENES') ? gap : questions;
  return {
    send: (opts) => Promise.resolve(pick(opts)),
    stream: (opts, onDelta) => {
      const t = pick(opts);
      onDelta(t);
      return Promise.resolve({ text: t, usage: USAGE });
    },
  };
}
/** The concatenated user-message text of a Claude call (never the system prompt). */
function userTextOf(opts: { messages?: readonly { content?: unknown }[] }): string {
  return (opts.messages ?? [])
    .map((m) => (typeof m.content === 'string' ? m.content : ''))
    .join('\n');
}
/** Records the user message of every call (so the de-dup reference reaching the model can be asserted). */
function capturingClient(text: string): { client: ClaudeClient; messages: string[] } {
  const messages: string[] = [];
  return {
    messages,
    client: {
      send: (opts) => {
        messages.push(userTextOf(opts));
        return Promise.resolve(text);
      },
      stream: (opts, onDelta) => {
        messages.push(userTextOf(opts));
        onDelta(text);
        return Promise.resolve({ text, usage: USAGE });
      },
    },
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

  it('de-dups against the self-recipient’s history — the reference reaches the model (§3.7 parity)', async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person);
    // A prior questionnaire the person already answered (a self-send) — its Q→A is what the biographer must
    // never re-ask, and it must reach the de-dup pass.
    const def = await saveQuestionnaire(fs, key, {
      title: 'Earlier',
      type: 'general',
      sensitivity: 'standard',
      recipient: { kind: 'person', personId: 'me' },
      questions: [
        { id: 'q1', type: 'shortText', prompt: 'What is your favorite color?', required: false },
      ],
    });
    const prior = await createAssignment(fs, key, {
      questionnaireId: def.id,
      senderPersonId: 'me',
      recipient: { kind: 'person', personId: 'me' },
      channel: 'inApp',
      privacy: 'standard',
      senderVisibleToRecipient: true,
    });
    await saveResponse(fs, key, {
      id: 'r1',
      schemaVersion: 1,
      assignmentId: prior.id,
      answers: [{ questionId: 'q1', value: 'Blue' }],
      submittedAt: now.toISOString(),
    });

    const { client, messages } = capturingClient(validQuestions);
    const res = await mintStoryCheckInFromTodo(deps(fs, client), {
      bookId: 'b1',
      focus: 'the winter he got sick',
    });
    expect(res.ok).toBe(true);
    // The onboarding-first de-dup reference reached the model (the semantic pass) — the biographer is told what
    // the person already answered, so it won't re-ask it.
    const all = messages.join('\n---\n');
    expect(all).toContain('ALREADY ANSWERED in prior questionnaires');
  });

  it('passes NO de-dup reference for a person with no history (nothing to avoid)', async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person);
    const { client, messages } = capturingClient(validQuestions);
    const res = await mintStoryCheckInFromTodo(deps(fs, client), {
      bookId: 'b1',
      focus: 'a topic',
    });
    expect(res.ok).toBe(true);
    const all = messages.join('\n---\n');
    // No history → the reference is empty, so the semantic pass never runs + the "ALREADY …" framing is absent.
    expect(all).not.toContain('ALREADY ANSWERED');
    expect(all).not.toContain('ALREADY KNOWN / ALREADY ASKED');
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

  it('persists lastGaps (with ids) + per-part coverage so the Interview tab reads free (§13.6.3/§13.6.4)', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    await runGapPass(deps(fs, fakeClient(gapJson)), { bookId }); // gapJson carries no partCoverage → the fallback
    const view = await getStoryGaps(fs, key, 'me', bookId);
    // Persisted gaps carry stable ids (so askGap can target them) + are sorted priority-desc.
    expect(view.gaps.map((g) => g.dimension)).toEqual(['lowPoint', 'sensory']);
    expect(view.gaps.every((g) => g.id.length > 0)).toBe(true);
    expect(view.lastGapPassAt).toBeTruthy();
    // Part coverage fell back to the written/reviewed ratio: p1 has one written-not-reviewed chapter → 0.5.
    expect(view.partCoverage).toEqual([{ partId: 'p1', score: 0.5 }]);
  });

  it('a model per-part reading wins over the fallback (clamped 0..1)', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    const withCoverage = JSON.stringify({
      ...JSON.parse(gapJson),
      partCoverage: { p1: 1.4 }, // out of range → clamped to 1
    });
    await runGapPass(deps(fs, fakeClient(withCoverage)), { bookId });
    expect((await getStoryGaps(fs, key, 'me', bookId)).partCoverage).toEqual([
      { partId: 'p1', score: 1 },
    ]);
  });
});

describe('computePartCoverage (64 §13.6.4)', () => {
  const chapter = (id: string, status: 'new' | 'reviewed', markdown: string): BookChapter => ({
    id,
    schemaVersion: 1,
    partId: 'p1',
    order: 0,
    title: id,
    markdown,
    revision: 1,
    status,
    sourceSignature: '',
    provenance: [],
    protectedBlocks: [],
    pinnedQuotes: [],
    imagePlacements: [],
  });
  const twoChapterOutline: BookOutline = {
    schemaVersion: 1,
    approved: true,
    parts: [
      {
        id: 'p1',
        title: 'Roots',
        chapters: [
          { id: 'a', title: 'A', brief: '', lifeAreas: [], order: 0 },
          { id: 'b', title: 'B', brief: '', lifeAreas: [], order: 1 },
        ],
      },
    ],
  };

  it('scores a part reviewed=1, written-not-reviewed=0.5, unwritten=0 (averaged)', () => {
    // a reviewed (1) + b written-not-reviewed (0.5) → 0.75.
    const cov = computePartCoverage(twoChapterOutline, [
      chapter('a', 'reviewed', 'done'),
      chapter('b', 'new', 'draft'),
    ]);
    expect(cov).toEqual([{ partId: 'p1', score: 0.75 }]);
    // b missing entirely → a(1) + b(0) → 0.5.
    expect(computePartCoverage(twoChapterOutline, [chapter('a', 'reviewed', 'done')])).toEqual([
      { partId: 'p1', score: 0.5 },
    ]);
  });
});

describe('runStoryInterviewCadence (64 §3.7 — the autonomous loop)', () => {
  it('mints ONE check-in from the top gap; a second run mints nothing (≤1 open)', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    const client = routingClient(gapJson, validQuestions);
    const first = await runStoryInterviewCadence(deps(fs, client), { bookId, auto: false });
    expect(first.outcome).toBe('minted');
    expect(first.assignmentId).toBeTruthy();
    // The open check-in is tracked; a self-send in the Inbox exists.
    const state = await getInterviewState(fs, key, 'me', bookId);
    expect(state.openCheckinAssignmentId).toBe(first.assignmentId);
    expect((await getAssignment(fs, key, first.assignmentId!))?.status).toBe('sent');
    // A second run while it's still open → nothing minted (the back-off).
    const second = await runStoryInterviewCadence(deps(fs, client), { bookId, auto: false });
    expect(second.outcome).toBe('openCheckin');
  });

  it('never spends during a crisis, and no-ops without a book/outline', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    let streamed = false;
    const spy: ClaudeClient = {
      send: () => Promise.resolve(''),
      stream: () => {
        streamed = true;
        return Promise.resolve({ text: '', usage: USAGE });
      },
    };
    const crisis = await runStoryInterviewCadence(deps(fs, spy), {
      bookId,
      auto: true,
      crisis: true,
    });
    expect(crisis.outcome).toBe('crisis');
    expect(streamed).toBe(false);

    const fs2 = memFileSystem();
    await savePerson(fs2, key, person);
    const book = await createBook(fs2, key, {
      personId: 'me',
      type: 'biography',
      title: 'Empty',
      config: { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true },
      now,
    });
    const res = await runStoryInterviewCadence(deps(fs2, spy), { bookId: book.id, auto: true });
    expect(res.outcome).toBe('noBook');
    expect(streamed).toBe(false);
  });

  it('the weekly cap throttles the manual path (no spend past the cap)', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    for (let i = 0; i < STORY_INTERVIEW_WEEKLY_CAP; i += 1) {
      await recordUsage(fs, key, {
        id: `g${i}`,
        schemaVersion: 1,
        type: 'story.interview',
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
    let streamed = false;
    const client: ClaudeClient = {
      send: () => Promise.resolve(gapJson),
      stream: (_o, onDelta) => {
        streamed = true;
        onDelta(gapJson);
        return Promise.resolve({ text: gapJson, usage: USAGE });
      },
    };
    const res = await runStoryInterviewCadence(deps(fs, client), { bookId, auto: false });
    expect(res.outcome).toBe('throttled');
    expect(res.throttleReason).toBe('weeklyCap'); // the UI says "already took stock twice this week"
    expect(streamed).toBe(false); // capped BEFORE the gap pass — no spend
  });

  it('an ignored check-in lapses: it is expired and the loop backs off (no pile-up)', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    const client = routingClient(gapJson, validQuestions);
    const first = await runStoryInterviewCadence(deps(fs, client), { bookId, auto: false });
    expect(first.outcome).toBe('minted');
    // Advance well past the expiry, computed from the assignment's real createdAt (non-fragile).
    const a = await getAssignment(fs, key, first.assignmentId!);
    const later = new Date(Date.parse(a!.createdAt) + 20 * 24 * 60 * 60 * 1000);
    const res = await runStoryInterviewCadence(depsAt(fs, client, later), { bookId, auto: false });
    expect(res.outcome).toBe('throttled'); // backed off — did NOT mint a second check-in
    expect(res.throttleReason).toBe('backoff'); // an ignored check-in just lapsed — don't pile on
    expect((await getAssignment(fs, key, first.assignmentId!))?.status).toBe('expired');
    expect(
      (await getInterviewState(fs, key, 'me', bookId)).openCheckinAssignmentId,
    ).toBeUndefined();
  });

  it('clears a RESOLVED (answered) check-in so the loop can advance next time', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    const client = routingClient(gapJson, validQuestions);
    const first = await runStoryInterviewCadence(deps(fs, client), { bookId, auto: false });
    // Mark it answered, then run the AUTO cadence within the interval → the flag clears + it throttles (no spend).
    await updateAssignmentStatus(fs, key, first.assignmentId!, 'submitted');
    const res = await runStoryInterviewCadence(deps(fs, client), { bookId, auto: true });
    expect(res.outcome).toBe('throttled'); // lastGapPassAt is recent → auto throttled
    expect(res.throttleReason).toBe('interval'); // the auto interval, not the cap
    expect(
      (await getInterviewState(fs, key, 'me', bookId)).openCheckinAssignmentId,
    ).toBeUndefined();
  });

  it('a RESOLVED check-in + a no-gaps pass keeps the FRESH throttle stamp (no lost update)', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    // Run 1: mint a check-in (has gaps), then answer it → resolved (its flag is still set).
    const first = await runStoryInterviewCadence(deps(fs, routingClient(gapJson, validQuestions)), {
      bookId,
      auto: false,
    });
    expect(first.outcome).toBe('minted');
    await updateAssignmentStatus(fs, key, first.assignmentId!, 'submitted');
    // Run 2, 10 days later (manual bypasses the interval; the earlier pass is out of the weekly window): the
    // gap pass returns NO gaps → the resolved flag is cleared ON TOP of the fresh stamp, not reverted.
    const noGaps = JSON.stringify({
      coverage: { chapters: true, scenes: { highPoint: true } },
      gaps: [],
    });
    const later = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);
    const res = await runStoryInterviewCadence(
      depsAt(fs, routingClient(noGaps, validQuestions), later),
      {
        bookId,
        auto: false,
      },
    );
    expect(res.outcome).toBe('noGaps');
    const state = await getInterviewState(fs, key, 'me', bookId);
    expect(state.lastGapPassAt).toBe(later.toISOString()); // the fresh stamp survives (the fix)
    expect(state.openCheckinAssignmentId).toBeUndefined(); // the resolved flag is cleared
  });
});

describe('askGap — "Ask me about this" (64 §13.6.5)', () => {
  it('mints a check-in from a persisted gap by id + records the open check-in', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    await runGapPass(deps(fs, fakeClient(gapJson)), { bookId }); // persists lastGaps
    const gap = (await getStoryGaps(fs, key, 'me', bookId)).gaps[0]!;
    const res = await askGap(deps(fs, fakeClient(validQuestions)), { bookId, gapId: gap.id });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // A story-provenance self-send landed in the Inbox…
    const sent = await listAssignments(fs, key, { senderPersonId: 'me' });
    expect(sent.some((a) => a.id === res.assignmentId)).toBe(true);
    // …and the open check-in is recorded (drives the ≤1 rule + the "Ask" disabled state).
    expect((await getStoryGaps(fs, key, 'me', bookId)).hasOpenCheckin).toBe(true);
  });

  it('refuses while a check-in is already open (the ≤1 invariant)', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    await runGapPass(deps(fs, fakeClient(gapJson)), { bookId });
    const gaps = (await getStoryGaps(fs, key, 'me', bookId)).gaps;
    await askGap(deps(fs, fakeClient(validQuestions)), { bookId, gapId: gaps[0]!.id });
    const second = await askGap(deps(fs, fakeClient(validQuestions)), {
      bookId,
      gapId: gaps[1]!.id,
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.message).toMatch(/already waiting/);
  });

  it('proceeds again once the open check-in has resolved (submitted)', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    await runGapPass(deps(fs, fakeClient(gapJson)), { bookId });
    const gaps = (await getStoryGaps(fs, key, 'me', bookId)).gaps;
    const first = await askGap(deps(fs, fakeClient(validQuestions)), {
      bookId,
      gapId: gaps[0]!.id,
    });
    if (!first.ok) throw new Error('first mint failed');
    await updateAssignmentStatus(fs, key, first.assignmentId, 'submitted');
    // The prior check-in resolved → the ≤1-open invariant RELEASES: asking a different gap is no longer
    // blocked with "a check-in is already waiting". (Whether the mint then yields questions depends on the
    // §3.7 de-dup pass, which needs a real model — not this constant fake — and is tested at the bridge.)
    const second = await askGap(deps(fs, fakeClient(validQuestions)), {
      bookId,
      gapId: gaps[1]!.id,
    });
    expect(second.ok ? '' : second.message).not.toContain('already waiting');
  });

  it('refuses an unknown gap id', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    await runGapPass(deps(fs, fakeClient(gapJson)), { bookId });
    expect((await askGap(deps(fs, fakeClient(validQuestions)), { bookId, gapId: 'nope' })).ok).toBe(
      false,
    );
  });

  it('refuses re-asking an ALREADY-ANSWERED gap (no "Worth telling next" vs "Answered" contradiction, §3.7)', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    await runGapPass(deps(fs, fakeClient(gapJson)), { bookId });
    const gap = (await getStoryGaps(fs, key, 'me', bookId)).gaps[0]!;
    const first = await askGap(deps(fs, fakeClient(validQuestions)), { bookId, gapId: gap.id });
    if (!first.ok) throw new Error('first mint failed');
    // Answer it → the gap's material is now in. Re-asking the SAME gap must be refused (not re-mint identical
    // questions), even though the ≤1-open invariant has released.
    await updateAssignmentStatus(fs, key, first.assignmentId, 'submitted');
    const again = await askGap(deps(fs, fakeClient(validQuestions)), { bookId, gapId: gap.id });
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.message).toMatch(/already answered/i);
  });
});

describe('getStoryGaps — the derived lifecycle status (64 §3.7/§13.6.5)', () => {
  it('derives open → asked → answered per gap from the check-in it minted', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    await runGapPass(deps(fs, fakeClient(gapJson)), { bookId }); // persists two gaps
    // Before any ask, every gap is open (askable).
    let view = await getStoryGaps(fs, key, 'me', bookId);
    expect(view.gaps.map((g) => g.status)).toEqual(['open', 'open']);

    const askedId = view.gaps[0]!.id;
    const untouchedId = view.gaps[1]!.id;
    const minted = await askGap(deps(fs, fakeClient(validQuestions)), { bookId, gapId: askedId });
    if (!minted.ok) throw new Error('mint failed');

    // The asked gap is now `asked` (its check-in is waiting); the untouched one stays `open`.
    view = await getStoryGaps(fs, key, 'me', bookId);
    const byId = new Map(view.gaps.map((g) => [g.id, g]));
    expect(byId.get(askedId)?.status).toBe('asked');
    expect(byId.get(askedId)?.assignmentId).toBe(minted.assignmentId);
    expect(byId.get(untouchedId)?.status).toBe('open');

    // Submit its check-in → the gap becomes `answered` (derived on read, so it reflects an Inbox answer).
    await updateAssignmentStatus(fs, key, minted.assignmentId, 'submitted');
    view = await getStoryGaps(fs, key, 'me', bookId);
    expect(view.gaps.find((g) => g.id === askedId)?.status).toBe('answered');
  });

  it('a gap whose check-in was declined falls back to open (askable again)', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    await runGapPass(deps(fs, fakeClient(gapJson)), { bookId });
    const gapId = (await getStoryGaps(fs, key, 'me', bookId)).gaps[0]!.id;
    const minted = await askGap(deps(fs, fakeClient(validQuestions)), { bookId, gapId });
    if (!minted.ok) throw new Error('mint failed');
    await updateAssignmentStatus(fs, key, minted.assignmentId, 'declined');
    const view = await getStoryGaps(fs, key, 'me', bookId);
    expect(view.gaps.find((g) => g.id === gapId)?.status).toBe('open');
  });
});

describe('resolveSentQuestionTodos (64 §3.7 — the coherence self-heal)', () => {
  it('flips a questionsSent to-do to done once its check-in resolves, and reports the count', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    // Mint a real check-in so the to-do can carry a resolvable assignment id.
    const mint = await mintStoryCheckInFromTodo(deps(fs, fakeClient(validQuestions)), {
      bookId,
      focus: 'the winter he got sick',
    });
    if (!mint.ok) throw new Error('mint failed');
    // Record the "Turn into questions" hand-off shape (a questionsSent to-do carrying the assignment id).
    await addMark(fs, key, 'me', bookId, 'c1', {
      id: 'qs1',
      kind: 'todo',
      text: 'the winter he got sick',
      todoKind: 'questions',
      status: 'questionsSent',
      assignmentId: mint.assignmentId,
      createdAt: 'now',
    });

    // Before the check-in resolves the sweep is a no-op and the to-do stays questionsSent (still in "Needs you").
    expect(await resolveSentQuestionTodos(fs, key, 'me', bookId)).toBe(0);
    expect((await getTodos(fs, key, 'me', bookId)).todos[0]?.status).toBe('questionsSent');

    // Answer it → the sweep flips the to-do to done and the roll-up reflects it (no longer stuck in the count).
    await updateAssignmentStatus(fs, key, mint.assignmentId, 'submitted');
    expect(await resolveSentQuestionTodos(fs, key, 'me', bookId)).toBe(1);
    expect((await getTodos(fs, key, 'me', bookId)).todos[0]?.status).toBe('done');
  });
});

describe('mintTodoCheckIn (64 §3.7 — the ≤1-open hand-off)', () => {
  it('records the open check-in + the focus, then refuses a second while one is genuinely open', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    const first = await mintTodoCheckIn(deps(fs, fakeClient(validQuestions)), {
      bookId,
      focus: 'the garage fire',
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // It stamps the open check-in id + records the focus so the gap pass won't re-propose the topic.
    const state = await getInterviewState(fs, key, 'me', bookId);
    expect(state.openCheckinAssignmentId).toBe(first.assignmentId);
    expect(state.askedPrompts).toContain('the garage fire');

    // A second mint while it's still open is refused BEFORE the model is called (the ≤1 invariant).
    let called = false;
    const spy: ClaudeClient = {
      send: () => {
        called = true;
        return Promise.resolve('');
      },
      stream: () => {
        called = true;
        return Promise.resolve({ text: '', usage: USAGE });
      },
    };
    const second = await mintTodoCheckIn(deps(fs, spy), { bookId, focus: 'something else' });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.message).toMatch(/already waiting/i);
    expect(called).toBe(false);
  });
});

describe('listAnsweredStoryCheckIns (64 §13.6.5)', () => {
  it('lists submitted story-provenance check-ins for the book, newest-first', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    await runGapPass(deps(fs, fakeClient(gapJson)), { bookId });
    const gaps = (await getStoryGaps(fs, key, 'me', bookId)).gaps;
    const minted = await askGap(deps(fs, fakeClient(validQuestions)), {
      bookId,
      gapId: gaps[0]!.id,
    });
    if (!minted.ok) throw new Error('mint failed');
    // Not answered yet → nothing in the answered history.
    expect(await listAnsweredStoryCheckIns(fs, key, 'me', bookId)).toEqual([]);
    // Submit it → it appears.
    await updateAssignmentStatus(fs, key, minted.assignmentId, 'submitted');
    const answered = await listAnsweredStoryCheckIns(fs, key, 'me', bookId);
    expect(answered).toHaveLength(1);
    expect(answered[0]?.assignmentId).toBe(minted.assignmentId);
    expect(answered[0]?.title.length).toBeGreaterThan(0);
    // Not yet woven into any chapter (no insight/chapter cites it) → no chapter linkage.
    expect(answered[0]?.wroteIntoChapterTitle).toBeUndefined();
  });

  it('links a check-in to the chapter it wove into (analysis insight → chapter provenance, §13.6.5)', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    await runGapPass(deps(fs, fakeClient(gapJson)), { bookId });
    const gaps = (await getStoryGaps(fs, key, 'me', bookId)).gaps;
    const minted = await askGap(deps(fs, fakeClient(validQuestions)), {
      bookId,
      gapId: gaps[0]!.id,
    });
    if (!minted.ok) throw new Error('mint failed');
    await updateAssignmentStatus(fs, key, minted.assignmentId, 'analyzed');

    // Analyzing the answer produced this insight (stamped with the check-in's assignment id) …
    await saveInsight(fs, key, {
      id: 'ins-checkin',
      schemaVersion: 1,
      source: 'questionnaire',
      subjectPersonId: 'me',
      summary: 'A memory the check-in drew out.',
      facts: [],
      confidence: 'medium',
      categories: [],
      approved: true,
      provenance: { at: '2026-07-16T00:00:00.000Z', assignmentId: minted.assignmentId },
      createdAt: 'now',
      updatedAt: 'now',
    });
    // … and a chapter that draws on that insight cites it in its paragraph provenance.
    await saveChapter(fs, key, 'me', bookId, {
      id: 'ch-firstwords',
      schemaVersion: 1,
      partId: 'p1',
      order: 0,
      title: 'First Words',
      markdown: 'He finally spoke. [[SRC handled]]',
      revision: 1,
      status: 'reviewed',
      sourceSignature: '',
      provenance: [{ anchor: 'p0', refs: [{ kind: 'insight', id: 'ins-checkin' }] }],
      protectedBlocks: [],
      pinnedQuotes: [],
      imagePlacements: [],
    });

    const answered = await listAnsweredStoryCheckIns(fs, key, 'me', bookId);
    expect(answered).toHaveLength(1);
    expect(answered[0]?.wroteIntoChapterTitle).toBe('First Words');
  });
});

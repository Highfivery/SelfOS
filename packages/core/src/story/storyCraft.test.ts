import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import type { ClaudeClient, ClaudeStreamOptions, ClaudeUsage } from '../host';
import { memFileSystem } from '../host/memFileSystem';
import { saveInsight } from '../insights';
import { savePerson } from '../people';
import type { AiDeps } from '../questionnaires';
import { queryUsage } from '../usage';
import type { BookOutline, Insight, LifeTimeline, Person } from '../schemas';
import { BOOK_MODEL, BOOK_TASK_MODELS } from './bookModel';
import { generateChapter } from './storyGenerationService';
import { applyFoundations, approveOutline, createBook, getChapter } from './storyService';

/**
 * The craft loop (72 §5.3): plan → draft → critique → revise. These guards pin the two properties the loop
 * exists for — that a critiqued defect is actually fixed, and that no pass around the draft can ever COST a
 * chapter — plus the model override that holds every book pass to Opus.
 */

const key = generateMasterKey();
const now = new Date('2026-08-13T00:00:00.000Z');

const USAGE: ClaudeUsage = {
  inputTokens: 500,
  outputTokens: 400,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
};

interface Call {
  system: string;
  user: string;
  model: string;
}

/**
 * A client that answers each call from a queue, in order, recording what it was asked. The craft loop makes
 * three or four calls per chapter, so a single-reply fake can't distinguish them.
 */
function scriptedClient(replies: string[]): { client: ClaudeClient; calls: Call[] } {
  const calls: Call[] = [];
  let i = 0;
  const next = (options: ClaudeStreamOptions): string => {
    const first = options.messages[0];
    calls.push({
      system: options.system ?? '',
      user: typeof first?.content === 'string' ? first.content : '',
      model: options.model,
    });
    const reply = replies[i] ?? '';
    i += 1;
    return reply;
  };
  return {
    calls,
    client: {
      send: async () => '',
      stream: async (options) => ({ text: next(options), usage: USAGE }),
    },
  };
}

function deps(fs: ReturnType<typeof memFileSystem>, client: ClaudeClient): AiDeps {
  return {
    fs,
    key,
    client,
    apiKey: 'sk',
    // Deliberately the CHEAP model: the book passes must override it (§5.3).
    model: 'claude-sonnet-4-6',
    models: BOOK_TASK_MODELS,
    personId: 'me',
    now,
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
const insight: Insight = {
  id: 'i1',
  schemaVersion: 1,
  source: 'session',
  subjectPersonId: 'me',
  summary: 'A garage.',
  facts: [{ id: 'f1', text: 'he rebuilt the carburettor at fourteen', shareable: false }],
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
      ],
    },
  ],
};
const timeline: LifeTimeline = { schemaVersion: 1, events: [] };

const PLAN = JSON.stringify({
  thread: 'Being useful was how he got to stay.',
  opening: 'The garage at six in the morning, oil cold in the pan.',
  scenes: [
    { title: 'The carburettor', beat: 'He takes it apart and it obeys him.', sources: ['s0'] },
  ],
  avoid: ['His school years belong to the next chapter.'],
});
const DRAFT = 'The record does not say why he started. [[SRC:s0]]';
const CRITIQUE = JSON.stringify({
  verdict: 'revise',
  findings: [
    {
      kind: 'metaNarration',
      quote: 'The record does not say why he started.',
      fix: 'Say it as a fact about him — he never explained why he started.',
    },
  ],
});
const REVISED = 'He never explained why he started. [[SRC:s0]]';

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
  await applyFoundations(
    fs,
    key,
    'me',
    book.id,
    { essence: 'A useful boy.', outline, timeline },
    now,
  );
  await approveOutline(fs, key, 'me', book.id, outline, now);
  return book.id;
}

describe('the craft loop (72 §5.3)', () => {
  it('plans, drafts, critiques, and REVISES — the fixed text is what gets saved', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    const { client, calls } = scriptedClient([PLAN, DRAFT, CRITIQUE, REVISED]);

    const res = await generateChapter(deps(fs, client), { bookId, chapterId: 'c1' });
    expect(res.ok).toBe(true);

    // Four passes ran, in order, each metered under its own type.
    expect(calls).toHaveLength(4);
    const types = (await queryUsage(fs, key, { from: '2000-01-01', to: '2100-01-01' })).map(
      (u) => u.type,
    );
    expect(types).toEqual(['book.plan', 'story.chapter', 'book.critique', 'book.revise']);

    // The critiqued defect is GONE from the saved chapter — the whole point of the loop.
    const saved = await getChapter(fs, key, 'me', bookId, 'c1');
    expect(saved?.markdown).toContain('He never explained why he started');
    expect(saved?.markdown).not.toContain('The record does not say');
    // Citations from the REVISION resolve to provenance (the revision re-cites, so it re-sources).
    expect(saved?.provenance.length).toBeGreaterThan(0);
  });

  it('carries the plan into the drafter’s prompt (the plan must reach the model, not just exist)', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    const { client, calls } = scriptedClient([
      PLAN,
      DRAFT,
      JSON.stringify({ verdict: 'ship', findings: [] }),
    ]);

    await generateChapter(deps(fs, client), { bookId, chapterId: 'c1' });

    const draftPrompt = calls[1]?.user ?? '';
    expect(draftPrompt).toContain('THE PLAN FOR THIS CHAPTER');
    expect(draftPrompt).toContain('Being useful was how he got to stay.');
    expect(draftPrompt).toContain('The carburettor');
    expect(draftPrompt).toContain('His school years belong to the next chapter.');
  });

  it('a clean draft ships without paying for a revision', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    const { client, calls } = scriptedClient([
      PLAN,
      'He never explained why he started. [[SRC:s0]]',
      JSON.stringify({ verdict: 'ship', findings: [] }),
      'THIS REVISION SHOULD NEVER RUN',
    ]);

    await generateChapter(deps(fs, client), { bookId, chapterId: 'c1' });

    expect(calls).toHaveLength(3); // no revise pass
    const saved = await getChapter(fs, key, 'me', bookId, 'c1');
    expect(saved?.markdown).toContain('He never explained why');
    expect(saved?.markdown).not.toContain('THIS REVISION SHOULD NEVER RUN');
  });

  it('a plan that comes back unusable still writes the chapter, from the brief alone', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    const { client, calls } = scriptedClient([
      'I am afraid I cannot plan that.', // unparseable plan
      DRAFT,
      JSON.stringify({ verdict: 'ship', findings: [] }),
    ]);

    const res = await generateChapter(deps(fs, client), { bookId, chapterId: 'c1' });

    expect(res.ok).toBe(true);
    expect(calls[1]?.user).not.toContain('THE PLAN FOR THIS CHAPTER');
    expect((await getChapter(fs, key, 'me', bookId, 'c1'))?.markdown.trim().length).toBeGreaterThan(
      0,
    );
  });

  it('a revision that comes back EMPTY leaves the draft standing — the loop never costs a chapter', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    const { client } = scriptedClient([PLAN, DRAFT, CRITIQUE, '   ']);

    const res = await generateChapter(deps(fs, client), { bookId, chapterId: 'c1' });

    expect(res.ok).toBe(true);
    const saved = await getChapter(fs, key, 'me', bookId, 'c1');
    // The draft survives — imperfect prose beats no chapter.
    expect(saved?.markdown).toContain('The record does not say');
  });

  /**
   * The loop's whole promise is that it can never LOSE a chapter, and "the reply wasn't empty" does not
   * deliver that. A revision that returns only the corrected paragraphs ends with `end_turn` and plenty of
   * text — and on a FIRST draft there is no archived version to restore it from.
   */
  it('a revision that comes back as a FRAGMENT is refused — the draft stands', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    const longDraft = `${'He worked the lathe until the light went. '.repeat(20)}[[SRC:s0]]`;
    const critique = JSON.stringify({
      verdict: 'revise',
      findings: [{ kind: 'aiTell', quote: 'the light went', fix: 'Be concrete.' }],
    });
    const { client } = scriptedClient([PLAN, longDraft, critique, 'He worked. [[SRC:s0]]']);

    await generateChapter(deps(fs, client), { bookId, chapterId: 'c1' });

    const saved = await getChapter(fs, key, 'me', bookId, 'c1');
    expect(saved?.markdown).toContain('until the light went');
    expect(saved?.markdown.length).toBeGreaterThan(200); // the full draft, not the fragment
  });

  /**
   * A revision that drops its [[SRC:…]] markers would leave the chapter with empty provenance — and a
   * chapter citing nothing has an empty `sourceSignature`, which the freshness engine skips. It would
   * silently stop noticing new material for the rest of its life.
   */
  it('a revision that drops every citation is refused — provenance is never emptied', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    const { client } = scriptedClient([
      PLAN,
      DRAFT,
      CRITIQUE,
      'He never explained why he started.', // no [[SRC:…]] anywhere
    ]);

    await generateChapter(deps(fs, client), { bookId, chapterId: 'c1' });

    const saved = await getChapter(fs, key, 'me', bookId, 'c1');
    expect(saved?.provenance.length).toBeGreaterThan(0);
    expect(saved?.sourceSignature).not.toBe('');
    expect(saved?.markdown).toContain('The record does not say'); // the draft stood
  });

  it('an unparseable critique ships the draft rather than blocking the chapter', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    const { client, calls } = scriptedClient([PLAN, DRAFT, 'not json at all', 'NEVER']);

    const res = await generateChapter(deps(fs, client), { bookId, chapterId: 'c1' });

    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(3); // no revision attempted
    expect((await getChapter(fs, key, 'me', bookId, 'c1'))?.markdown).toContain(
      'The record does not say',
    );
  });

  /**
   * The corpus is the expensive part of a chapter — ~40k tokens, sent three or four times. It rides the
   * SYSTEM prompt so `cache_control` covers it, and the cache only hits if every pass sends a BYTE-IDENTICAL
   * system string. That identity is the whole optimization, so it is what this pins.
   */
  it('sends one identical system prompt carrying the corpus, so the cache can hit across passes', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    const { client, calls } = scriptedClient([PLAN, DRAFT, CRITIQUE, REVISED]);

    await generateChapter(deps(fs, client), { bookId, chapterId: 'c1' });

    expect(calls).toHaveLength(4);
    const systems = new Set(calls.map((c) => c.system));
    expect(systems.size).toBe(1); // one cached prefix, four reads

    // It really is the source material that's being cached, not just the doctrine.
    expect(calls[0]?.system).toContain('[s0]');
    expect(calls[0]?.system).toContain('he rebuilt the carburettor at fourteen');
    // And it is no longer repeated in every user message — that repetition was the cost.
    expect(calls.every((c) => !c.user.includes('he rebuilt the carburettor at fourteen'))).toBe(
      true,
    );
  });

  it('every book pass runs on Opus even when the app-wide model is the cheap one', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    const { client, calls } = scriptedClient([PLAN, DRAFT, CRITIQUE, REVISED]);

    await generateChapter(deps(fs, client), { bookId, chapterId: 'c1' });

    expect(calls.map((c) => c.model)).toEqual([BOOK_MODEL, BOOK_MODEL, BOOK_MODEL, BOOK_MODEL]);
    // The usage events carry the model that actually ran, so the estimated cost is right.
    const events = await queryUsage(fs, key, { from: '2000-01-01', to: '2100-01-01' });
    expect(events.every((e) => e.model === BOOK_MODEL)).toBe(true);
  });

  it('a task with no override keeps the person’s own model', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    const { client, calls } = scriptedClient([PLAN, DRAFT, CRITIQUE, REVISED]);
    // `models` carries only book tasks; a hypothetical unlisted type falls through to `deps.model`.
    const d = deps(fs, client);
    expect(d.models?.['chat']).toBeUndefined();
    await generateChapter({ ...d, models: {} }, { bookId, chapterId: 'c1' });
    expect(calls.every((c) => c.model === 'claude-sonnet-4-6')).toBe(true);
  });
});

describe('craft-loop progress (72 §5.3, §12)', () => {
  it('names the pass that is running, so a four-call chapter shows movement', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    const { client } = scriptedClient([PLAN, DRAFT, CRITIQUE, REVISED]);
    const phases: string[] = [];

    await generateChapter(deps(fs, client), {
      bookId,
      chapterId: 'c1',
      onPhase: (phase) => phases.push(phase),
    });

    expect(phases).toEqual(['planning', 'drafting', 'critiquing', 'revising']);
  });

  it('does not announce a revision that never runs', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    const { client } = scriptedClient([
      PLAN,
      DRAFT,
      JSON.stringify({ verdict: 'ship', findings: [] }),
    ]);
    const phases: string[] = [];

    await generateChapter(deps(fs, client), {
      bookId,
      chapterId: 'c1',
      onPhase: (phase) => phases.push(phase),
    });

    expect(phases).toEqual(['planning', 'drafting', 'critiquing']);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { ClaudeClient, FileSystem } from '../host';
import { saveInsight } from '../insights';
import { upsertPerson } from '../people/peopleService';
import { upsertRelationship } from '../people/relationshipService';
import { setAppBudget } from '../usage/budgetService';
import { queryUsage, recordUsage } from '../usage/usageStore';
import { addCustomIntimacyTopic } from './customTypeService';
import {
  gatherGenerationContext,
  listContextProviders,
  registerContextProvider,
  resetContextProviders,
} from './contextProviders';
import { extractJsonArray } from '../ai/jsonSalvage';
import { SUGGESTABLE_ANSWER_TYPES } from '../schemas';
import { GAP_FINDER_SYSTEM } from './aiPrompts';
import { generateQuestions, improveQuestion, type AiDeps } from './generationService';
import { suggestQuestionnaires } from './gapFinderService';

const key = generateMasterKey();
const now = new Date('2026-06-11T12:00:00.000Z');

/** A ClaudeClient whose stream returns canned text + zero token usage. */
function fakeClient(text: string): ClaudeClient {
  return {
    send: () => Promise.resolve(text),
    stream: (_options, onDelta) => {
      onDelta(text);
      return Promise.resolve({
        text,
        usage: { inputTokens: 10, outputTokens: 20, cacheWriteTokens: 0, cacheReadTokens: 0 },
      });
    },
  };
}

async function seedHousehold(
  fs: FileSystem,
  opts: { lockTarget?: boolean } = {},
): Promise<{ author: string; target: string }> {
  const author = await upsertPerson(fs, key, {
    displayName: 'Ben',
    isSubject: true,
    tags: ['journaling'],
    notes: 'Loves hiking.',
  });
  const target = await upsertPerson(fs, key, {
    displayName: 'Mara',
    isSubject: true,
    tags: [],
    notes: 'Enjoys cooking together.',
    // When locked, the target's notes must NOT feed generation (15-shareability §5 per-field gate).
    ...(opts.lockTarget ? { privateFields: ['notes'] as const } : {}),
  });
  await upsertRelationship(fs, key, {
    fromPersonId: author.id,
    toPersonId: target.id,
    type: 'partner',
    notes: 'Together 5 years.',
    ...(opts.lockTarget ? { notesShared: false } : {}),
  });
  await saveInsight(fs, key, {
    id: 'i1',
    schemaVersion: 1,
    source: 'questionnaire',
    subjectPersonId: author.id,
    summary: 'Values quality time.',
    facts: [{ id: 'f1', text: 'Prefers weekends free.', shareable: true }],
    confidence: 'high',
    categories: [],
    approved: true,
    provenance: { at: now.toISOString() },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });
  return { author: author.id, target: target.id };
}

function deps(fs: FileSystem, client: ClaudeClient, personId: string, apiKey = 'sk-x'): AiDeps {
  return { fs, key, client, apiKey, model: 'claude-sonnet-4-6', personId, now };
}

afterEach(() => resetContextProviders());

describe('contextProviders', () => {
  it('includes author + (toggled) target + relationship notes when shared', async () => {
    const fs = memFileSystem();
    const { author, target } = await seedHousehold(fs);
    const ctx = await gatherGenerationContext(fs, key, {
      authorPersonId: author,
      includeAuthor: true,
      targetPersonId: target,
      includeTarget: true,
      includeRelationship: true,
    });
    expect(ctx).toContain('Loves hiking.'); // author's own notes always feed
    expect(ctx).toContain('Enjoys cooking together.'); // target notes, shared by default
    expect(ctx).toContain('Together 5 years.'); // relationship notes, shared by default
    expect(ctx).toContain('Values quality time.'); // author insight
  });

  it('feeds a target’s LOCKED notes + unshared relationship note for tailoring (§24.5 owner override)', async () => {
    // Per the owner's informed §24.5 decision, questionnaire TAILORING uses ALL of the recipient's data —
    // private/locked fields included — so questions are as personal as possible. (This is scoped to
    // questionnaire generation; coaching context / Memory / cross-user boundaries elsewhere are unchanged.)
    const fs = memFileSystem();
    const { author, target } = await seedHousehold(fs, { lockTarget: true });
    const ctx = await gatherGenerationContext(fs, key, {
      authorPersonId: author,
      includeAuthor: true,
      targetPersonId: target,
      includeTarget: true,
      includeRelationship: true,
    });
    expect(ctx).toContain('Loves hiking.'); // author still feeds
    expect(ctx).toContain('Enjoys cooking together.'); // locked target notes now feed tailoring
    expect(ctx).toContain('Together 5 years.'); // unshared relationship notes now feed tailoring
  });

  it('feeds the recipient’s RICH profile as positive tailoring signal (§24.4-B1) + relationship closeness', async () => {
    const fs = memFileSystem();
    const author = await upsertPerson(fs, key, { displayName: 'Ben', isSubject: true, tags: [] });
    const target = await upsertPerson(fs, key, {
      displayName: 'Mara',
      isSubject: true,
      tags: [],
      occupation: 'nurse',
      interests: ['climbing', 'jazz'],
      values: ['honesty'],
      goals: 'run a marathon',
    });
    await upsertRelationship(fs, key, {
      fromPersonId: author.id,
      toPersonId: target.id,
      type: 'partner',
      closeness: 5,
    });
    const ctx = await gatherGenerationContext(fs, key, {
      authorPersonId: author.id,
      includeAuthor: true,
      targetPersonId: target.id,
      includeTarget: true,
      includeRelationship: true,
    });
    // The rich profile is positive tailoring signal, not just an avoid-list.
    expect(ctx).toMatch(/tailor to who they are/i);
    expect(ctx).toContain('occupation: nurse');
    expect(ctx).toContain('interests: climbing, jazz');
    expect(ctx).toContain('goals: run a marathon');
    // The relationship line carries the type + closeness.
    expect(ctx).toMatch(/relationship with Mara: partner, closeness 5\/5/);
  });

  it('omits the target + relationship when not toggled', async () => {
    const fs = memFileSystem();
    const { author, target } = await seedHousehold(fs);
    const ctx = await gatherGenerationContext(fs, key, {
      authorPersonId: author,
      includeAuthor: true,
      targetPersonId: target,
      includeTarget: false,
      includeRelationship: false,
    });
    expect(ctx).toContain('Loves hiking.');
    expect(ctx).not.toContain('Enjoys cooking together.');
  });

  it('lets a new provider register (the extensibility backbone)', async () => {
    const fs = memFileSystem();
    const { author } = await seedHousehold(fs);
    registerContextProvider({
      id: 'session-insights',
      label: 'Sessions',
      gather: () => Promise.resolve('From recent sessions: feeling hopeful.'),
    });
    expect(listContextProviders().some((p) => p.id === 'session-insights')).toBe(true);
    const ctx = await gatherGenerationContext(fs, key, {
      authorPersonId: author,
      includeAuthor: true,
      includeTarget: false,
      includeRelationship: false,
    });
    expect(ctx).toContain('feeling hopeful');
  });
});

describe('extractJsonArray', () => {
  it('pulls a JSON array out of fenced / prose-wrapped text', () => {
    expect(extractJsonArray('Sure!\n```json\n[{"a":1}]\n```')).toEqual([{ a: 1 }]);
    expect(extractJsonArray('no array here')).toBeNull();
  });
});

describe('generateQuestions', () => {
  const valid = JSON.stringify([
    {
      type: 'rating',
      prompt: 'How connected do you feel?',
      required: true,
      scale: { min: 1, max: 5 },
    },
    { type: 'singleChoice', prompt: 'Pick a date night', required: false, options: ['In', 'Out'] },
    { type: 'singleChoice', prompt: 'Bad one', required: false, options: ['only-one'] }, // dropped (needs >=2)
  ]);

  it('parses, validates, mints ids, and drops malformed questions', async () => {
    const fs = memFileSystem();
    const { author } = await seedHousehold(fs);
    const result = await generateQuestions(deps(fs, fakeClient(valid), author), {
      type: 'role-feedback',
      sensitivity: 'standard',
      brief: 'our relationship',
      context: {
        authorPersonId: author,
        includeAuthor: true,
        includeTarget: false,
        includeRelationship: false,
      },
      existingPrompts: [],
    });
    expect(result.ok).toBe(true);
    expect(result.questions).toHaveLength(2);
    expect(result.questions?.[0]?.id).toBeTruthy();
    expect(result.usage?.type).toBe('questionnaire.generate');
  });

  it('disables extended thinking for generation so it can’t starve the JSON budget (§17.9)', async () => {
    const fs = memFileSystem();
    const { author } = await seedHousehold(fs);
    let opts: { maxTokens?: number; extendedThinking?: boolean } = {};
    const capturing: ClaudeClient = {
      send: () => Promise.resolve(''),
      stream: (options) => {
        opts = options;
        return Promise.resolve({
          text: valid,
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    await generateQuestions(deps(fs, capturing, author), {
      type: 'role-feedback',
      sensitivity: 'standard',
      context: {
        authorPersonId: author,
        includeAuthor: true,
        includeTarget: false,
        includeRelationship: false,
      },
      existingPrompts: [],
    });
    // Adaptive thinking shares the token budget; for a bounded JSON call it must be OFF (else a long intimacy
    // prompt truncates the output to empty → "No usable questions"). And the budget is generous.
    expect(opts.extendedThinking).toBe(false);
    expect(opts.maxTokens).toBeGreaterThanOrEqual(2000);
  });

  it('drops a generated question that back-references unseen context, keeps the self-contained one (§25.4)', async () => {
    const fs = memFileSystem();
    const { author } = await seedHousehold(fs);
    const set = JSON.stringify([
      { type: 'shortText', prompt: 'How does that goal you mentioned feel now?', required: false },
      { type: 'shortText', prompt: 'What helps you unwind after a hard day?', required: false },
    ]);
    const result = await generateQuestions(deps(fs, fakeClient(set), author), {
      type: 'general',
      sensitivity: 'standard',
      context: {
        authorPersonId: author,
        includeAuthor: true,
        includeTarget: false,
        includeRelationship: false,
      },
      existingPrompts: [],
    });
    expect(result.ok).toBe(true);
    expect(result.questions?.map((q) => q.prompt)).toEqual([
      'What helps you unwind after a hard day?',
    ]);
  });

  it('the self-contained rule reaches the model (§25.4)', async () => {
    const fs = memFileSystem();
    const { author } = await seedHousehold(fs);
    let system = '';
    const capturing: ClaudeClient = {
      send: () => Promise.resolve(''),
      stream: (options) => {
        system = options.system;
        return Promise.resolve({
          text: valid,
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    await generateQuestions(deps(fs, capturing, author), {
      type: 'general',
      sensitivity: 'standard',
      context: {
        authorPersonId: author,
        includeAuthor: true,
        includeTarget: false,
        includeRelationship: false,
      },
      existingPrompts: [],
    });
    expect(system).toContain('STAND ENTIRELY ON ITS OWN');
  });

  it('scales maxTokens with the requested count so a large set is not truncated (§23.4)', async () => {
    const fs = memFileSystem();
    const { author } = await seedHousehold(fs);
    let opts: { maxTokens?: number } = {};
    const capturing: ClaudeClient = {
      send: () => Promise.resolve(''),
      stream: (options) => {
        opts = options;
        return Promise.resolve({
          text: valid,
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    await generateQuestions(deps(fs, capturing, author), {
      type: 'role-feedback',
      sensitivity: 'standard',
      count: 20,
      context: {
        authorPersonId: author,
        includeAuthor: true,
        includeTarget: false,
        includeRelationship: false,
      },
      existingPrompts: [],
    });
    // 20 questions × ~350 tokens ⇒ a much larger budget than the 2500 floor.
    expect(opts.maxTokens).toBeGreaterThanOrEqual(7000);
  });

  it('reports a cut-off draft distinctly from a brief problem (§17.9 diagnostic)', async () => {
    const fs = memFileSystem();
    const { author } = await seedHousehold(fs);
    // An empty reply = the model returned nothing parseable (e.g. truncated) → a "try again", not a brief fix.
    const result = await generateQuestions(deps(fs, fakeClient(''), author), {
      type: 'role-feedback',
      sensitivity: 'standard',
      context: {
        authorPersonId: author,
        includeAuthor: true,
        includeTarget: false,
        includeRelationship: false,
      },
      existingPrompts: [],
    });
    // 37 §3.2: an empty reply is TRUNCATED (cut off / token-starved), distinct from a refusal or a brief
    // problem — the message still says "cut off", but the reason is honest.
    expect(result).toMatchObject({ ok: false, reason: 'TRUNCATED' });
    expect(result.message).toMatch(/cut off/i);
  });

  it('de-dupes against existing prompts', async () => {
    const fs = memFileSystem();
    const { author } = await seedHousehold(fs);
    const result = await generateQuestions(deps(fs, fakeClient(valid), author), {
      type: 'role-feedback',
      sensitivity: 'standard',
      context: {
        authorPersonId: author,
        includeAuthor: true,
        includeTarget: false,
        includeRelationship: false,
      },
      existingPrompts: ['how connected do you feel?'], // case/space-insensitive match
    });
    expect(result.questions?.map((q) => q.prompt)).toEqual(['Pick a date night']);
  });

  it('hard-drops a generated question that near-duplicates one the recipient was already asked (§23.5)', async () => {
    const fs = memFileSystem();
    const { author } = await seedHousehold(fs);
    const returned = JSON.stringify({
      title: 'X',
      questions: [
        { type: 'shortText', prompt: 'What are your weekend plans?' }, // a re-ask (subset of the asked prompt)
        { type: 'shortText', prompt: 'What are you most proud of?' }, // genuinely new
      ],
    });
    const result = await generateQuestions(deps(fs, fakeClient(returned), author), {
      type: 'role-feedback',
      sensitivity: 'standard',
      context: {
        authorPersonId: author,
        includeAuthor: true,
        includeTarget: false,
        includeRelationship: false,
      },
      existingPrompts: [],
      // A prior questionnaire already covered their weekend plans — the model returned a re-ask, but the
      // deterministic filter drops it (2 shared content words) while keeping the genuinely-new question.
      recipientAskedPrompts: ['Tell me about your typical weekend plans lately'],
    });
    expect(result.questions?.map((q) => q.prompt)).toEqual(['What are you most proud of?']);
  });

  it('runs the semantic de-dup pass when a recipient has history, then trims to the requested count (§23.5)', async () => {
    const fs = memFileSystem();
    const { author } = await seedHousehold(fs);
    // First stream call = generation (4 fresh questions); second = the semantic pass (keep indices 1 & 3).
    const responses = [
      JSON.stringify({
        title: 'T',
        questions: [
          { type: 'shortText', prompt: 'One?' },
          { type: 'shortText', prompt: 'Two?' },
          { type: 'shortText', prompt: 'Three?' },
          { type: 'shortText', prompt: 'Four?' },
        ],
      }),
      '[1,3]',
    ];
    let calls = 0;
    const seq: ClaudeClient = {
      send: () => Promise.resolve(''),
      stream: (_o, onDelta) => {
        const text = responses[Math.min(calls, responses.length - 1)] ?? '';
        calls += 1;
        onDelta(text);
        return Promise.resolve({
          text,
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    const result = await generateQuestions(deps(fs, seq, author), {
      type: 'general',
      sensitivity: 'standard',
      count: 2,
      context: {
        authorPersonId: author,
        includeAuthor: true,
        includeTarget: false,
        includeRelationship: false,
      },
      existingPrompts: [],
      recipientHistory: 'Themes they have already explored:\n- Work stress.',
    });
    expect(calls).toBe(2); // generation + the semantic pass
    // The pass kept Q1 + Q3; trimmed to the requested count (2).
    expect(result.questions?.map((q) => q.prompt)).toEqual(['One?', 'Three?']);
  });

  it('runs the semantic pass for an intimacy set even with NO recipient history (intra-batch dedup, #192)', async () => {
    const fs = memFileSystem();
    const { author } = await seedHousehold(fs);
    // Generation returns 3 questions, two of which are near-identical; the semantic pass (2nd call) drops the
    // later duplicate (keep indices 1 & 3). No recipientHistory/dedupReference — the pass runs because the
    // questionnaire is a sensitive intimacy type.
    const responses = [
      JSON.stringify({
        title: 'T',
        questions: [
          { type: 'shortText', prompt: 'What turns you on the most?' },
          { type: 'shortText', prompt: 'What really gets you going in bed?' },
          { type: 'shortText', prompt: 'What is a hard limit for you?' },
        ],
      }),
      '[1,3]',
    ];
    let calls = 0;
    const seq: ClaudeClient = {
      send: () => Promise.resolve(''),
      stream: (_o, onDelta) => {
        const text = responses[Math.min(calls, responses.length - 1)] ?? '';
        calls += 1;
        onDelta(text);
        return Promise.resolve({
          text,
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    const result = await generateQuestions(deps(fs, seq, author), {
      type: 'intimacy',
      sensitivity: 'explicit',
      count: 3,
      context: {
        authorPersonId: author,
        includeAuthor: true,
        includeTarget: false,
        includeRelationship: false,
      },
      existingPrompts: [],
      // No recipientHistory / dedupReference on purpose.
    });
    expect(calls).toBe(2); // generation + the intra-batch semantic pass
    expect(result.questions?.map((q) => q.prompt)).toEqual([
      'What turns you on the most?',
      'What is a hard limit for you?',
    ]);
  });

  it('returns NO_KEY without a key, and REFUSED on unusable output', async () => {
    const fs = memFileSystem();
    const { author } = await seedHousehold(fs);
    const noKey = await generateQuestions(deps(fs, fakeClient(valid), author, ''), {
      type: 'x',
      sensitivity: 'standard',
      context: {
        authorPersonId: author,
        includeAuthor: true,
        includeTarget: false,
        includeRelationship: false,
      },
      existingPrompts: [],
    });
    expect(noKey).toMatchObject({ ok: false, reason: 'NO_KEY' });

    const refused = await generateQuestions(
      deps(fs, fakeClient('I cannot help with that.'), author),
      {
        type: 'x',
        sensitivity: 'standard',
        context: {
          authorPersonId: author,
          includeAuthor: true,
          includeTarget: false,
          includeRelationship: false,
        },
        existingPrompts: [],
      },
    );
    // A refusal still charges for the call it made: usage is recorded with the generate type.
    expect(refused).toMatchObject({ ok: false, reason: 'REFUSED' });
    expect(refused.usage?.type).toBe('questionnaire.generate');
    const recorded = await queryUsage(fs, key, {
      personId: author,
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-07-01T00:00:00.000Z',
    });
    expect(recorded.some((e) => e.type === 'questionnaire.generate')).toBe(true);
  });

  it('blocks when the app budget is over', async () => {
    const fs = memFileSystem();
    const { author } = await seedHousehold(fs);
    await setAppBudget(fs, key, { limitUsd: 0.5, period: 'week', warnRatio: 0.8 });
    await recordUsage(fs, key, {
      id: 'u1',
      schemaVersion: 1,
      type: 'chat',
      personId: author,
      model: 'claude-sonnet-4-6',
      at: now.toISOString(),
      inputTokens: 0,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      costUsd: 1,
    });
    const result = await generateQuestions(deps(fs, fakeClient(valid), author), {
      type: 'x',
      sensitivity: 'standard',
      context: {
        authorPersonId: author,
        includeAuthor: true,
        includeTarget: false,
        includeRelationship: false,
      },
      existingPrompts: [],
    });
    expect(result).toMatchObject({ ok: false, reason: 'BUDGET' });
  });

  it('returns the AI-suggested title from the {title, questions} object (§16.4)', async () => {
    const fs = memFileSystem();
    const { author } = await seedHousehold(fs);
    const withTitle = JSON.stringify({
      title: 'Reconnecting after the move',
      questions: [
        { type: 'yesNo', prompt: 'Do you feel heard lately?', required: true },
        { type: 'shortText', prompt: 'One thing you need more of?', required: false },
      ],
    });
    const result = await generateQuestions(deps(fs, fakeClient(withTitle), author), {
      type: 'role-feedback',
      sensitivity: 'standard',
      context: {
        authorPersonId: author,
        includeAuthor: true,
        includeTarget: false,
        includeRelationship: false,
      },
      existingPrompts: [],
    });
    expect(result.ok).toBe(true);
    expect(result.title).toBe('Reconnecting after the move');
    expect(result.questions).toHaveLength(2);
  });

  it('sends the explicit framing + topic inventory to the model for an intimacy/unfiltered send (§16.5)', async () => {
    const fs = memFileSystem();
    const { author } = await seedHousehold(fs);
    // Add an owner custom topic so we can prove the MERGED inventory reaches the model.
    await addCustomIntimacyTopic(fs, 'activities', 'Sploshing');
    let sentUserText = '';
    const capturing: ClaudeClient = {
      send: () => Promise.resolve(''),
      stream: (options, onDelta) => {
        sentUserText = options.messages.map((m) => m.content).join('\n');
        const text = JSON.stringify({
          title: 'X',
          questions: [{ type: 'yesNo', prompt: 'Q?', required: true }],
        });
        onDelta(text);
        return Promise.resolve({
          text,
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    const result = await generateQuestions(deps(fs, capturing, author), {
      type: 'intimacy',
      sensitivity: 'unfiltered',
      context: {
        authorPersonId: author,
        includeAuthor: false,
        includeTarget: false,
        includeRelationship: false,
      },
      existingPrompts: [],
    });
    expect(result.ok).toBe(true);
    expect(sentUserText).toMatch(/no-holds-barred/i); // the §22.2 unfiltered explicit direction
    expect(sentUserText).toMatch(/appropriate and expected/i); // the legitimate-context framing
    expect(sentUserText).toContain('Deepthroat'); // a built-in topic
    expect(sentUserText).toContain('Sploshing'); // the owner's custom addition (merged inventory)
    expect(sentUserText).toMatch(/never minors/i); // the boundary
  });

  it('feeds recipient history as avoid-only grounding with the never-reference safety clause (§17.4)', async () => {
    const fs = memFileSystem();
    const { author } = await seedHousehold(fs);
    let sentUserText = '';
    const capturing: ClaudeClient = {
      send: () => Promise.resolve(''),
      stream: (options, onDelta) => {
        sentUserText = options.messages.map((m) => m.content).join('\n');
        const text = JSON.stringify({
          title: 'X',
          questions: [{ type: 'yesNo', prompt: 'Q?', required: true }],
        });
        onDelta(text);
        return Promise.resolve({
          text,
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    const result = await generateQuestions(deps(fs, capturing, author), {
      type: 'role-feedback',
      sensitivity: 'standard',
      context: {
        authorPersonId: author,
        includeAuthor: true,
        includeTarget: false,
        includeRelationship: false,
      },
      existingPrompts: [],
      recipientHistory: 'Themes they have already explored:\n- Burnout at work.',
    });
    expect(result.ok).toBe(true);
    expect(sentUserText).toContain('Burnout at work.'); // the history reaches the model
    expect(sentUserText).toMatch(/ALREADY KNOWN/i); // the known-data framing (§24: personalize + don't re-ask)
    expect(sentUserText).toMatch(/Weave this knowledge in NATURALLY/i); // use it, don't recite verbatim
    expect(sentUserText).toMatch(/don't RE-ASK it/i);
    // 08 §19.2: the knowledge-aware contract tells the model to go deeper / explore the unknown / be creative.
    expect(sentUserText).toMatch(/GO DEEPER/);
    expect(sentUserText).toMatch(/UNKNOWN/);
    expect(sentUserText).toMatch(/CREATIVE/);
    expect(sentUserText).toMatch(/do NOT offer a multiple-choice OPTION that repeats/i);
  });

  // 08 §19.3: for an intimacy draft, the acts the recipient already rated are reframed as "go deeper, don't
  // re-ask" instead of being re-seeded as the inventory — the core fix for the repeats-known-data bug.
  it('reframes already-rated intimacy acts as "go deeper, don’t re-ask" (§19.3)', async () => {
    const fs = memFileSystem();
    const { author } = await seedHousehold(fs);
    let sentUserText = '';
    const capturing: ClaudeClient = {
      send: () => Promise.resolve(''),
      stream: (options, onDelta) => {
        sentUserText = options.messages.map((m) => m.content).join('\n');
        const text = JSON.stringify({
          title: 'X',
          questions: [{ type: 'shortText', prompt: 'A fresh, deeper question?', required: true }],
        });
        onDelta(text);
        return Promise.resolve({
          text,
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    const result = await generateQuestions(deps(fs, capturing, author), {
      type: 'intimacy',
      sensitivity: 'unfiltered',
      context: {
        authorPersonId: author,
        includeAuthor: false,
        includeTarget: false,
        includeRelationship: false,
      },
      existingPrompts: [],
      coveredIntimacyActs: [{ label: 'Receiving oral (blowjob)', rating: 'Love it' }],
    });
    expect(result.ok).toBe(true);
    expect(sentUserText).toMatch(/ALREADY RATED/); // the reframe header
    expect(sentUserText).toMatch(/go DEEPER/i);
    expect(sentUserText).toContain('Receiving oral (blowjob) (Love it)'); // the rated act, labelled
    expect(sentUserText).toMatch(/do NOT re-ask whether they like them/i);
    expect(sentUserText).toMatch(/FAVOR acts, fantasies, and scenarios they have NOT yet rated/i);
    expect(sentUserText).toMatch(/never minors/i); // the safety boundary is unchanged
  });
});

describe('improveQuestion + gap-finder', () => {
  it('rewrites a single question (stripping quotes)', async () => {
    const fs = memFileSystem();
    const { author } = await seedHousehold(fs);
    const result = await improveQuestion(
      deps(fs, fakeClient('"How are we really doing?"'), author),
      {
        prompt: 'how r we',
        type: 'shortText',
        instruction: 'warmer',
      },
    );
    expect(result).toMatchObject({ ok: true, prompt: 'How are we really doing?' });
  });

  it('suggests questionnaires from structured context', async () => {
    const fs = memFileSystem();
    const { author } = await seedHousehold(fs);
    const text = JSON.stringify([
      {
        title: 'Weekly partner check-in',
        type: 'role-feedback',
        rationale: 'You value quality time.',
        questions: [{ type: 'rating', prompt: 'How was this week?', required: true }],
      },
    ]);
    const result = await suggestQuestionnaires(deps(fs, fakeClient(text), author));
    expect(result.ok).toBe(true);
    expect(result.suggestions?.[0]?.title).toBe('Weekly partner check-in');
    expect(result.usage?.type).toBe('questionnaire.suggest');
  });

  // 08 §19.4: a choice-type sample question keeps its options through the parse, so "Create from this" never
  // seeds a blank multiple-choice question (the reported bug).
  it('keeps a sample question’s options (no blank multiple-choice on seed, §19.4)', async () => {
    const fs = memFileSystem();
    const { author } = await seedHousehold(fs);
    const text = JSON.stringify([
      {
        title: 'Depletion check',
        type: 'general',
        rationale: 'a',
        questions: [
          {
            type: 'multiChoice',
            prompt: 'Which of these leave you depleted?',
            options: ['Big social events', 'Conflict', 'Long meetings'],
          },
        ],
      },
    ]);
    const result = await suggestQuestionnaires(deps(fs, fakeClient(text), author));
    expect(result.ok).toBe(true);
    expect(result.suggestions?.[0]?.questions[0]?.options).toEqual([
      'Big social events',
      'Conflict',
      'Long meetings',
    ]);
  });

  // 08 §18.2: the recipient-first path feeds the recipient's name + their full answered content (avoid-only)
  // and the already-saved idea titles, so the model tailors deeply, never repeats, and "Suggest more" is new.
  it('feeds the recipient name, their history (avoid-only) + already-saved titles to the model (§18.2)', async () => {
    const fs = memFileSystem();
    const { author } = await seedHousehold(fs);
    let sentUserText = '';
    const capturing: ClaudeClient = {
      send: () => Promise.resolve(''),
      stream: (options, onDelta) => {
        sentUserText = options.messages.map((m) => m.content).join('\n');
        const text = JSON.stringify([
          {
            title: 'New idea',
            type: 'general',
            rationale: 'r',
            questions: [{ type: 'yesNo', prompt: 'Q?' }],
          },
        ]);
        onDelta(text);
        return Promise.resolve({
          text,
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    const result = await suggestQuestionnaires(deps(fs, capturing, author), {
      targetPersonId: author, // any household person id is fine for the message-content assertions
      recipientName: 'Mara',
      recipientHistory: 'Themes they have already explored:\n- Burnout at work.',
      avoidSuggestions: ['Weekly partner check-in'],
    });
    expect(result.ok).toBe(true);
    expect(sentUserText).toContain('specifically for Mara'); // tailoring to the named person
    expect(sentUserText).toContain('Burnout at work.'); // their history reaches the model
    expect(sentUserText).toMatch(/ALREADY shared/i); // the avoid framing
    expect(sentUserText).toMatch(/go DEEPER/i); // dive-deeper instruction
    expect(sentUserText).toMatch(/never quote, restate, reference/i); // the never-reveal safety clause
    expect(sentUserText).toMatch(/ALREADY proposed these/i); // accumulate-avoid the saved ideas
    expect(sentUserText).toContain('Weekly partner check-in'); // the saved title is the avoid list
  });

  // The reported bug (37 §3.3): the live model returns suggestions WITHOUT `required` on the sample
  // questions; the old all-or-nothing parse + over-strict `required: z.boolean()` discarded the whole batch
  // and showed "add more about the people in your life" — a data blame AFTER a successful call. This is the
  // test that would have caught it.
  it('REGRESSION: keeps suggestions whose sample questions omit `required` (the gap-finder bug)', async () => {
    const fs = memFileSystem();
    const { author } = await seedHousehold(fs);
    const text = JSON.stringify([
      {
        title: 'Partner check-in',
        type: 'role-feedback',
        rationale: 'a',
        questions: [{ type: 'rating', prompt: 'How was this week?' }], // no `required`
      },
      {
        title: 'Friend feedback',
        type: 'role-feedback',
        rationale: 'b',
        questions: [{ type: 'yesNo', prompt: 'Do you feel heard?' }], // no `required`
      },
      {
        title: 'Role review',
        type: 'role-feedback',
        rationale: 'c',
        questions: [{ type: 'shortText', prompt: 'One thing to change?' }], // no `required`
      },
    ]);
    const result = await suggestQuestionnaires(deps(fs, fakeClient(text), author));
    expect(result.ok).toBe(true);
    expect(result.suggestions).toHaveLength(3); // today this yields ZERO without the fix
  });

  it('salvages the good suggestions, dropping a wholly-malformed one (per-element, 37 §3.1)', async () => {
    const fs = memFileSystem();
    const { author } = await seedHousehold(fs);
    const text = JSON.stringify([
      {
        title: 'Good one',
        type: 'role-feedback',
        rationale: 'a',
        questions: [{ type: 'yesNo', prompt: 'Q?' }],
      },
      {
        title: 'Bad one',
        type: 'role-feedback',
        rationale: 'b',
        questions: [{ type: 'not-a-type', prompt: 'X' }], // its ONLY question is off-spec → suggestion drops
      },
    ]);
    const result = await suggestQuestionnaires(deps(fs, fakeClient(text), author));
    expect(result.ok).toBe(true);
    expect(result.suggestions?.map((s) => s.title)).toEqual(['Good one']);
  });

  // The reported "unexpected shape" bug: the live model guesses answer-type names (e.g. "text"/"scale")
  // because the prompt never listed the valid ones. A single off-spec sample `type` used to fail the WHOLE
  // `questions` array → the whole suggestion was discarded; with every suggestion losing one sample question
  // the batch went EMPTY → MALFORMED. The inner array is now per-element tolerant (37 §3.1): a bad sample
  // question drops only ITSELF, so a suggestion with one good + one bad question survives with the good one.
  it('REGRESSION: keeps suggestions whose sample questions mix a valid + an off-spec `type` (the “unexpected shape” bug)', async () => {
    const fs = memFileSystem();
    const { author } = await seedHousehold(fs);
    const text = JSON.stringify([
      {
        title: 'Partner check-in',
        type: 'role-feedback',
        rationale: 'a',
        questions: [
          { type: 'rating', prompt: 'How connected this week?' }, // valid → kept
          { type: 'text', prompt: 'Anything unsaid?' }, // off-spec → dropped, suggestion survives
        ],
      },
      {
        title: 'What we each need',
        type: 'general',
        rationale: 'b',
        questions: [
          { type: 'scale', prompt: 'Bad type first' }, // off-spec → dropped
          { type: 'shortText', prompt: 'One thing you need more of?' }, // valid → kept
        ],
      },
      {
        title: 'Friend feedback',
        type: 'role-feedback',
        rationale: 'c',
        questions: [
          { type: 'open', prompt: 'Bad' },
          { type: 'yesNo', prompt: 'Do you feel heard?' },
        ],
      },
    ]);
    const result = await suggestQuestionnaires(deps(fs, fakeClient(text), author));
    expect(result.ok).toBe(true);
    // All three survive (previously ZERO did) — each keeping only its valid sample question.
    expect(result.suggestions?.map((s) => s.title)).toEqual([
      'Partner check-in',
      'What we each need',
      'Friend feedback',
    ]);
    expect(result.suggestions?.every((s) => s.questions.length === 1)).toBe(true);
    expect(result.suggestions?.[0]?.questions[0]?.type).toBe('rating');
    expect(result.suggestions?.[1]?.questions[0]?.type).toBe('shortText');
    expect(result.suggestions?.[2]?.questions[0]?.type).toBe('yesNo');
  });

  // The root cause: the gap-finder prompt told the model to "use the same answer types as generation" but
  // never listed them (the model can't see the generation prompt) — so it guessed invalid types. The system
  // prompt must now name the exact enum values, and never carry the dangling reference.
  it('the gap-finder system prompt lists the valid answer types (no dangling “same as generation”)', () => {
    for (const t of SUGGESTABLE_ANSWER_TYPES) expect(GAP_FINDER_SYSTEM).toContain(t);
    expect(GAP_FINDER_SYSTEM).not.toMatch(/same answer types as generation/i);
  });

  it('tolerates a suggestion missing `type`/`rationale` (only a title + a usable question are required)', async () => {
    const fs = memFileSystem();
    const { author } = await seedHousehold(fs);
    const text = JSON.stringify([
      { title: 'Just a title', questions: [{ type: 'yesNo', prompt: 'Q?' }] }, // no type, no rationale
    ]);
    const result = await suggestQuestionnaires(deps(fs, fakeClient(text), author));
    expect(result.ok).toBe(true);
    expect(result.suggestions?.[0]?.title).toBe('Just a title');
    expect(result.suggestions?.[0]?.type).toBe('general'); // defaulted, not dropped
  });

  it('salvages the complete suggestions from a TRUNCATED array', async () => {
    const fs = memFileSystem();
    const { author } = await seedHousehold(fs);
    // Two complete suggestions, then a third cut off mid-object.
    const text =
      '[{"title":"One","type":"x","rationale":"a","questions":[{"type":"yesNo","prompt":"Q1?"}]},' +
      '{"title":"Two","type":"x","rationale":"b","questions":[{"type":"yesNo","prompt":"Q2?"}]},' +
      '{"title":"Three","type":"x","rationale":"c","questions":[{"type":"yesN';
    const result = await suggestQuestionnaires(deps(fs, fakeClient(text), author));
    expect(result.ok).toBe(true);
    expect(result.suggestions?.map((s) => s.title)).toEqual(['One', 'Two']);
  });

  it('returns an honest MALFORMED (not a data blame) when no JSON comes back, AND still meters', async () => {
    const fs = memFileSystem();
    const { author } = await seedHousehold(fs);
    const result = await suggestQuestionnaires(deps(fs, fakeClient('no json here'), author));
    expect(result).toMatchObject({ ok: false, reason: 'MALFORMED' });
    expect((result as { message: string }).message).not.toMatch(/add more about/i);
    // The call succeeded, so the tokens were metered (meter-before-parse).
    const billed = await queryUsage(fs, key, {
      personId: author,
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-07-01T00:00:00.000Z',
    });
    expect(billed.some((e) => e.type === 'questionnaire.suggest')).toBe(true);
  });

  it('reports REFUSED when the reply is refusal-shaped prose', async () => {
    const fs = memFileSystem();
    const { author } = await seedHousehold(fs);
    const result = await suggestQuestionnaires(
      deps(fs, fakeClient('I cannot help with that.'), author),
    );
    expect(result).toMatchObject({ ok: false, reason: 'REFUSED' });
  });

  it('PRE-CALL: shows the empty-state hint without spending when there is no context (37 §11)', async () => {
    const fs = memFileSystem();
    // A bare subject with no notes/tags/relationships/insights → gatherGenerationContext returns ''.
    const bare = await upsertPerson(fs, key, { displayName: 'Solo', isSubject: true, tags: [] });
    // A client that throws if called — proving no Claude call is made.
    const noCall: ClaudeClient = {
      send: () => Promise.reject(new Error('should not be called')),
      stream: () => Promise.reject(new Error('should not be called')),
    };
    const result = await suggestQuestionnaires(deps(fs, noCall, bare.id));
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toMatch(/add more about the people/i);
    expect((result as { reason?: string }).reason).toBeUndefined(); // an empty state, not an AI failure
    const billed = await queryUsage(fs, key, {
      personId: bare.id,
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-07-01T00:00:00.000Z',
    });
    expect(billed).toHaveLength(0); // no spend
  });

  it('PRE-CALL: still recognizes an empty context when a data-less TARGET is selected (§24.4 boilerplate)', async () => {
    // §24: profilesProvider now emits "It is FOR <name> — tailor to who they are:" for the target. A data-less
    // target must still be treated as thin context (only identity boilerplate) so the gap-finder doesn't spend.
    const fs = memFileSystem();
    const author = await upsertPerson(fs, key, { displayName: 'Solo', isSubject: true, tags: [] });
    const bareTarget = await upsertPerson(fs, key, {
      displayName: 'Blank',
      isSubject: true,
      tags: [],
    });
    const noCall: ClaudeClient = {
      send: () => Promise.reject(new Error('should not be called')),
      stream: () => Promise.reject(new Error('should not be called')),
    };
    const result = await suggestQuestionnaires(deps(fs, noCall, author.id), {
      targetPersonId: bareTarget.id,
    });
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toMatch(/add more about the people/i);
    expect((result as { reason?: string }).reason).toBeUndefined();
  });
});

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
import {
  extractJsonArray,
  generateQuestions,
  improveQuestion,
  type AiDeps,
} from './generationService';
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

  it('excludes a target’s LOCKED notes and an unshared relationship note (15 §5)', async () => {
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
    expect(ctx).not.toContain('Enjoys cooking together.'); // target notes locked → excluded
    expect(ctx).not.toContain('Together 5 years.'); // relationship notes unshared → excluded
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
    await addCustomIntimacyTopic(fs, 'activities', 'Wax play');
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
    expect(sentUserText).toMatch(/genuinely explicit/i); // the §16.5 explicit direction
    expect(sentUserText).toMatch(/appropriate and expected/i); // the legitimate-context framing
    expect(sentUserText).toContain('Oral (giving)'); // a built-in topic
    expect(sentUserText).toContain('Wax play'); // the owner's custom addition (merged inventory)
    expect(sentUserText).toMatch(/never minors/i); // the boundary
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
});

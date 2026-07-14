import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { ClaudeClient, FileSystem } from '../host';
import { upsertPerson } from '../people/peopleService';
import { saveInsight } from '../insights/insightStore';
import {
  registerBuiltInContextProviders,
  resetContextProviders,
} from '../questionnaires/contextProviders';
import type { AiDeps } from '../questionnaires/aiCall';
import { createGoal } from './goalService';
import { suggestGoals } from './goalSuggestService';

const key = generateMasterKey();
const now = new Date('2026-07-14T00:00:00.000Z');

/** A ClaudeClient whose stream returns canned text + a small token usage. */
function fakeClient(text: string): ClaudeClient {
  return {
    send: () => Promise.resolve(text),
    stream: (_options, onDelta) => {
      onDelta(text);
      return Promise.resolve({
        text,
        usage: { inputTokens: 20, outputTokens: 40, cacheWriteTokens: 0, cacheReadTokens: 0 },
      });
    },
  };
}

function deps(fs: FileSystem, client: ClaudeClient, personId: string): AiDeps {
  return { fs, key, client, apiKey: 'sk-x', model: 'claude-sonnet-4-6', personId, now };
}

/** Seed a person with enough context (notes + an insight) that `isThinContext` is false. */
async function seedRichPerson(fs: FileSystem): Promise<string> {
  const p = await upsertPerson(fs, key, {
    displayName: 'Ben',
    isSubject: true,
    notes: 'Wants to reconnect with his sister and move his body more.',
    tags: ['family'],
  });
  await saveInsight(fs, key, {
    id: 'i1',
    schemaVersion: 1,
    source: 'session',
    subjectPersonId: p.id,
    summary: 'Keeps circling back to his relationship with his sister.',
    facts: [{ id: 'f1', text: 'Misses his sister.', shareable: false }],
    confidence: 'high',
    categories: [],
    approved: true,
    provenance: { at: now.toISOString() },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });
  return p.id;
}

beforeEach(() => registerBuiltInContextProviders());
afterEach(() => resetContextProviders());

describe('goalSuggestService.suggestGoals (60 §3.1.3)', () => {
  it('proposes goals from the person’s own context, clamping life-area to the taxonomy', async () => {
    const fs = memFileSystem();
    const personId = await seedRichPerson(fs);
    const client = fakeClient(
      JSON.stringify([
        {
          text: 'Call your sister this week',
          lifeArea: 'Relationships',
          rationale: 'You miss her',
        },
        { text: 'Take one short walk most days', lifeArea: 'not-a-real-area' },
      ]),
    );
    const result = await suggestGoals(deps(fs, client, personId));
    expect(result.ok).toBe(true);
    expect(result.suggestions).toHaveLength(2);
    expect(result.suggestions?.[0]?.text).toBe('Call your sister this week');
    expect(result.suggestions?.[0]?.lifeArea).toBe('Relationships');
    // An off-taxonomy life-area is dropped rather than trusted.
    expect(result.suggestions?.[1]?.lifeArea).toBeUndefined();
    // Metered so it counts toward the budget.
    expect(result.usage?.type).toBe('goal.suggest');
  });

  it('returns a calm empty state (no call, no reason) when there is nothing to work from', async () => {
    const fs = memFileSystem();
    // A bare person with no notes/insights → thin context → no spend.
    const p = await upsertPerson(fs, key, { displayName: 'Solo', isSubject: true, tags: [] });
    let called = false;
    const client: ClaudeClient = {
      send: () => Promise.resolve(''),
      stream: () => {
        called = true;
        return Promise.resolve({
          text: '',
          usage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    const result = await suggestGoals(deps(fs, client, p.id));
    expect(result.ok).toBe(false);
    expect(result.reason).toBeUndefined(); // an empty STATE, not an AI failure
    expect(called).toBe(false); // never spent
  });

  it('salvages a usable subset from an imperfect reply and drops empty-text items (37 tolerance)', async () => {
    const fs = memFileSystem();
    const personId = await seedRichPerson(fs);
    // One good, one with no text (dropped), plus a trailing truncated object.
    const client = fakeClient(
      '[{"text":"Journal for five minutes before bed"},{"text":""},{"text":"Plan a we',
    );
    const result = await suggestGoals(deps(fs, client, personId));
    expect(result.ok).toBe(true);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions?.[0]?.text).toBe('Journal for five minutes before bed');
  });

  it('reports an honest failure (not a data blame) when nothing usable comes back', async () => {
    const fs = memFileSystem();
    const personId = await seedRichPerson(fs);
    const result = await suggestGoals(deps(fs, fakeClient('[]'), personId));
    expect(result.ok).toBe(false);
    expect(result.reason).toBeDefined(); // classified honestly (MALFORMED/TRUNCATED/REFUSED)
  });

  it('does not repeat a goal the person already has (the existing goals feed the prompt)', async () => {
    const fs = memFileSystem();
    const personId = await seedRichPerson(fs);
    await createGoal(fs, key, personId, { text: 'Call your sister this week' }, now);
    let seenPrompt = '';
    const client: ClaudeClient = {
      send: () => Promise.resolve('[]'),
      stream: (options) => {
        seenPrompt = options.messages.map((m) => String(m.content)).join('\n');
        const text = JSON.stringify([{ text: 'Cook one new recipe' }]);
        return Promise.resolve({
          text,
          usage: { inputTokens: 10, outputTokens: 10, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    const result = await suggestGoals(deps(fs, client, personId));
    expect(result.ok).toBe(true);
    // The existing goal is passed as an avoid-list so the model steers clear of it.
    expect(seenPrompt).toContain('Call your sister this week');
  });
});

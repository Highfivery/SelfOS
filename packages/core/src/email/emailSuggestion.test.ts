import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import type { ClaudeClient, ClaudeStreamResult } from '../host';
import { memFileSystem } from '../host/memFileSystem';
import type { AiDeps } from '../questionnaires/aiCall';
import { queryUsage } from '../usage';
import { writeEncryptedJson } from '../vault';
import type { EmailResponse, SentSuggestion } from '../schemas';
import {
  buildAvoidSet,
  generateSuggestion,
  hasNewSuggestionData,
  listSentSuggestions,
  recordSentSuggestion,
  type SuggestionSignals,
} from './emailSuggestionService';

const key = generateMasterKey();
const now = new Date('2026-09-01T12:00:00.000Z');
const PERSON = 'me';

/** A Claude client that always returns the given text as one non-truncated reply. */
function clientReturning(text: string): ClaudeClient {
  const result: ClaudeStreamResult = {
    text,
    usage: { inputTokens: 100, outputTokens: 80, cacheWriteTokens: 0, cacheReadTokens: 0 },
    stopReason: 'end_turn',
  };
  return { send: () => Promise.resolve(''), stream: () => Promise.resolve(result) };
}

function deps(fs: ReturnType<typeof memFileSystem>, client: ClaudeClient): AiDeps {
  return { fs, key, client, apiKey: 'sk', model: 'claude-sonnet-4-6', personId: PERSON, now };
}

const emptySignals: SuggestionSignals = { newInsights: [], newSessionCount: 0 };

describe('hasNewSuggestionData (67 §3.3)', () => {
  it('is false with no new data and true with any fresh signal', () => {
    expect(hasNewSuggestionData(emptySignals)).toBe(false);
    expect(hasNewSuggestionData({ ...emptySignals, newSessionCount: 1 })).toBe(true);
    expect(hasNewSuggestionData({ ...emptySignals, observation: 'a reflection' })).toBe(true);
    expect(hasNewSuggestionData(emptySignals, 2)).toBe(true); // intimacy overlap
  });
});

describe('generateSuggestion (67 §3.3)', () => {
  it('composes a de-dup-checked suggestion from a fresh signal', async () => {
    const fs = memFileSystem();
    const client = clientReturning(
      '{"headline":"A small step","body":"Notice one good moment today."}',
    );
    const out = await generateSuggestion(deps(fs, client), {
      family: 'ai-suggestion',
      signals: { ...emptySignals, observation: 'You have been reflecting on rest.' },
      avoid: { texts: [], subjects: new Set() },
    });
    expect(out).not.toBeNull();
    expect(out?.suggestion.headline).toBe('A small step');
    expect(out?.suggestion.suggestionType).toBe('question-to-sit-with');
    expect(out?.sent.text).toContain('A small step');
    expect(out?.usage.type).toBe('email.suggest');
    // `runClaude` records the usage event ONCE internally — the caller must NOT re-record it (that would
    // double-count against budget). Exactly one `email.suggest` event exists.
    const events = await queryUsage(fs, key, {
      from: '2000-01-01T00:00:00.000Z',
      to: '2100-01-01T00:00:00.000Z',
      personId: PERSON,
      type: 'email.suggest',
    });
    expect(events).toHaveLength(1);
  });

  it('drops a candidate that near-duplicates a recent suggestion (never a re-phrasing)', async () => {
    const fs = memFileSystem();
    const client = clientReturning(
      '{"headline":"Notice one good moment","body":"Notice one good moment today and name it."}',
    );
    const out = await generateSuggestion(deps(fs, client), {
      family: 'ai-suggestion',
      signals: { ...emptySignals, observation: 'rest' },
      avoid: {
        texts: ['Notice one good moment today Notice one good moment today and name it'],
        subjects: new Set(),
      },
    });
    expect(out).toBeNull();
  });

  it('returns null for the intimacy family when the shared overlap is exhausted', async () => {
    const fs = memFileSystem();
    const client = clientReturning('{"headline":"x","body":"y"}');
    const out = await generateSuggestion(deps(fs, client), {
      family: 'ai-suggestion-intimacy',
      signals: emptySignals,
      avoid: { texts: [], subjects: new Set(['act-1']) },
      intimacyOverlap: [{ key: 'act-1', label: 'A' }], // the only overlap act is avoided
    });
    expect(out).toBeNull();
  });

  it('returns null when the model declines / returns no usable JSON', async () => {
    const fs = memFileSystem();
    const out = await generateSuggestion(deps(fs, clientReturning('I cannot help with that.')), {
      family: 'ai-suggestion',
      signals: { ...emptySignals, observation: 'rest' },
      avoid: { texts: [], subjects: new Set() },
    });
    expect(out).toBeNull();
  });
});

describe('buildAvoidSet (67 §3.3/§3.6 — per-family)', () => {
  async function seed(
    fs: ReturnType<typeof memFileSystem>,
    suggestion: SentSuggestion,
    response: EmailResponse,
  ) {
    await recordSentSuggestion(fs, key, PERSON, suggestion);
    await writeEncryptedJson(
      fs,
      `people/${PERSON}/email/responses/${response.id}.enc`,
      response,
      key,
    );
  }

  const sentBase: Omit<SentSuggestion, 'id' | 'subjectKey'> = {
    schemaVersion: 1,
    family: 'ai-suggestion',
    suggestionType: 'something-to-try',
    text: 'try a walk',
    tokens: [],
    sentAt: '2026-08-25T00:00:00.000Z',
  };
  const respBase: Omit<EmailResponse, 'id' | 'answer' | 'suggestionId' | 'respondedAt'> = {
    schemaVersion: 1,
    family: 'ai-suggestion',
    kind: 'reaction',
    sensitivity: 'standard',
    source: 'relay-tap',
    edited: false,
  };

  it('avoids a not-for-me subject forever', async () => {
    const fs = memFileSystem();
    await seed(
      fs,
      { ...sentBase, id: 's1', subjectKey: 'goal-1' },
      {
        ...respBase,
        id: 'r1',
        suggestionId: 's1',
        answer: 'not-for-me',
        respondedAt: '2026-08-26T00:00:00.000Z',
      },
    );
    const avoid = await buildAvoidSet(fs, key, PERSON, 'ai-suggestion', now);
    expect(avoid.subjects.has('goal-1')).toBe(true);
    expect(avoid.texts).toContain('try a walk');
  });

  it('avoids a maybe-later subject only within the resurface window', async () => {
    const fs = memFileSystem();
    await seed(
      fs,
      { ...sentBase, id: 's2', subjectKey: 'goal-2' },
      {
        ...respBase,
        id: 'r2',
        suggestionId: 's2',
        answer: 'maybe-later',
        respondedAt: '2026-08-30T00:00:00.000Z',
      },
    );
    // 2 days ago → still resting.
    expect(
      (await buildAvoidSet(fs, key, PERSON, 'ai-suggestion', now)).subjects.has('goal-2'),
    ).toBe(true);
    // 5 weeks later → resurfaces.
    const later = new Date('2026-10-06T00:00:00.000Z');
    expect(
      (await buildAvoidSet(fs, key, PERSON, 'ai-suggestion', later)).subjects.has('goal-2'),
    ).toBe(false);
  });

  it('keeps the two families’ avoid-sets separate', async () => {
    const fs = memFileSystem();
    await seed(
      fs,
      { ...sentBase, id: 's3', subjectKey: 'act-9', family: 'ai-suggestion-intimacy' },
      {
        ...respBase,
        id: 'r3',
        family: 'ai-suggestion-intimacy',
        suggestionId: 's3',
        answer: 'not-for-me',
        respondedAt: '2026-08-26T00:00:00.000Z',
      },
    );
    // The non-intimacy family's avoid-set is unaffected by an intimacy "not for me".
    expect((await buildAvoidSet(fs, key, PERSON, 'ai-suggestion', now)).subjects.has('act-9')).toBe(
      false,
    );
    expect(
      (await buildAvoidSet(fs, key, PERSON, 'ai-suggestion-intimacy', now)).subjects.has('act-9'),
    ).toBe(true);
    expect(await listSentSuggestions(fs, key, PERSON, 'ai-suggestion-intimacy')).toHaveLength(1);
  });
});

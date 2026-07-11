import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { ClaudeClient, FileSystem } from '../host';
import type { Person, TogetherSession } from '../schemas';
import { savePerson, saveRelationship } from '../people';
import { parseSuggestMarker, stripSuggestMarker } from '../conversations/suggestMarker';
import { stripCoachMarkers } from '../conversations/guidedSteps';
import { createSession } from './togetherService';
import { runTogetherTurn } from './togetherChatService';
import { buildTogetherSystemPrompt } from './togetherPromptBuilder';
import { captureSuggestionFromMarker, listSuggestions } from './suggestionService';

const key = generateMasterKey();
const BEN = 'ben';
const ANGEL = 'angel';
const NOW = new Date('2026-07-11T12:00:00.000Z');

function person(id: string, displayName: string): Person {
  return {
    id,
    schemaVersion: 1,
    displayName,
    isSubject: true,
    tags: [],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}

async function seedPair(fs: FileSystem): Promise<TogetherSession> {
  await savePerson(fs, key, person(BEN, 'Ben'));
  await savePerson(fs, key, person(ANGEL, 'Angel'));
  await saveRelationship(fs, key, {
    id: 'rel',
    schemaVersion: 2,
    fromPersonId: BEN,
    toPersonId: ANGEL,
    type: 'partner',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  });
  return createSession(fs, key, { initiatorPersonId: BEN, participantIds: [BEN, ANGEL] }, NOW);
}

describe('the SUGGEST marker (§5.6)', () => {
  it('parses a valid guide suggestion and strips the token', () => {
    const text =
      'Here’s an idea. [[SELFOS:SUGGEST:{"kind":"guide","prompt":"Try Love Maps","guideId":"love-maps"}]]';
    const m = parseSuggestMarker(text);
    expect(m?.kind).toBe('guide');
    expect(m?.guideId).toBe('love-maps');
    expect(stripSuggestMarker(text)).toBe('Here’s an idea.');
    expect(stripCoachMarkers(text)).toBe('Here’s an idea.'); // wired into the shared strip
  });

  it('rejects a malformed / kind-less marker (tolerant-parse)', () => {
    expect(parseSuggestMarker('[[SELFOS:SUGGEST:{"prompt":"no kind"}]]')).toBeNull();
    expect(parseSuggestMarker('[[SELFOS:SUGGEST:not json]]')).toBeNull();
  });

  it('strips a mid-stream partial of the marker AND a partial of the prefix itself (no flash)', () => {
    expect(stripSuggestMarker('Here’s an idea. [[SELFOS:SUGGEST:{"kind":"gui')).toBe(
      'Here’s an idea.',
    );
    expect(stripSuggestMarker('Here’s an idea. [[SELFOS:SUGG')).toBe('Here’s an idea.');
  });
});

describe('captureSuggestionFromMarker (§5.6)', () => {
  it('keeps a valid non-adult guideId, drops an unknown one, and stores a questionnaire topic', async () => {
    const fs = memFileSystem();
    const session = await seedPair(fs);
    await captureSuggestionFromMarker(
      fs,
      key,
      session.id,
      { kind: 'guide', prompt: 'Try Love Maps', guideId: 'love-maps' },
      NOW,
    );
    await captureSuggestionFromMarker(
      fs,
      key,
      session.id,
      { kind: 'guide', prompt: 'A made-up exercise', guideId: 'nope-not-real' },
      new Date(NOW.getTime() + 1000),
    );
    await captureSuggestionFromMarker(
      fs,
      key,
      session.id,
      { kind: 'questionnaire', prompt: 'A check-in on chores', topic: 'household chores' },
      new Date(NOW.getTime() + 2000),
    );
    const list = await listSuggestions(fs, key, session.id);
    expect(list).toHaveLength(3);
    expect(list[0]?.guideId).toBe('love-maps'); // real, non-adult → kept
    expect(list[1]?.guideId).toBeUndefined(); // unknown guide → degrades to a plain prompt card
    expect(list[2]?.topic).toBe('household chores');
  });

  it('never carries a guideId for an ADULT catalog guide (§3.10 — kept behind the 18+/explicit gates)', async () => {
    const fs = memFileSystem();
    const session = await seedPair(fs);
    await captureSuggestionFromMarker(
      fs,
      key,
      session.id,
      { kind: 'guide', prompt: 'A desire exercise', guideId: 'sensate-focus' },
      NOW,
    );
    const list = await listSuggestions(fs, key, session.id);
    expect(list[0]?.guideId).toBeUndefined(); // an adult guide is never a startable suggestion card
  });
});

function markerClient(reply: string): ClaudeClient {
  return {
    send: () => Promise.resolve('ok'),
    stream: (_opts, onDelta) => {
      onDelta(reply);
      return Promise.resolve({
        text: reply,
        usage: { inputTokens: 10, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 },
      });
    },
  };
}

describe('the couples prompt + turn (§5.6)', () => {
  it('teaches the SUGGEST convention', async () => {
    const fs = memFileSystem();
    const session = await seedPair(fs);
    const prompt = await buildTogetherSystemPrompt(fs, key, session);
    expect(prompt).toContain('[[SELFOS:SUGGEST:');
  });

  it('a NON-aside reply captures the suggestion; an ASIDE captures nothing (§3.6)', async () => {
    const fs = memFileSystem();
    const session = await seedPair(fs);
    const reply =
      'Good idea. [[SELFOS:SUGGEST:{"kind":"guide","prompt":"Try Love Maps","guideId":"love-maps"}]]';
    await runTogetherTurn({
      fs,
      key,
      client: markerClient(reply),
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      session,
      authorPersonId: BEN,
      userText: 'Any ideas for us?',
      onDelta: () => {},
      now: NOW,
    });
    expect(await listSuggestions(fs, key, session.id)).toHaveLength(1);

    // An aside carrying the same marker mints NOTHING.
    await runTogetherTurn({
      fs,
      key,
      client: markerClient(reply),
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      session,
      authorPersonId: BEN,
      userText: 'private note',
      privateAside: true,
      onDelta: () => {},
      now: new Date(NOW.getTime() + 5000),
    });
    expect(await listSuggestions(fs, key, session.id)).toHaveLength(1); // unchanged
  });
});

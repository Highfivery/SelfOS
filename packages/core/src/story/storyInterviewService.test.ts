import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import type { ClaudeClient, ClaudeUsage } from '../host';
import { memFileSystem } from '../host/memFileSystem';
import { savePerson } from '../people';
import { listAssignments, getAssignmentSnapshot } from '../questionnaires/assignmentService';
import type { AiDeps } from '../questionnaires/generationService';
import type { Person } from '../schemas';
import { mintStoryCheckInFromTodo } from './storyInterviewService';

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

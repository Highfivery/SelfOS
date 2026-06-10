// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateMasterKey } from '@selfos/core/crypto';
import type { ClaudeClient, FileSystem } from '@selfos/core/host';
import { createNodeFileSystem } from '../host/nodeFileSystem';
import type { Person } from '../../shared/schemas';
import { savePerson } from '../people/peopleService';
import { setPersonBudget } from '../usage/budgetService';
import { recordUsage } from '../usage/usageStore';
import { getConversation, listConversations } from './conversationService';
import { runChatTurn } from './chatService';

const key = Buffer.from(generateMasterKey());
const now = new Date('2026-06-15T12:00:00.000Z');
let vault: string;
let fs: FileSystem;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'selfos-chat-'));
  fs = createNodeFileSystem(vault);
});
afterEach(async () => {
  await rm(vault, { recursive: true, force: true });
});

const fakeClient: ClaudeClient = {
  send: () => Promise.resolve('ok'),
  stream: (_options, onDelta) => {
    onDelta('I ');
    onDelta('hear you.');
    return Promise.resolve({
      text: 'I hear you.',
      usage: { inputTokens: 100, outputTokens: 10, cacheWriteTokens: 0, cacheReadTokens: 0 },
    });
  },
};

function person(id: string, name: string): Person {
  return {
    id,
    schemaVersion: 1,
    displayName: name,
    isSubject: true,
    tags: [],
    createdAt: 'now',
    updatedAt: 'now',
  };
}

async function base(): Promise<void> {
  await savePerson(fs, key, person('p1', 'Alex'));
}

describe('runChatTurn', () => {
  it('streams a reply, persists the transcript, and records usage', async () => {
    await base();
    const chunks: string[] = [];
    const result = await runChatTurn({
      fs,
      key,
      client: fakeClient,
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      personId: 'p1',
      conversationId: 'c1',
      userText: 'I had a hard day',
      onDelta: (t) => chunks.push(t),
      now,
    });

    expect(result.ok).toBe(true);
    expect(chunks.join('')).toBe('I hear you.');

    const conversation = await getConversation(fs, key, 'p1', 'c1');
    expect(conversation?.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(conversation?.messages[1]?.content).toBe('I hear you.');
    expect(conversation?.title).toBe('I had a hard day');

    if (result.ok) {
      expect(result.usage.type).toBe('chat');
      expect(result.usage.costUsd).toBeGreaterThan(0);
    }
  });

  it('refuses to start with no API key', async () => {
    await base();
    const result = await runChatTurn({
      fs,
      key,
      client: fakeClient,
      apiKey: null,
      model: 'claude-sonnet-4-6',
      personId: 'p1',
      conversationId: 'c1',
      userText: 'hi',
      onDelta: () => {},
      now,
    });
    expect(result).toMatchObject({ ok: false, reason: 'NO_KEY' });
  });

  it('blocks when the person is over budget, unless the owner overrides', async () => {
    await base();
    await setPersonBudget(fs, key, 'p1', { limitUsd: 0.01, period: 'month', warnRatio: 0.8 });
    await recordUsage(fs, key, {
      id: 'prior',
      schemaVersion: 1,
      type: 'chat',
      personId: 'p1',
      model: 'claude-sonnet-4-6',
      at: '2026-06-10T00:00:00.000Z',
      inputTokens: 0,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      costUsd: 0.02, // already over the $0.01 limit
    });

    const blocked = await runChatTurn({
      fs,
      key,
      client: fakeClient,
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      personId: 'p1',
      conversationId: 'c1',
      userText: 'hi',
      onDelta: () => {},
      now,
    });
    expect(blocked).toMatchObject({ ok: false, reason: 'BUDGET' });

    const overridden = await runChatTurn({
      fs,
      key,
      client: fakeClient,
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      personId: 'p1',
      conversationId: 'c1',
      userText: 'hi',
      onDelta: () => {},
      now,
      override: true,
    });
    expect(overridden.ok).toBe(true);
  });

  it('continues an existing conversation across turns', async () => {
    await base();
    const deps = {
      fs,
      key,
      client: fakeClient,
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      personId: 'p1',
      conversationId: 'c1',
      onDelta: () => {},
      now,
    };
    await runChatTurn({ ...deps, userText: 'first' });
    await runChatTurn({ ...deps, userText: 'second' });
    const conversation = await getConversation(fs, key, 'p1', 'c1');
    expect(conversation?.messages.length).toBe(4); // 2 user + 2 assistant
    expect((await listConversations(fs, key, 'p1')).length).toBe(1);
  });
});

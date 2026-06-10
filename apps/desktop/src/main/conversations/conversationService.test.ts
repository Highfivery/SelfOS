// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateMasterKey } from '@selfos/core/crypto';
import type { Conversation } from '../../shared/schemas';
import {
  deleteConversation,
  getConversation,
  listConversations,
  saveConversation,
} from './conversationService';

const key = Buffer.from(generateMasterKey());
let vault: string;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'selfos-conv-'));
});
afterEach(async () => {
  await rm(vault, { recursive: true, force: true });
});

function conversation(id: string, updatedAt: string): Conversation {
  return {
    id,
    schemaVersion: 1,
    personId: 'p1',
    title: id,
    createdAt: '2026-06-10T00:00:00.000Z',
    updatedAt,
    messages: [{ role: 'user', content: 'hello there friend', ts: updatedAt }],
  };
}

describe('conversationService', () => {
  it('saves, reads, lists (newest first), and deletes', async () => {
    await saveConversation(vault, key, conversation('c1', '2026-06-10T10:00:00.000Z'));
    await saveConversation(vault, key, conversation('c2', '2026-06-10T12:00:00.000Z'));
    expect((await listConversations(vault, key, 'p1')).map((c) => c.id)).toEqual(['c2', 'c1']);
    expect((await getConversation(vault, key, 'p1', 'c1'))?.title).toBe('c1');
    await deleteConversation(vault, 'p1', 'c1');
    expect(await getConversation(vault, key, 'p1', 'c1')).toBeNull();
  });

  it('stores transcripts encrypted at rest', async () => {
    await saveConversation(vault, key, conversation('c1', '2026-06-10T10:00:00.000Z'));
    const raw = await readFile(join(vault, 'people', 'p1', 'conversations', 'c1.enc'), 'utf8');
    expect(raw).toContain('aes-256-gcm');
    expect(raw).not.toContain('hello there friend');
  });
});

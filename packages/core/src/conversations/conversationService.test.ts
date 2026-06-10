import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { Conversation } from '../schemas';
import {
  deleteConversation,
  getConversation,
  listConversations,
  saveConversation,
} from './conversationService';

const key = generateMasterKey();

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
    const fs = memFileSystem();
    await saveConversation(fs, key, conversation('c1', '2026-06-10T10:00:00.000Z'));
    await saveConversation(fs, key, conversation('c2', '2026-06-10T12:00:00.000Z'));
    expect((await listConversations(fs, key, 'p1')).map((c) => c.id)).toEqual(['c2', 'c1']);
    expect((await getConversation(fs, key, 'p1', 'c1'))?.title).toBe('c1');
    await deleteConversation(fs, 'p1', 'c1');
    expect(await getConversation(fs, key, 'p1', 'c1')).toBeNull();
  });

  it('stores transcripts encrypted at rest', async () => {
    const fs = memFileSystem();
    await saveConversation(fs, key, conversation('c1', '2026-06-10T10:00:00.000Z'));
    const bytes = await fs.read('people/p1/conversations/c1.enc');
    const raw = bytes && new TextDecoder().decode(bytes);
    expect(raw).toContain('aes-256-gcm');
    expect(raw).not.toContain('hello there friend');
  });
});

import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { Conversation } from '../schemas';
import {
  conversationAttachmentsDir,
  deleteConversation,
  getConversation,
  getConversationAttachment,
  isConversationAttachmentPath,
  listConversations,
  saveConversation,
  storeConversationAttachment,
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

describe('conversation attachments (45)', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]); // PNG magic + junk

  it('isConversationAttachmentPath guards the attachment path shape', () => {
    expect(isConversationAttachmentPath('people/p1/conversations/c1/attachments/abc.enc')).toBe(
      true,
    );
    expect(isConversationAttachmentPath('people/p1/conversations/c1.enc')).toBe(false);
    expect(isConversationAttachmentPath('config/recovery.enc')).toBe(false);
    expect(isConversationAttachmentPath('people/p1/conversations/c1/attachments/../../x.enc')).toBe(
      false,
    );
  });

  it('storeConversationAttachment validates mime + size and returns a ref', async () => {
    const fs = memFileSystem();
    const ref = await storeConversationAttachment(fs, key, 'p1', 'c1', png, 'image/png', {
      width: 800,
      height: 600,
    });
    if ('ok' in ref) throw new Error('expected a ref');
    expect(ref.kind).toBe('image');
    expect(ref.mime).toBe('image/png');
    expect(ref.path).toBe(`${conversationAttachmentsDir('p1', 'c1')}/${ref.id}.enc`);
    expect(ref.width).toBe(800);
    expect(ref.bytes).toBe(png.length);

    // Stored encrypted at rest — the path holds an envelope, not raw PNG bytes.
    const onDisk = await fs.read(ref.path);
    const raw = onDisk && new TextDecoder().decode(onDisk);
    expect(raw).toContain('aes-256-gcm');

    // getConversationAttachment round-trips the bytes.
    expect(await getConversationAttachment(fs, key, ref.path)).toEqual(png);
  });

  it('refuses a traversal personId/conversationId so a write can’t escape the attachments tree', async () => {
    const fs = memFileSystem();
    const bad = await storeConversationAttachment(fs, key, 'p1', '../../config', png, 'image/png');
    expect(bad).toMatchObject({ ok: false, reason: 'UNSUPPORTED' });
    // Nothing was written outside the tree.
    expect(await fs.read('config/attachments/probe.enc')).toBeNull();
  });

  it('rejects an unsupported mime and an oversized image', async () => {
    const fs = memFileSystem();
    const bad = await storeConversationAttachment(fs, key, 'p1', 'c1', png, 'image/heic');
    expect(bad).toMatchObject({ ok: false, reason: 'UNSUPPORTED' });

    const huge = new Uint8Array(5 * 1024 * 1024 + 1);
    const big = await storeConversationAttachment(fs, key, 'p1', 'c1', huge, 'image/png');
    expect(big).toMatchObject({ ok: false, reason: 'TOO_LARGE' });
  });

  it('deleteConversation purges the attachments folder', async () => {
    const fs = memFileSystem();
    await saveConversation(fs, key, conversation('c1', '2026-06-10T10:00:00.000Z'));
    const ref = await storeConversationAttachment(fs, key, 'p1', 'c1', png, 'image/png');
    if ('ok' in ref) throw new Error('expected a ref');
    expect(await fs.read(ref.path)).not.toBeNull();

    await deleteConversation(fs, 'p1', 'c1');
    expect(await getConversation(fs, key, 'p1', 'c1')).toBeNull();
    expect(await fs.read(ref.path)).toBeNull(); // the attachment file is gone too
    expect(await fs.list(conversationAttachmentsDir('p1', 'c1'))).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import { listConversations } from '../conversations';
import type { TogetherMessage } from '../schemas';
import { openPrepConversation } from './prepService';
import {
  appendMessage,
  createSession,
  getTogetherAttachment,
  isTogetherAttachmentPath,
  messageOwningAttachment,
  storeTogetherAttachment,
} from './togetherService';

const key = generateMasterKey();
const NOW = new Date('2026-07-10T12:00:00.000Z');
const A = 'personA';
const B = 'personB';

// A minimal, valid 1×1 PNG (magic + IHDR); enough to satisfy the mime sniff + size bounds.
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89,
]);

describe('openPrepConversation (§3.7)', () => {
  it('creates a solo conversation carrying the togetherSessionId link + a static opener; is idempotent', async () => {
    const fs = memFileSystem();
    const conv = await openPrepConversation(fs, key, A, 's1', NOW);
    expect(conv.togetherSessionId).toBe('s1');
    expect(conv.personId).toBe(A);
    expect(conv.title).toBe('Prep');
    // A static seed — one assistant opener, no AI spend.
    expect(conv.messages).toHaveLength(1);
    expect(conv.messages[0]?.role).toBe('assistant');
    expect(conv.messages[0]?.content).toMatch(/private prep space/i);

    // Find-or-create: a second open returns the SAME conversation, not a duplicate.
    const again = await openPrepConversation(
      fs,
      key,
      A,
      's1',
      new Date('2026-07-11T00:00:00.000Z'),
    );
    expect(again.id).toBe(conv.id);
    expect(
      (await listConversations(fs, key, A)).filter((c) => c.togetherSessionId === 's1'),
    ).toHaveLength(1);
  });

  it("each person gets their OWN prep thread — invisible to the partner (it's a solo conversation)", async () => {
    const fs = memFileSystem();
    const mine = await openPrepConversation(fs, key, A, 's1', NOW);
    const theirs = await openPrepConversation(fs, key, B, 's1', NOW);
    expect(mine.id).not.toBe(theirs.id);
    // B's prep never appears in A's conversation list, and vice versa.
    expect((await listConversations(fs, key, A)).map((c) => c.id)).not.toContain(theirs.id);
    expect((await listConversations(fs, key, B)).map((c) => c.id)).not.toContain(mine.id);
  });
});

describe('Together attachments (§6.1)', () => {
  it('encrypts + stores an image under the session folder and reads it back', async () => {
    const fs = memFileSystem();
    const result = await storeTogetherAttachment(fs, key, 's1', PNG, 'image/png', {
      width: 1,
      height: 1,
    });
    if ('ok' in result) throw new Error('expected a stored ref');
    expect(result.kind).toBe('image');
    expect(result.mime).toBe('image/png');
    expect(isTogetherAttachmentPath(result.path)).toBe(true);
    // Stored ciphertext, not the raw PNG.
    const onDisk = await fs.read(result.path);
    expect(onDisk).not.toBeNull();
    const decrypted = await getTogetherAttachment(fs, key, result.path);
    expect(decrypted).toEqual(PNG);
  });

  it('rejects an unsupported mime and an over-size image', async () => {
    const fs = memFileSystem();
    const bad = await storeTogetherAttachment(fs, key, 's1', PNG, 'application/pdf');
    expect('ok' in bad && bad.reason).toBe('UNSUPPORTED');
    const huge = await storeTogetherAttachment(fs, key, 's1', new Uint8Array(0), 'image/png');
    expect('ok' in huge && huge.reason).toBe('TOO_LARGE');
  });

  it('confines reads to the Together attachment namespace (path guard)', () => {
    expect(isTogetherAttachmentPath('together/sessions/s1/attachments/abc.enc')).toBe(true);
    expect(isTogetherAttachmentPath('config/recovery.enc')).toBe(false);
    expect(isTogetherAttachmentPath('together/sessions/s1/messages/x.enc')).toBe(false);
    expect(isTogetherAttachmentPath('together/sessions/../secrets/x.enc')).toBe(false);
  });

  it('messageOwningAttachment resolves the message that references a path — the bridge aside-gate hook', async () => {
    const fs = memFileSystem();
    const session = await createSession(
      fs,
      key,
      { initiatorPersonId: A, participantIds: [A, B] },
      NOW,
    );
    const stored = await storeTogetherAttachment(fs, key, session.id, PNG, 'image/png');
    if ('ok' in stored) throw new Error('store failed');
    const asideMsg: TogetherMessage = {
      id: 'm1',
      schemaVersion: 1,
      authorPersonId: A,
      role: 'user',
      content: 'just for you',
      ts: NOW.toISOString(),
      privateAside: true,
      attachments: [stored],
    };
    await appendMessage(fs, key, session.id, asideMsg);

    const owner = await messageOwningAttachment(fs, key, session.id, stored.path);
    expect(owner?.id).toBe('m1');
    expect(owner?.privateAside).toBe(true);
    expect(owner?.authorPersonId).toBe(A);
    // An unknown path resolves to null.
    expect(
      await messageOwningAttachment(
        fs,
        key,
        session.id,
        'together/sessions/s1/attachments/none.enc',
      ),
    ).toBeNull();
  });
});

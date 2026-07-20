import { describe, expect, it } from 'vitest';
import { memFileSystem } from '../host/memFileSystem';
import type { ChatMessage } from '../schemas';
import { reapDroppedAttachments, regenerateIndexFor, truncateMessages } from './rewindService';

const msg = (
  role: 'user' | 'assistant',
  ts: string,
  patch: Partial<ChatMessage> = {},
): ChatMessage => ({
  role,
  content: `${role} at ${ts}`,
  ts,
  ...patch,
});

const TRANSCRIPT: ChatMessage[] = [
  msg('user', '1'),
  msg('assistant', '2'),
  msg('user', '3'),
  msg('assistant', '4'),
];

describe('truncateMessages (66 §3.3)', () => {
  it('drops the target and everything after it', () => {
    const result = truncateMessages(TRANSCRIPT, 2, { role: 'user', ts: '3' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.messages.map((m) => m.ts)).toEqual(['1', '2']);
    expect(result.dropped.map((m) => m.ts)).toEqual(['3', '4']);
  });

  it('refuses when the transcript moved under the caller', () => {
    // The real failure mode: a turn landed between render and click, so the index now points elsewhere.
    // Without this the rewind would silently delete the wrong span.
    const result = truncateMessages(TRANSCRIPT, 2, { role: 'user', ts: 'stale-timestamp' });
    expect(result).toEqual({ ok: false, reason: 'STALE' });
  });

  it('refuses a role mismatch at the same index', () => {
    expect(truncateMessages(TRANSCRIPT, 2, { role: 'assistant', ts: '3' })).toEqual({
      ok: false,
      reason: 'STALE',
    });
  });

  it('refuses an out-of-range or non-integer index', () => {
    const stamp = { role: 'user' as const, ts: '3' };
    expect(truncateMessages(TRANSCRIPT, 9, stamp)).toEqual({ ok: false, reason: 'INVALID' });
    expect(truncateMessages(TRANSCRIPT, -1, stamp)).toEqual({ ok: false, reason: 'INVALID' });
    expect(truncateMessages(TRANSCRIPT, 1.5, stamp)).toEqual({ ok: false, reason: 'INVALID' });
  });

  it('never mutates the input transcript', () => {
    truncateMessages(TRANSCRIPT, 1, { role: 'assistant', ts: '2' });
    expect(TRANSCRIPT).toHaveLength(4);
  });
});

describe('regenerateIndexFor (66 §3.3)', () => {
  it('drops an assistant reply so the transcript ends on the question that prompted it', () => {
    // Regenerating a reply should re-answer the SAME user message, not delete it.
    expect(regenerateIndexFor(TRANSCRIPT, 3)).toBe(3);
  });

  it('keeps a user message and drops the reply after it', () => {
    expect(regenerateIndexFor(TRANSCRIPT, 2)).toBe(3);
  });
});

describe('reapDroppedAttachments (66 §3.3)', () => {
  it('removes the encrypted blobs behind dropped messages, so a rewind never orphans bytes', async () => {
    const fs = memFileSystem();
    const path = 'people/p1/conversations/c1/attachments/a1.enc';
    await fs.writeAtomic(path, new Uint8Array([1, 2, 3]));

    await reapDroppedAttachments(
      fs,
      [msg('user', '3', { attachments: [{ id: 'a1', kind: 'image', path, mime: 'image/png' }] })],
      () => true,
    );

    expect(await fs.read(path)).toBeNull();
  });

  it('leaves anything outside our attachment paths alone', async () => {
    const fs = memFileSystem();
    const path = 'config/recovery.enc';
    await fs.writeAtomic(path, new Uint8Array([9]));

    await reapDroppedAttachments(
      fs,
      [msg('user', '3', { attachments: [{ id: 'a1', kind: 'image', path, mime: 'image/png' }] })],
      () => false, // the guard rejects it
    );

    expect(await fs.read(path)).not.toBeNull();
  });
});

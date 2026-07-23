import { describe, expect, it } from 'vitest';
import { saveConversation } from '../conversations/conversationService';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import { savePerson } from '../people';
import type { Conversation, Person, TogetherMessage } from '../schemas';
import { appendMessage, createSession } from '../together/togetherService';
import { createBook } from './storyService';
import { isQuotable, mineQuoteCandidates, setQuoteStatus } from './storyQuotes';

const key = generateMasterKey();
const now = new Date('2026-07-22T00:00:00.000Z');

const person: Person = {
  id: 'me',
  schemaVersion: 2,
  displayName: 'Ben',
  isSubject: true,
  tags: [],
  createdAt: 'now',
  updatedAt: 'now',
};

function conversation(
  id: string,
  lines: { role: 'user' | 'assistant'; content: string }[],
): Conversation {
  return {
    id,
    schemaVersion: 1,
    personId: 'me',
    title: id,
    messages: lines.map((l, i) => ({ role: l.role, content: l.content, ts: `2026-05-0${i + 1}` })),
    createdAt: 'now',
    updatedAt: 'now',
  };
}

async function seed(fs: ReturnType<typeof memFileSystem>): Promise<string> {
  await savePerson(fs, key, person);
  const book = await createBook(fs, key, {
    personId: 'me',
    type: 'biography',
    title: 'Book',
    config: { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true },
    now,
  });
  return book.id;
}

describe('quote mining (64 §17.4)', () => {
  describe('isQuotable', () => {
    it('accepts a readable-length first-person statement', () => {
      expect(isQuotable('I finally understood that I was allowed to want things.')).toBe(true);
    });
    it('recognizes a curly-apostrophe contraction as first person', () => {
      expect(isQuotable('I’m the kind of person who keeps every letter forever.')).toBe(true);
    });
    it('rejects a bare question, a too-short line, and a non-first-person line', () => {
      expect(isQuotable('What was I even doing back then?')).toBe(false); // question
      expect(isQuotable('I was tired.')).toBe(false); // < 6 words
      expect(isQuotable('The weather that whole summer was relentlessly grey and cold.')).toBe(
        false,
      ); // no first person
    });
  });

  it('mines the subject’s own session lines as pending candidates, deduped', async () => {
    const fs = memFileSystem();
    const bookId = await seed(fs);
    await saveConversation(
      fs,
      key,
      conversation('c1', [
        { role: 'user', content: 'I finally understood that I was allowed to want things.' },
        { role: 'assistant', content: 'That sounds like a real shift for you.' }, // coach — never mined
        { role: 'user', content: 'Tired.' }, // too short — skipped
      ]),
    );
    const first = await mineQuoteCandidates(fs, key, 'me', bookId, now);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ status: 'pending', source: 'session' });
    expect(first[0]!.text).toContain('allowed to want things');

    // A second run over the same material adds nothing (deduped).
    const second = await mineQuoteCandidates(fs, key, 'me', bookId, now);
    expect(second).toHaveLength(1);
  });

  it('does NOT mine a confidential Together prep thread (a solo conversation with a togetherSessionId)', async () => {
    const fs = memFileSystem();
    const bookId = await seed(fs);
    await saveConversation(fs, key, {
      ...conversation('prep', [
        { role: 'user', content: 'I am going to say the hardest thing I have ever tried to say.' },
      ]),
      togetherSessionId: 'ts1',
    });
    const mined = await mineQuoteCandidates(fs, key, 'me', bookId, now);
    expect(mined).toHaveLength(0); // prep is confidential scratch space — never mined
  });

  it('a rejected line is never re-surfaced by a later mining run', async () => {
    const fs = memFileSystem();
    const bookId = await seed(fs);
    await saveConversation(
      fs,
      key,
      conversation('c1', [
        { role: 'user', content: 'I have never told anyone this before, but I was afraid.' },
      ]),
    );
    const mined = await mineQuoteCandidates(fs, key, 'me', bookId, now);
    expect(mined).toHaveLength(1);
    await setQuoteStatus(fs, key, 'me', bookId, mined[0]!.id, 'rejected');

    const again = await mineQuoteCandidates(fs, key, 'me', bookId, now);
    // Still just the one (now rejected) — never re-proposed as a fresh pending candidate.
    expect(again).toHaveLength(1);
    expect(again[0]!.status).toBe('rejected');
  });

  it('Together: mines ONLY the subject’s own non-aside lines — a partner’s words never enter the queue', async () => {
    const fs = memFileSystem();
    const bookId = await seed(fs);
    await savePerson(fs, key, { ...person, id: 'partner', displayName: 'Angel' });
    const session = await createSession(
      fs,
      key,
      { initiatorPersonId: 'me', participantIds: ['me', 'partner'] },
      now,
    );
    let seq = 0;
    const line = (over: Partial<TogetherMessage>): TogetherMessage => ({
      id: `m${seq++}`,
      schemaVersion: 1,
      authorPersonId: 'me',
      role: 'user',
      content: 'placeholder',
      ts: '2026-06-01T00:00:00.000Z',
      ...over,
    });
    await appendMessage(
      fs,
      key,
      session.id,
      line({
        authorPersonId: 'me',
        content: 'I said something I had held in for years, and it felt like breathing.',
      }),
    );
    await appendMessage(
      fs,
      key,
      session.id,
      line({
        authorPersonId: 'partner',
        ts: '2026-06-02T00:00:00.000Z',
        content: 'The partner said a vivid line I definitely did not say myself.',
      }),
    );
    await appendMessage(
      fs,
      key,
      session.id,
      line({
        authorPersonId: 'me',
        ts: '2026-06-03T00:00:00.000Z',
        privateAside: true,
        content: 'A private aside I would never want quoted in a book at all.',
      }),
    );
    await appendMessage(
      fs,
      key,
      session.id,
      line({
        role: 'assistant',
        authorPersonId: 'me',
        ts: '2026-06-04T00:00:00.000Z',
        content: 'The coach reply which is also never mined as the person speaking.',
      }),
    );

    const mined = await mineQuoteCandidates(fs, key, 'me', bookId, now);
    const texts = mined.map((q) => q.text);
    expect(texts.some((t) => t.includes('felt like breathing'))).toBe(true); // the subject's own line
    expect(texts.some((t) => t.includes('partner said'))).toBe(false); // never the partner's
    expect(texts.some((t) => t.includes('private aside'))).toBe(false); // never an aside
    expect(texts.some((t) => t.includes('coach reply'))).toBe(false); // never the coach
    expect(mined.every((q) => q.source === 'together')).toBe(true);
  });

  it('approve/reject flips status; an unknown id is a no-op', async () => {
    const fs = memFileSystem();
    const bookId = await seed(fs);
    await saveConversation(
      fs,
      key,
      conversation('c1', [
        { role: 'user', content: 'I kept the letter for twenty years without ever reading it.' },
      ]),
    );
    const mined = await mineQuoteCandidates(fs, key, 'me', bookId, now);
    const approved = await setQuoteStatus(fs, key, 'me', bookId, mined[0]!.id, 'approved');
    expect(approved[0]!.status).toBe('approved');
    const noop = await setQuoteStatus(fs, key, 'me', bookId, 'nope', 'rejected');
    expect(noop[0]!.status).toBe('approved'); // unchanged
  });
});

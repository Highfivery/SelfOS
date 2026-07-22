import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import type { ClaudeClient, ClaudeUsage } from '../host';
import { memFileSystem } from '../host/memFileSystem';
import { saveInsight } from '../insights';
import { savePerson } from '../people';
import type { AiDeps } from '../questionnaires';
import type { Insight, Person } from '../schemas';
import { queryUsage } from '../usage';
import { createBook, getBook, updateBook } from './storyService';
import { regenerateEssence, suggestTitles } from './storyTitleService';

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

const insight: Insight = {
  id: 'i1',
  schemaVersion: 1,
  source: 'session',
  subjectPersonId: 'me',
  summary: 'He learned to speak up after years of quiet.',
  facts: [{ id: 'f1', text: 'Grew up in a loud house and went silent', shareable: false }],
  confidence: 'high',
  categories: [],
  approved: true,
  provenance: { at: '2026-05-01T00:00:00.000Z' },
  createdAt: 'now',
  updatedAt: 'now',
};

const USAGE: ClaudeUsage = {
  inputTokens: 300,
  outputTokens: 120,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
};

/** A client returning `text` once, then repeating — and counting how many times it was called. */
function countingClient(text: string): ClaudeClient & { calls: () => number } {
  let n = 0;
  return {
    calls: () => n,
    send: async () => {
      n += 1;
      return text;
    },
    stream: async () => {
      n += 1;
      return { text, usage: USAGE };
    },
  };
}

function deps(
  fs: ReturnType<typeof memFileSystem>,
  client: ClaudeClient,
  apiKey: string | null,
): AiDeps {
  return { fs, key, client, apiKey, model: 'claude-sonnet-4-6', personId: 'me', now };
}

async function seedBook(fs: ReturnType<typeof memFileSystem>): Promise<string> {
  await savePerson(fs, key, person);
  await saveInsight(fs, key, insight);
  const book = await createBook(fs, key, {
    personId: 'me',
    type: 'biography',
    title: 'The Story of Ben',
    config: { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true },
    now,
  });
  return book.id;
}

describe('the title workshop (64 §16.4)', () => {
  it('returns N distinct titles from ONE metered pass, dropping the current title', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    // The model echoes the current title + a dup + real alternatives; the service cleans all three up.
    const client = countingClient(
      JSON.stringify({
        titles: [
          { title: 'The Story of Ben' }, // the current title — dropped
          { title: 'The Weight of Quiet' },
          { title: 'the weight of quiet' }, // case-dup — dropped
          { title: 'Learning to Speak Up' },
          { title: '   ' }, // blank — dropped
        ],
      }),
    );
    const res = await suggestTitles(deps(fs, client, 'sk-test'), bookId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.titles).toEqual(['The Weight of Quiet', 'Learning to Speak Up']);
    expect(client.calls()).toBe(1); // ONE pass, not one per title

    // Metered under its own type, and metered even though we parsed after (meter-before-parse).
    const usage = await queryUsage(fs, key, {
      personId: 'me',
      from: '2000-01-01',
      to: '2100-01-01',
    });
    expect(usage.filter((u) => u.type === 'story.title')).toHaveLength(1);
  });

  it('a second call is a fresh pass — "suggest again" spends again', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    const client = countingClient(JSON.stringify({ titles: [{ title: 'A Fresh One' }] }));
    await suggestTitles(deps(fs, client, 'sk-test'), bookId);
    await suggestTitles(deps(fs, client, 'sk-test'), bookId);
    expect(client.calls()).toBe(2);
  });

  it('honest failures: no key, and an unparseable reply (never a silent empty)', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    const noKey = await suggestTitles(deps(fs, countingClient('{}'), null), bookId);
    expect(noKey).toMatchObject({ ok: false, reason: 'NO_KEY' });

    const garbled = await suggestTitles(
      deps(fs, countingClient('sorry, I cannot'), 'sk-test'),
      bookId,
    );
    expect(garbled.ok).toBe(false);
    // meter-before-parse: the garbled call still SPENT, so it's metered even though the parse failed.
    const spent = await queryUsage(fs, key, {
      personId: 'me',
      from: '2000-01-01',
      to: '2100-01-01',
    });
    expect(spent.filter((u) => u.type === 'story.title')).toHaveLength(1);

    // A reply that parses but yields no usable title is MALFORMED, not a crash.
    const empty = await suggestTitles(
      deps(fs, countingClient(JSON.stringify({ titles: [] })), 'sk-test'),
      bookId,
    );
    expect(empty).toMatchObject({ ok: false, reason: 'MALFORMED' });
  });

  it('regenerates JUST the essence, touching no chapters (§16.4)', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    await updateBook(fs, key, 'me', bookId, { essence: 'An old through-line.' }, now);

    const res = await regenerateEssence(
      deps(
        fs,
        countingClient(JSON.stringify({ essence: '  A quiet man finding his voice.  ' })),
        'sk-test',
      ),
      bookId,
    );
    expect(res).toMatchObject({ ok: true, essence: 'A quiet man finding his voice.' });
    // It returns the line but does NOT write it — the caller decides, so a metered pass never mutates
    // behind a failed save. The stored essence is unchanged until the caller commits it.
    const stored = await getBook(fs, key, 'me', bookId);
    expect(stored?.essence).toBe('An old through-line.');
    const usage = await queryUsage(fs, key, {
      personId: 'me',
      from: '2000-01-01',
      to: '2100-01-01',
    });
    expect(usage.filter((u) => u.type === 'story.essence')).toHaveLength(1);
  });
});

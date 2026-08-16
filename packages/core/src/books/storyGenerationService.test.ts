import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import type { ClaudeClient, ClaudeUsage } from '../host';
import { memFileSystem } from '../host/memFileSystem';
import { savePerson } from '../people';
import type { AiDeps } from '../questionnaires';
import { BookConfigSchema, type Person } from '../schemas';
import { BIOGRAPHY_BOOK_TYPE, getBookType } from './bookTypes';
import { generateFoundations } from './storyGenerationService';

const key = generateMasterKey();

const USAGE: ClaudeUsage = {
  inputTokens: 1000,
  outputTokens: 500,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
};

function fakeClient(text: string): ClaudeClient {
  return {
    send: async () => text,
    stream: async () => ({ text, usage: USAGE }),
  };
}

function subject(fs: ReturnType<typeof memFileSystem>): Promise<void> {
  const person: Person = {
    id: 'me',
    schemaVersion: 2,
    displayName: 'Ben',
    isSubject: true,
    tags: [],
    occupation: 'teacher',
    createdAt: 'now',
    updatedAt: 'now',
  };
  return savePerson(fs, key, person);
}

function deps(
  fs: ReturnType<typeof memFileSystem>,
  client: ClaudeClient,
  apiKey: string | null,
): AiDeps {
  return {
    fs,
    key,
    client,
    apiKey,
    model: 'claude-sonnet-4-6',
    personId: 'me',
    now: new Date('2026-07-15T00:00:00.000Z'),
  };
}

const VALID_JSON = JSON.stringify({
  title: '  The Weight of Quiet  ',
  essence: '  A quiet man learning to speak.  ',
  timeline: [
    { label: 'Born in Ohio', date: '1985' },
    { label: 'Moved to Denver', approx: 'mid-2010s' },
  ],
  outline: {
    parts: [
      {
        title: 'Roots',
        chapters: [
          {
            title: 'The Garage',
            brief: 'He learns a machine obeys.',
            eraFrom: '1994',
            lifeAreas: ['Family'],
          },
        ],
      },
    ],
  },
});

const opts = {
  bookId: 'book-1',
  bookType: BIOGRAPHY_BOOK_TYPE,
  config: BookConfigSchema.parse({}),
};

describe('generateFoundations (64 §5.3)', () => {
  it('parses a valid foundations reply into essence + outline + timeline, minting ids server-side', async () => {
    const fs = memFileSystem();
    await subject(fs);
    const res = await generateFoundations(deps(fs, fakeClient(VALID_JSON), 'sk-test'), opts);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.title).toBe('The Weight of Quiet'); // proposed title, trimmed
    expect(res.essence).toBe('A quiet man learning to speak.'); // trimmed
    expect(res.usage.type).toBe('story.outline'); // metered under the right type
    // Outline: one part, one chapter, ids minted here (unique, non-empty), order stamped.
    expect(res.outline.approved).toBe(false);
    expect(res.outline.parts).toHaveLength(1);
    const part = res.outline.parts[0]!;
    expect(part.title).toBe('Roots');
    expect(part.id.length).toBeGreaterThan(0);
    const chapter = part.chapters[0]!;
    expect(chapter.title).toBe('The Garage');
    expect(chapter.brief).toBe('He learns a machine obeys.');
    expect(chapter.eraFrom).toBe('1994');
    expect(chapter.lifeAreas).toEqual(['Family']);
    expect(chapter.order).toBe(0);
    expect(chapter.id.length).toBeGreaterThan(0);
    expect(chapter.id).not.toBe(part.id);
    // Timeline: minted ids, userEdited false.
    expect(res.timeline.events.map((e) => e.label)).toEqual(['Born in Ohio', 'Moved to Denver']);
    expect(res.timeline.events[0]!.date).toBe('1985');
    expect(res.timeline.events[1]!.approx).toBe('mid-2010s');
    expect(res.timeline.events.every((e) => e.id.length > 0 && e.userEdited === false)).toBe(true);
  });

  it('returns NO_KEY without calling the model when there is no API key', async () => {
    const fs = memFileSystem();
    await subject(fs);
    let called = false;
    const client: ClaudeClient = {
      send: async () => '',
      stream: async () => {
        called = true;
        return { text: '', usage: USAGE };
      },
    };
    const res = await generateFoundations(deps(fs, client, null), opts);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('NO_KEY');
    expect(called).toBe(false);
  });

  it('salvages a partly-malformed outline: a bad chapter drops, the good ones survive', async () => {
    const fs = memFileSystem();
    await subject(fs);
    const messy = JSON.stringify({
      essence: 'ok',
      timeline: [],
      outline: {
        parts: [
          {
            title: 'Roots',
            chapters: [
              123, // malformed → dropped
              { title: 'Kept Chapter', brief: 'a good one' },
              { brief: 'no title' }, // empty title → dropped by keep()
            ],
          },
        ],
      },
    });
    const res = await generateFoundations(deps(fs, fakeClient(messy), 'sk-test'), opts);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.title).toBe(''); // a reply with no title is tolerated (the caller keeps the current one)
    const titles = res.outline.parts.flatMap((p) => p.chapters.map((c) => c.title));
    expect(titles).toEqual(['Kept Chapter']);
  });

  it('rejects a valid-but-EMPTY reply as MALFORMED (never persists a blank book)', async () => {
    const fs = memFileSystem();
    await subject(fs);
    // Parseable JSON, but zero chapters — must be an honest failure, not a silent empty outline.
    const empty = JSON.stringify({ essence: '', timeline: [], outline: { parts: [] } });
    const res = await generateFoundations(deps(fs, fakeClient(empty), 'sk-test'), opts);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('MALFORMED');
  });

  it('reports MALFORMED on non-refusal prose with no JSON', async () => {
    const fs = memFileSystem();
    await subject(fs);
    const res = await generateFoundations(
      deps(fs, fakeClient('Here is your book plan:'), 'sk-test'),
      opts,
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('MALFORMED');
  });

  it('normalizes chapter lifeAreas against LIFE_AREAS, dropping invented areas', async () => {
    const fs = memFileSystem();
    await subject(fs);
    const withAreas = JSON.stringify({
      essence: 'ok',
      timeline: [],
      outline: {
        parts: [
          {
            title: 'Roots',
            chapters: [{ title: 'A Chapter', brief: 'b', lifeAreas: ['Family', 'Made Up Area'] }],
          },
        ],
      },
    });
    const res = await generateFoundations(deps(fs, fakeClient(withAreas), 'sk-test'), opts);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.outline.parts[0]!.chapters[0]!.lifeAreas).toEqual(['Family']); // invented area dropped
  });

  it('reports TRUNCATED honestly on an unclosed reply (never a silent empty outline)', async () => {
    const fs = memFileSystem();
    await subject(fs);
    const truncated =
      '{"essence":"a start","outline":{"parts":[{"title":"Roots","chapters":[{"title":"The';
    const res = await generateFoundations(deps(fs, fakeClient(truncated), 'sk-test'), opts);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('TRUNCATED');
  });

  it('reports REFUSED when the reply is a decline with no JSON', async () => {
    const fs = memFileSystem();
    await subject(fs);
    const res = await generateFoundations(
      deps(fs, fakeClient("I can't help with that request."), 'sk-test'),
      opts,
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('REFUSED');
  });

  it('tolerates markdown-fenced JSON (extractJsonObject strips the fence)', async () => {
    const fs = memFileSystem();
    await subject(fs);
    const fenced = '```json\n' + VALID_JSON + '\n```';
    const res = await generateFoundations(deps(fs, fakeClient(fenced), 'sk-test'), opts);
    expect(res.ok).toBe(true);
  });

  it('still runs on a thin corpus (a brand-new person with no data)', async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, {
      id: 'me',
      schemaVersion: 2,
      displayName: 'New',
      isSubject: true,
      tags: [],
      createdAt: 'now',
      updatedAt: 'now',
    });
    const res = await generateFoundations(deps(fs, fakeClient(VALID_JSON), 'sk-test'), opts);
    expect(res.ok).toBe(true);
  });
});

/**
 * 72 P6 — a `pages` spine states an EXACT count. Before this the count was a sentence in the prompt with
 * nothing behind it, so a 32-page picture book could come back 40 pages long and simply be 40 pages long.
 */
describe('a page-counted book gets the page count it commissioned', () => {
  const CHILDRENS = getBookType('childrens')!;
  /** A reply with `n` pages spread over two parts — so the cap has to run ACROSS parts, not within one. */
  const pagesReply = (n: number): string =>
    JSON.stringify({
      title: 'Mira and the Fox',
      essence: 'A small adventure.',
      timeline: [],
      outline: {
        parts: [
          {
            title: 'One',
            chapters: Array.from({ length: Math.ceil(n / 2) }, (_, i) => ({
              title: `Page ${i + 1}`,
              brief: 'b',
            })),
          },
          {
            title: 'Two',
            chapters: Array.from({ length: Math.floor(n / 2) }, (_, i) => ({
              title: `Page ${Math.ceil(n / 2) + i + 1}`,
              brief: 'b',
            })),
          },
        ],
      },
    });

  const countPages = (outline: { parts: { chapters: unknown[] }[] }): number =>
    outline.parts.reduce((n, p) => n + p.chapters.length, 0);

  it('caps an over-long reply at the commissioned count, across parts', async () => {
    const fs = memFileSystem();
    await subject(fs);
    const res = await generateFoundations(deps(fs, fakeClient(pagesReply(40)), 'sk-test'), {
      bookId: 'book-1',
      bookType: CHILDRENS,
      config: BookConfigSchema.parse({ typeOptions: { hero: 'p-mira' } }),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(countPages(res.outline)).toBe(32);
    // Order is re-stamped within each surviving part, so a truncated part is still coherent.
    for (const part of res.outline.parts) {
      expect(part.chapters.map((c) => c.order)).toEqual(part.chapters.map((_, i) => i));
    }
  });

  it('honours the commissioned page count, not just the type default', async () => {
    const fs = memFileSystem();
    await subject(fs);
    const res = await generateFoundations(deps(fs, fakeClient(pagesReply(40)), 'sk-test'), {
      bookId: 'book-1',
      bookType: CHILDRENS,
      config: BookConfigSchema.parse({ typeOptions: { hero: 'p-mira', length: '16' } }),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(countPages(res.outline)).toBe(16);
  });

  it('leaves a SHORT reply alone rather than padding it with empty shells', async () => {
    // Padding would recreate the §7.5 defect (unwritten shells that leave a book stuck mid-commission);
    // dropping pages the model wrote briefs for would be worse. Fewer real pages is the honest outcome.
    const fs = memFileSystem();
    await subject(fs);
    const res = await generateFoundations(deps(fs, fakeClient(pagesReply(12)), 'sk-test'), {
      bookId: 'book-1',
      bookType: CHILDRENS,
      config: BookConfigSchema.parse({ typeOptions: { hero: 'p-mira' } }),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(countPages(res.outline)).toBe(12);
  });

  it('never caps a chapter book — a long biography outline is untouched', async () => {
    const fs = memFileSystem();
    await subject(fs);
    const res = await generateFoundations(deps(fs, fakeClient(pagesReply(40)), 'sk-test'), opts);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(countPages(res.outline)).toBe(40);
  });
});

/**
 * `single` means ONE chapter (72 §3.2). Same reasoning as the page cap above: stated only in the prompt, the
 * count is a request with nothing behind it, and a model that returns a twelve-chapter outline would simply
 * produce a twelve-chapter book.
 */
describe('a one-chapter book gets one chapter', () => {
  const BIO = getBookType('biography')!;
  const manyChapters = JSON.stringify({
    title: 'After Hours',
    essence: 'One night.',
    timeline: [],
    outline: {
      parts: [
        {
          title: 'One',
          chapters: Array.from({ length: 6 }, (_, i) => ({ title: `Ch ${i + 1}`, brief: 'b' })),
        },
        {
          title: 'Two',
          chapters: Array.from({ length: 6 }, (_, i) => ({ title: `Ch ${7 + i}`, brief: 'b' })),
        },
      ],
    },
  });
  const count = (outline: { parts: { chapters: unknown[] }[] }): number =>
    outline.parts.reduce((n, p) => n + p.chapters.length, 0);

  it('caps a book-length reply at a single chapter', async () => {
    const fs = memFileSystem();
    await subject(fs);
    const res = await generateFoundations(deps(fs, fakeClient(manyChapters), 'sk-test'), {
      bookId: 'book-1',
      bookType: BIO,
      config: BookConfigSchema.parse({ length: 'single' }),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(count(res.outline)).toBe(1);
    // The now-empty second part is dropped, not left as a heading with nothing under it.
    expect(res.outline.parts).toHaveLength(1);
  });

  it('does not cap any other length', async () => {
    const fs = memFileSystem();
    await subject(fs);
    const res = await generateFoundations(deps(fs, fakeClient(manyChapters), 'sk-test'), {
      bookId: 'book-1',
      bookType: BIO,
      config: BookConfigSchema.parse({ length: 'concise' }),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(count(res.outline)).toBe(12);
  });
});

import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import { savePerson } from '../people';
import type { BookChapter, BookOutline, LifeTimeline, Person } from '../schemas';
import { listShelf } from './bookShelf';
import { applyFoundations, approveOutline, createBook, saveChapter } from './storyService';

/** The bookshelf read (72 §3.1). */

const key = generateMasterKey();
const now = new Date('2026-08-14T00:00:00.000Z');
const CHAPTERS = { one: 'chapter', many: 'chapters' } as const;
const unitFor = (): { one: string; many: string } => CHAPTERS;

const person: Person = {
  id: 'me',
  schemaVersion: 2,
  displayName: 'Ben',
  isSubject: true,
  tags: [],
  createdAt: 'now',
  updatedAt: 'now',
};
const timeline: LifeTimeline = { schemaVersion: 1, events: [] };

function outlineOf(chapterIds: string[]): BookOutline {
  return {
    schemaVersion: 1,
    approved: true,
    parts: [
      {
        id: 'p1',
        title: 'Roots',
        chapters: chapterIds.map((id, i) => ({
          id,
          title: `Chapter ${i + 1}`,
          brief: '',
          lifeAreas: [],
          order: i,
        })),
      },
    ],
  };
}

function chapter(id: string, markdown: string): BookChapter {
  return {
    id,
    schemaVersion: 1,
    partId: 'p1',
    order: 0,
    title: id,
    markdown,
    revision: 1,
    status: 'reviewed',
    sourceSignature: 'sig',
    provenance: [],
    protectedBlocks: [],
    pinnedQuotes: [],
    imagePlacements: [],
    lastGeneratedAt: now.toISOString(),
  };
}

async function seed(
  fs: ReturnType<typeof memFileSystem>,
  title: string,
  opts: { outline?: string[]; written?: [string, string][] } = {},
): Promise<string> {
  const book = await createBook(fs, key, {
    personId: 'me',
    type: 'biography',
    title,
    config: {
      voice: 'third',
      style: 'warm',
      length: 'standard',
      autoRefresh: true,
      typeOptions: {},
      sourceIds: [],
    },
    now,
  });
  if (opts.outline) {
    const outline = outlineOf(opts.outline);
    await applyFoundations(fs, key, 'me', book.id, { essence: 'A life.', outline, timeline }, now);
    await approveOutline(fs, key, 'me', book.id, outline, now);
  }
  for (const [id, markdown] of opts.written ?? []) {
    await saveChapter(fs, key, 'me', book.id, chapter(id, markdown));
  }
  return book.id;
}

describe('listShelf (72 §3.1)', () => {
  it('counts what is written against what the outline intends, and the words in it', async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person);
    await seed(fs, 'Still Running', {
      outline: ['c1', 'c2', 'c3'],
      written: [
        ['c1', 'The garage smelled of oil and cut pine.'],
        ['c2', 'He left at sixteen.'],
      ],
    });

    const [entry] = await listShelf(fs, key, 'me', unitFor);

    expect(entry).toMatchObject({
      title: 'Still Running',
      written: 2,
      total: 3,
      lifecycle: 'living',
    });
    expect(entry?.words).toBeGreaterThan(0);
    expect(entry?.unit).toEqual(CHAPTERS);
  });

  it('does not count an outline chapter with no prose as written — an empty shell is not a chapter', async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person);
    await seed(fs, 'Shells', {
      outline: ['c1', 'c2'],
      written: [
        ['c1', 'Real prose.'],
        ['c2', '   '],
      ],
    });

    const [entry] = await listShelf(fs, key, 'me', unitFor);

    expect(entry).toMatchObject({ written: 1, total: 2 });
  });

  it('a book with no outline yet reads as whole, not as 0 of 0', async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person);
    await seed(fs, 'Mid-commission', { written: [['c1', 'One written chapter.']] });

    const [entry] = await listShelf(fs, key, 'me', unitFor);

    // `total` falls back to what exists, so the card can't show a meaningless fraction while a book is
    // still being founded.
    expect(entry).toMatchObject({ written: 1, total: 1 });
  });

  it('lists every book — the shelf is the whole shelf, not the newest one', async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person);
    await seed(fs, 'First', { outline: ['c1'], written: [['c1', 'a']] });
    await seed(fs, 'Second', { outline: ['c1'], written: [['c1', 'b']] });

    const titles = (await listShelf(fs, key, 'me', unitFor)).map((b) => b.title);

    expect(titles.sort()).toEqual(['First', 'Second']);
  });

  it('takes the unit from the book type, so a future page-counted book needs no change here', async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person);
    await seed(fs, 'Pages', { outline: ['c1'], written: [['c1', 'a']] });

    const [entry] = await listShelf(fs, key, 'me', () => ({ one: 'page', many: 'pages' }));

    expect(entry?.unit).toEqual({ one: 'page', many: 'pages' });
  });
});

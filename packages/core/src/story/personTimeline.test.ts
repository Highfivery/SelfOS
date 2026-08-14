import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import { savePerson } from '../people';
import type { LifeTimeline, Person } from '../schemas';
import { getPersonTimeline, migrateBookTimeline, readBookTimeline } from './personTimeline';
import { addTimelineEvent, removeTimelineEvent } from './storyTimeline';
import { createBook, getTimeline, saveTimeline } from './storyService';

/** The person-level timeline (72 §3.8/§4.3). */

const key = generateMasterKey();
const now = new Date('2026-08-14T00:00:00.000Z');
const person: Person = {
  id: 'me',
  schemaVersion: 2,
  displayName: 'Ben',
  isSubject: true,
  tags: [],
  createdAt: 'now',
  updatedAt: 'now',
};

async function seedBook(fs: ReturnType<typeof memFileSystem>, title = 'A Life'): Promise<string> {
  await savePerson(fs, key, person);
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
  return book.id;
}

function timeline(events: LifeTimeline['events'], removed?: string[]): LifeTimeline {
  return { schemaVersion: 1, events, ...(removed ? { removed } : {}) };
}

describe('migrateBookTimeline (72 §4.3)', () => {
  it('moves a pre-72 book timeline onto the person, and the book keeps nothing', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    await saveTimeline(
      fs,
      key,
      'me',
      bookId,
      timeline([
        { id: 'e1', label: 'Born', date: '1985', userEdited: false },
        { id: 'e2', label: 'Left home', date: '2002', userEdited: true },
      ]),
    );

    await migrateBookTimeline(fs, key, 'me', bookId);

    expect((await getPersonTimeline(fs, key, 'me'))?.events.map((e) => e.label)).toEqual([
      'Born',
      'Left home',
    ]);
    // Every moment written before 72 is a life moment, so the book is left with none of its own.
    expect((await getTimeline(fs, key, 'me', bookId))?.events).toEqual([]);
  });

  it('is idempotent — running it again neither duplicates nor loses a moment', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    await saveTimeline(
      fs,
      key,
      'me',
      bookId,
      timeline([{ id: 'e1', label: 'Born', userEdited: false }]),
    );

    await migrateBookTimeline(fs, key, 'me', bookId);
    await migrateBookTimeline(fs, key, 'me', bookId);

    expect((await getPersonTimeline(fs, key, 'me'))?.events).toHaveLength(1);
  });

  it('a typed correction wins over a generated duplicate from another book', async () => {
    const fs = memFileSystem();
    const a = await seedBook(fs, 'Book A');
    const b = await seedBook(fs, 'Book B');
    // A generated moment reaches the person first…
    await saveTimeline(
      fs,
      key,
      'me',
      a,
      timeline([{ id: 'g', label: 'Left home', date: '2001', userEdited: false }]),
    );
    await migrateBookTimeline(fs, key, 'me', a);
    // …then the same moment, corrected by hand in another book.
    await saveTimeline(
      fs,
      key,
      'me',
      b,
      timeline([{ id: 'u', label: 'Left home', date: '2002', userEdited: true }]),
    );
    await migrateBookTimeline(fs, key, 'me', b);

    const events = (await getPersonTimeline(fs, key, 'me'))?.events ?? [];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ date: '2002', userEdited: true });
  });

  it('carries tombstones to the life — a moment deleted stays deleted in every book', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    // No events to move, only a tombstone: it still has to travel, or the deletion silently un-sticks.
    await saveTimeline(fs, key, 'me', bookId, timeline([], ['the divorce']));

    await migrateBookTimeline(fs, key, 'me', bookId);

    expect((await getPersonTimeline(fs, key, 'me'))?.removed).toContain('the divorce');
  });

  it('leaves a book’s OWN moments on the book', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    await saveTimeline(
      fs,
      key,
      'me',
      bookId,
      timeline([
        { id: 'life', label: 'Born', userEdited: true },
        { id: 'own', label: 'The dragon arrives', userEdited: true, bookScoped: true },
      ]),
    );

    await migrateBookTimeline(fs, key, 'me', bookId);

    expect((await getPersonTimeline(fs, key, 'me'))?.events.map((e) => e.label)).toEqual(['Born']);
    expect((await getTimeline(fs, key, 'me', bookId))?.events.map((e) => e.label)).toEqual([
      'The dragon arrives',
    ]);
  });
});

describe('readBookTimeline + scoped edits (72 §3.8)', () => {
  it('a life moment added in one book shows up in another; a book-scoped one does not', async () => {
    const fs = memFileSystem();
    const a = await seedBook(fs, 'Book A');
    const b = await seedBook(fs, 'Book B');

    await addTimelineEvent(fs, key, 'me', a, { label: 'Left home', date: '2002' });
    await addTimelineEvent(fs, key, 'me', a, {
      label: 'The dragon arrives',
      date: '2026',
      scope: 'book',
    });

    expect((await readBookTimeline(fs, key, 'me', a)).events.map((e) => e.label)).toEqual([
      'Left home',
      'The dragon arrives',
    ]);
    // The other book shares the life, not the one story's invention.
    expect((await readBookTimeline(fs, key, 'me', b)).events.map((e) => e.label)).toEqual([
      'Left home',
    ]);
  });

  it('removing a life moment removes it everywhere, and stays removed', async () => {
    const fs = memFileSystem();
    const a = await seedBook(fs, 'Book A');
    const b = await seedBook(fs, 'Book B');
    await addTimelineEvent(fs, key, 'me', a, { label: 'Left home', date: '2002' });
    const id = (await readBookTimeline(fs, key, 'me', a)).events[0]!.id;

    await removeTimelineEvent(fs, key, 'me', a, { eventId: id });

    expect((await readBookTimeline(fs, key, 'me', a)).events).toEqual([]);
    expect((await readBookTimeline(fs, key, 'me', b)).events).toEqual([]);
    expect((await readBookTimeline(fs, key, 'me', b)).removed).toContain('left home');
  });
});

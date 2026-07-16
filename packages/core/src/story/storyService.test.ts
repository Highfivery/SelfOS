import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import { BookConfigSchema, type BookOutline, type LifeTimeline } from '../schemas';
import {
  applyFoundations,
  approveOutline,
  createBook,
  deleteBook,
  getBook,
  getExclusions,
  getOutline,
  getTimeline,
  listBooks,
  readBookBundle,
  saveChapter,
  saveExclusions,
  updateBook,
} from './storyService';

const key = generateMasterKey();
const now = new Date('2026-07-15T00:00:00.000Z');
const config = BookConfigSchema.parse({});

function newBook(fs: ReturnType<typeof memFileSystem>, personId = 'me') {
  return createBook(fs, key, {
    personId,
    type: 'biography',
    title: 'The Story of Ben',
    config,
    now,
  });
}

const outline: BookOutline = {
  schemaVersion: 1,
  approved: false,
  parts: [
    {
      id: 'p1',
      title: 'Roots',
      chapters: [{ id: 'c1', title: 'The Garage', brief: 'b', lifeAreas: [], order: 0 }],
    },
  ],
};
const timeline: LifeTimeline = {
  schemaVersion: 1,
  events: [{ id: 'e1', label: 'Born', date: '1985', userEdited: false }],
};

describe('storyService — persistence (64 §5.7)', () => {
  it('creates, gets, and lists a book (status outlining, empty sharedWith)', async () => {
    const fs = memFileSystem();
    const book = await newBook(fs);
    expect(book.status).toBe('outlining');
    expect(book.sharedWith).toEqual([]);
    expect(book.title).toBe('The Story of Ben');
    expect(await getBook(fs, key, 'me', book.id)).toEqual(book);
    expect((await listBooks(fs, key, 'me')).map((b) => b.id)).toEqual([book.id]);
  });

  it("scopes books per person — one person never sees another's books", async () => {
    const fs = memFileSystem();
    await newBook(fs, 'me');
    expect(await listBooks(fs, key, 'other')).toEqual([]);
  });

  it('updates a patchable subset and bumps updatedAt', async () => {
    const fs = memFileSystem();
    const book = await newBook(fs);
    const later = new Date('2026-07-16T00:00:00.000Z');
    const updated = await updateBook(
      fs,
      key,
      'me',
      book.id,
      { title: 'Renamed', status: 'ready' },
      later,
    );
    expect(updated?.title).toBe('Renamed');
    expect(updated?.status).toBe('ready');
    expect(updated?.updatedAt).toBe(later.toISOString());
    expect(updated?.createdAt).toBe(book.createdAt); // createdAt preserved
  });

  it('applyFoundations persists essence + outline (unapproved) + timeline, keeping status outlining', async () => {
    const fs = memFileSystem();
    const book = await newBook(fs);
    const manifest = await applyFoundations(
      fs,
      key,
      'me',
      book.id,
      { essence: 'A quiet man.', outline, timeline },
      now,
    );
    expect(manifest?.essence).toBe('A quiet man.');
    expect(manifest?.status).toBe('outlining'); // not yet drafting — awaits approval
    expect((await getOutline(fs, key, 'me', book.id))?.approved).toBe(false);
    expect((await getTimeline(fs, key, 'me', book.id))?.events[0]?.label).toBe('Born');
  });

  it('createBook marks a blank title auto (placeholder) and a supplied title the person’s own (§3.2)', async () => {
    const fs = memFileSystem();
    const auto = await createBook(fs, key, {
      personId: 'me',
      type: 'biography',
      title: '   ',
      config,
      now,
    });
    expect(auto.title).toBe('Your Story');
    expect(auto.titleAuto).toBe(true);

    const chosen = await newBook(fs); // 'The Story of Ben'
    expect(chosen.titleAuto).toBeUndefined();
  });

  it('applyFoundations names an auto-titled book from the content, but never overwrites a chosen title (§3.2)', async () => {
    const fs = memFileSystem();
    // Auto-titled → the proposed title is applied (auto flag stays set until the person edits it).
    const autoBook = await createBook(fs, key, {
      personId: 'me',
      type: 'biography',
      title: '',
      config,
      now,
    });
    const named = await applyFoundations(
      fs,
      key,
      'me',
      autoBook.id,
      { title: '  The Weight of Quiet  ', essence: 'e', outline, timeline },
      now,
    );
    expect(named?.title).toBe('The Weight of Quiet'); // trimmed, applied
    expect(named?.titleAuto).toBe(true);

    // Person-chosen title → the proposed title is ignored.
    const chosenBook = await newBook(fs); // 'The Story of Ben', not auto
    const kept = await applyFoundations(
      fs,
      key,
      'me',
      chosenBook.id,
      { title: 'A Different Title', essence: 'e', outline, timeline },
      now,
    );
    expect(kept?.title).toBe('The Story of Ben');
  });

  it('approveOutline marks the outline approved and moves the book to drafting', async () => {
    const fs = memFileSystem();
    const book = await newBook(fs);
    await applyFoundations(fs, key, 'me', book.id, { essence: 'e', outline, timeline }, now);
    // The person may edit the outline during review; approve the edited copy.
    const edited: BookOutline = {
      ...outline,
      parts: [{ ...outline.parts[0]!, title: 'Beginnings' }],
    };
    const manifest = await approveOutline(fs, key, 'me', book.id, edited, now);
    expect(manifest?.status).toBe('drafting');
    const saved = await getOutline(fs, key, 'me', book.id);
    expect(saved?.approved).toBe(true);
    expect(saved?.parts[0]?.title).toBe('Beginnings'); // the edit was persisted
  });

  it('readBookBundle returns manifest + outline + timeline + chapters in one read', async () => {
    const fs = memFileSystem();
    const book = await newBook(fs);
    await applyFoundations(fs, key, 'me', book.id, { essence: 'e', outline, timeline }, now);
    await saveChapter(fs, key, 'me', book.id, {
      id: 'c1',
      schemaVersion: 1,
      partId: 'p1',
      order: 0,
      title: 'The Garage',
      markdown: 'Once...',
      revision: 1,
      status: 'new',
      sourceSignature: '',
      provenance: [],
      protectedBlocks: [],
      pinnedQuotes: [],
      imagePlacements: [],
    });
    const bundle = await readBookBundle(fs, key, 'me', book.id);
    expect(bundle?.manifest.id).toBe(book.id);
    expect(bundle?.outline?.parts).toHaveLength(1);
    expect(bundle?.timeline?.events).toHaveLength(1);
    expect(bundle?.chapters.map((c) => c.title)).toEqual(['The Garage']);
  });

  it('exclusions round-trip (default empty)', async () => {
    const fs = memFileSystem();
    const book = await newBook(fs);
    expect(await getExclusions(fs, key, 'me', book.id)).toEqual([]);
    await saveExclusions(fs, key, 'me', book.id, [
      { id: 'x1', kind: 'topic', value: 'the divorce', createdAt: now.toISOString() },
    ]);
    const items = await getExclusions(fs, key, 'me', book.id);
    expect(items).toHaveLength(1);
    expect(items[0]?.value).toBe('the divorce');
  });

  it('deleteBook removes the whole book (manifest + outline gone)', async () => {
    const fs = memFileSystem();
    const book = await newBook(fs);
    await applyFoundations(fs, key, 'me', book.id, { essence: 'e', outline, timeline }, now);
    await deleteBook(fs, 'me', book.id);
    expect(await getBook(fs, key, 'me', book.id)).toBeNull();
    expect(await getOutline(fs, key, 'me', book.id)).toBeNull();
    expect(await listBooks(fs, key, 'me')).toEqual([]);
  });

  it('returns null when updating/approving a missing book (never crashes)', async () => {
    const fs = memFileSystem();
    expect(await updateBook(fs, key, 'me', 'nope', { title: 'x' }, now)).toBeNull();
    expect(await approveOutline(fs, key, 'me', 'nope', outline, now)).toBeNull();
    expect(await readBookBundle(fs, key, 'me', 'nope')).toBeNull();
  });
});

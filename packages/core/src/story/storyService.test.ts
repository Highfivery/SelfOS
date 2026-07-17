import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import { BookConfigSchema, type BookOutline, type LifeTimeline } from '../schemas';
import {
  addUploadedPhoto,
  applyFoundations,
  approveOutline,
  createBook,
  deleteBook,
  getBook,
  getExclusions,
  getOutline,
  getInterviewState,
  getPublishedManifest,
  getStoryImageIndex,
  getTimeline,
  getTodos,
  listBooks,
  listChapters,
  readBookBundle,
  rewriteBookFromScratch,
  saveChapter,
  saveExclusions,
  saveInterviewState,
  savePublishedManifest,
  saveStoryImageBytes,
  saveStoryImageIndex,
  saveTodos,
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

  it('rewriteBookFromScratch resets the draft but keeps the person’s investments (§13.6.6)', async () => {
    const fs = memFileSystem();
    const book = await newBook(fs); // title supplied → not auto
    // Draft it: essence + outline + timeline + a chapter, plus matter/cover, exclusions, an uploaded photo,
    // and an AI-generated illustration.
    await applyFoundations(
      fs,
      key,
      'me',
      book.id,
      { essence: 'a quiet man', outline, timeline },
      now,
    );
    await saveChapter(fs, key, 'me', book.id, {
      id: 'c1',
      schemaVersion: 1,
      partId: 'p1',
      order: 0,
      title: 'The Garage',
      markdown: 'Once...',
      revision: 1,
      status: 'reviewed',
      sourceSignature: '',
      provenance: [],
      protectedBlocks: [{ anchor: { paragraphId: 'p0' }, text: 'my own words' }],
      pinnedQuotes: [],
      imagePlacements: [{ imageId: 'ill1', afterAnchor: 'p0', caption: '' }],
    });
    await saveExclusions(fs, key, 'me', book.id, [
      { id: 'x1', kind: 'topic', value: 'the lake house', createdAt: now.toISOString() },
    ]);
    // A denormalized to-do roll-up (keyed by chapterId) + interview state + a published head.
    await saveTodos(fs, key, 'me', book.id, {
      schemaVersion: 1,
      todos: [
        {
          id: 'td1',
          chapterId: 'c1',
          kind: 'remind',
          text: 'upload the shop photo',
          status: 'open',
          createdAt: now.toISOString(),
        },
      ],
    });
    await saveInterviewState(fs, key, 'me', book.id, {
      schemaVersion: 1,
      askedPrompts: ['what did the garage smell like?'],
      frameworkCoverage: {
        chapters: true,
        scenes: {},
        challenges: false,
        ideology: false,
        futureScript: false,
      },
      photoAnswers: [
        { imageId: 'ph1', question: 'who took it?', answer: 'my father', at: now.toISOString() },
      ],
    });
    await savePublishedManifest(fs, key, 'me', book.id, {
      schemaVersion: 1,
      publishedAt: now.toISOString(),
      title: 'The Story of Ben',
      parts: [],
      chapterOrder: [],
      images: [],
    });
    await updateBook(
      fs,
      key,
      'me',
      book.id,
      { matter: { dedication: 'For Angel' }, coverImageId: 'cov1' },
      now,
    );
    const photo = await addUploadedPhoto(
      fs,
      key,
      'me',
      book.id,
      { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' },
      now,
    );
    // A cover + a generated illustration in the index (+ their bytes).
    await saveStoryImageBytes(fs, key, 'me', book.id, 'cov1', new Uint8Array([9]));
    await saveStoryImageBytes(fs, key, 'me', book.id, 'ill1', new Uint8Array([8]));
    const idx = await getStoryImageIndex(fs, key, 'me', book.id);
    await saveStoryImageIndex(fs, key, 'me', book.id, {
      ...idx,
      images: [
        ...idx.images,
        { id: 'cov1', kind: 'cover', mime: 'image/png', createdAt: now.toISOString() },
        { id: 'ill1', kind: 'generated', mime: 'image/png', createdAt: now.toISOString() },
      ],
    });

    const later = new Date('2026-08-01T00:00:00.000Z');
    const reset = await rewriteBookFromScratch(fs, key, 'me', book.id, later);

    // DISCARDS: chapters, outline, timeline, essence; status back to outlining.
    expect(reset?.status).toBe('outlining');
    expect(reset?.essence).toBeUndefined();
    expect(await listChapters(fs, key, 'me', book.id)).toEqual([]);
    expect(await getOutline(fs, key, 'me', book.id)).toBeNull();
    expect(await getTimeline(fs, key, 'me', book.id)).toBeNull();
    // KEEPS: title, config, matter, cover pointer.
    expect(reset?.title).toBe('The Story of Ben');
    expect(reset?.config.style).toBe(config.style);
    expect(reset?.matter?.dedication).toBe('For Angel');
    expect(reset?.coverImageId).toBe('cov1');
    // KEEPS: exclusions + the uploaded photo; DISCARDS the generated illustration (cover survives).
    const excl = await getExclusions(fs, key, 'me', book.id);
    expect(excl.map((e) => e.value)).toEqual(['the lake house']);
    const images = (await getStoryImageIndex(fs, key, 'me', book.id)).images;
    const kinds = images.map((i) => `${i.kind}:${i.id}`).sort();
    expect(kinds).toContain('cover:cov1');
    expect(kinds).toContain(`uploaded:${photo.id}`);
    expect(kinds).not.toContain('generated:ill1');
    // DISCARDS the denormalized to-do roll-up (else phantom "Needs you" to-dos point at deleted chapters).
    expect((await getTodos(fs, key, 'me', book.id)).todos).toEqual([]);
    // KEEPS: the interview state (asked prompts + photo answers) and the published head (readers keep it).
    const interview = await getInterviewState(fs, key, 'me', book.id);
    expect(interview?.askedPrompts).toEqual(['what did the garage smell like?']);
    expect(interview?.photoAnswers).toHaveLength(1);
    expect((await getPublishedManifest(fs, key, 'me', book.id))?.title).toBe('The Story of Ben');
  });

  it('rewriteBookFromScratch returns null for a missing book (never crashes)', async () => {
    const fs = memFileSystem();
    expect(await rewriteBookFromScratch(fs, key, 'me', 'nope', now)).toBeNull();
  });
});

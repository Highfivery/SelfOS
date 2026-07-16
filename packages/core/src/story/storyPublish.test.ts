import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import type { ClaudeClient, ClaudeUsage } from '../host';
import { memFileSystem } from '../host/memFileSystem';
import { saveInsight } from '../insights';
import { savePerson } from '../people';
import type { AiDeps } from '../questionnaires';
import type { BookChapter, BookOutline, Insight, LifeTimeline, Person } from '../schemas';
import { generateChapter } from './storyGenerationService';
import {
  bookMentionsReader,
  grantReader,
  listSharedBooks,
  noteOnBook,
  publishBook,
  readSharedBook,
  readSharedImage,
  revokeReader,
} from './storyPublish';
import { setImagePlacement } from './storyPlacementService';
import {
  bookToHtml,
  bookToMarkdown,
  buildPublishedHtml,
  buildPublishedMarkdown,
  exportFileStem,
} from './storyExport';
import type { PublishedManifest } from '../schemas';
import {
  addUploadedPhoto,
  applyFoundations,
  approveOutline,
  createBook,
  getBook,
  getChapter,
  getPublishedImageBytes,
  saveChapter,
} from './storyService';

const key = generateMasterKey();
const now = new Date('2026-07-16T00:00:00.000Z');
const USAGE: ClaudeUsage = {
  inputTokens: 1,
  outputTokens: 1,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
};
const fakeClient = (text: string): ClaudeClient => ({
  send: async () => text,
  stream: async () => ({ text, usage: USAGE }),
});
const deps = (fs: ReturnType<typeof memFileSystem>): AiDeps => ({
  fs,
  key,
  client: fakeClient('The garage. [[SRC:s0]]'),
  apiKey: 'sk',
  model: 'claude-sonnet-4-6',
  personId: 'author',
  now,
});
const person = (id: string, displayName: string): Person => ({
  id,
  schemaVersion: 2,
  displayName,
  isSubject: true,
  tags: [],
  createdAt: 'now',
  updatedAt: 'now',
});
const insight: Insight = {
  id: 'i1',
  schemaVersion: 1,
  source: 'session',
  subjectPersonId: 'author',
  summary: 'A winter.',
  facts: [{ id: 'f1', text: 'the winter was cold', shareable: false }],
  confidence: 'medium',
  categories: [],
  approved: true,
  provenance: { at: '2026-05-01T00:00:00.000Z' },
  createdAt: 'now',
  updatedAt: 'now',
};
const outline: BookOutline = {
  schemaVersion: 1,
  approved: true,
  parts: [
    {
      id: 'p1',
      title: 'Roots',
      chapters: [
        { id: 'c1', title: 'The Garage', brief: 'A machine obeys.', lifeAreas: [], order: 0 },
        { id: 'c2', title: 'The Road', brief: 'Leaving home.', lifeAreas: [], order: 1 },
      ],
    },
  ],
};
const timeline: LifeTimeline = { schemaVersion: 1, events: [] };

/** Seed an author with a two-chapter book; c1 is written + Reviewed, c2 is written but NOT reviewed. */
async function seedBook(fs: ReturnType<typeof memFileSystem>): Promise<string> {
  await savePerson(fs, key, person('author', 'Ben'));
  await savePerson(fs, key, person('reader', 'Angel'));
  await saveInsight(fs, key, insight);
  const book = await createBook(fs, key, {
    personId: 'author',
    type: 'biography',
    title: 'The Story of Ben',
    config: { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true },
    now,
  });
  await applyFoundations(
    fs,
    key,
    'author',
    book.id,
    { essence: 'A quiet man.', outline, timeline },
    now,
  );
  await approveOutline(fs, key, 'author', book.id, outline, now);
  await generateChapter(deps(fs), { bookId: book.id, chapterId: 'c1' });
  await generateChapter(deps(fs), { bookId: book.id, chapterId: 'c2' });
  // Mark only c1 Reviewed.
  const c1 = await getChapter(fs, key, 'author', book.id, 'c1');
  await saveChapter(fs, key, 'author', book.id, { ...c1!, status: 'reviewed' });
  return book.id;
}

describe('publishBook (64 §3.5)', () => {
  it('refuses to publish when nothing is Reviewed yet (the review gate)', async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person('author', 'Ben'));
    await saveInsight(fs, key, insight);
    const book = await createBook(fs, key, {
      personId: 'author',
      type: 'biography',
      title: 'x',
      config: { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true },
      now,
    });
    await applyFoundations(fs, key, 'author', book.id, { essence: 'x', outline, timeline }, now);
    await approveOutline(fs, key, 'author', book.id, outline, now);
    await generateChapter(deps(fs), { bookId: book.id, chapterId: 'c1' }); // status 'new', not reviewed
    const res = await publishBook(fs, key, 'author', book.id, now);
    expect(res.ok).toBe(false);
  });

  it('snapshots ONLY Reviewed chapters; a later draft edit does not leak into the published head', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    const res = await publishBook(fs, key, 'author', bookId, now);
    expect(res).toMatchObject({ ok: true, publishedChapters: 1 });
    // The draft manifest is stamped published.
    expect((await getBook(fs, key, 'author', bookId))?.publishedAt).toBeTruthy();

    // Grant the reader, then read the published head: exactly the one Reviewed chapter (c2 is excluded).
    await grantReader(fs, key, 'author', bookId, 'reader', now);
    const view = await readSharedBook(fs, key, 'reader', 'author', bookId);
    expect(view?.chapters.map((c) => c.id)).toEqual(['c1']);
    const originalProse = view!.chapters[0]!.markdown;
    expect(view?.manifest.title).toBe('The Story of Ben');
    expect(view?.manifest.noteOnBook).toContain('never invented');
    // The reader gets the MINIMAL shape only — `imagePlacements` is safe to project (imageId/anchor/caption,
    // no private provenance), but the author's per-paragraph source provenance must NEVER cross.
    expect(Object.keys(view!.chapters[0]!).sort()).toEqual([
      'id',
      'imagePlacements',
      'markdown',
      'title',
    ]);
    expect('provenance' in view!.chapters[0]!).toBe(false);

    // Edit the DRAFT c1 after publishing — the reader's head is unchanged (snapshot isolation).
    const c1 = await getChapter(fs, key, 'author', bookId, 'c1');
    await saveChapter(fs, key, 'author', bookId, { ...c1!, markdown: 'Rewritten draft prose.' });
    const after = await readSharedBook(fs, key, 'reader', 'author', bookId);
    expect(after?.chapters[0]?.markdown).toBe(originalProse);
  });

  it('re-publishing prunes a chapter that is no longer Reviewed', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    // Review c2 too → publish → head has both.
    const c2 = await getChapter(fs, key, 'author', bookId, 'c2');
    await saveChapter(fs, key, 'author', bookId, { ...c2!, status: 'reviewed' });
    await publishBook(fs, key, 'author', bookId, now);
    await grantReader(fs, key, 'author', bookId, 'reader', now);
    expect((await readSharedBook(fs, key, 'reader', 'author', bookId))?.chapters).toHaveLength(2);
    // Un-review c2 (e.g. it drifted) → re-publish → the head drops it.
    const c2b = await getChapter(fs, key, 'author', bookId, 'c2');
    await saveChapter(fs, key, 'author', bookId, { ...c2b!, status: 'stale' });
    await publishBook(fs, key, 'author', bookId, now);
    expect(
      (await readSharedBook(fs, key, 'reader', 'author', bookId))?.chapters.map((c) => c.id),
    ).toEqual(['c1']);
  });
});

describe('readers + the read-time re-gate (64 §3.5)', () => {
  it('grants/revokes readers; refuses the author + a non-household id', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    // Refuse granting the author themselves + a phantom person.
    expect(await grantReader(fs, key, 'author', bookId, 'author', now)).toEqual([]);
    expect(await grantReader(fs, key, 'author', bookId, 'ghost', now)).toEqual([]);
    // Grant a real household reader.
    const readers = await grantReader(fs, key, 'author', bookId, 'reader', now);
    expect(readers).toEqual([{ personId: 'reader', displayName: 'Angel' }]);
    // Idempotent.
    expect(await grantReader(fs, key, 'author', bookId, 'reader', now)).toHaveLength(1);
    // Revoke.
    expect(await revokeReader(fs, key, 'author', bookId, 'reader', now)).toEqual([]);
  });

  it('a shared book is readable only while published AND still granted (re-gate on every read)', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    // Published but not yet granted → the reader sees nothing.
    await publishBook(fs, key, 'author', bookId, now);
    expect(await listSharedBooks(fs, key, 'reader')).toEqual([]);
    expect(await readSharedBook(fs, key, 'reader', 'author', bookId)).toBeNull();
    // Granted → it appears + reads.
    await grantReader(fs, key, 'author', bookId, 'reader', now);
    const shared = await listSharedBooks(fs, key, 'reader');
    expect(shared).toHaveLength(1);
    expect(shared[0]).toMatchObject({
      authorName: 'Ben',
      title: 'The Story of Ben',
      chapterCount: 1,
    });
    expect(await readSharedBook(fs, key, 'reader', 'author', bookId)).not.toBeNull();
    // Revoke → access ends at the next read (no stale access).
    await revokeReader(fs, key, 'author', bookId, 'reader', now);
    expect(await listSharedBooks(fs, key, 'reader')).toEqual([]);
    expect(await readSharedBook(fs, key, 'reader', 'author', bookId)).toBeNull();
  });

  it('an unpublished book never appears to a granted reader', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    // Grant BEFORE publishing → still nothing to read (no published head).
    await grantReader(fs, key, 'author', bookId, 'reader', now);
    expect(await listSharedBooks(fs, key, 'reader')).toEqual([]);
    expect(await readSharedBook(fs, key, 'reader', 'author', bookId)).toBeNull();
  });

  it('read-progress derives neverOpened + updated cues from the viewer’s last-read (§3.6)', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    await publishBook(fs, key, 'author', bookId, now); // publishedAt = now
    await grantReader(fs, key, 'author', bookId, 'reader', now);

    // No read progress → never opened → both cues true (drives the first-share notification + the marker).
    const fresh = (await listSharedBooks(fs, key, 'reader'))[0]!;
    expect(fresh.neverOpened).toBe(true);
    expect(fresh.updated).toBe(true);

    // Opened AFTER the publish → not new, not updated (the notification + marker clear).
    const afterPublish = new Date(now.getTime() + 1000).toISOString();
    const read = (await listSharedBooks(fs, key, 'reader', { [bookId]: afterPublish }))[0]!;
    expect(read.neverOpened).toBe(false);
    expect(read.updated).toBe(false);

    // Opened BEFORE the publish (a stale read) → opened, but updated (re-published since) → the quiet marker
    // shows, without ever re-notifying (the notification gates on neverOpened only).
    const beforePublish = new Date(now.getTime() - 1000).toISOString();
    const stale = (await listSharedBooks(fs, key, 'reader', { [bookId]: beforePublish }))[0]!;
    expect(stale.neverOpened).toBe(false);
    expect(stale.updated).toBe(true);
  });
});

describe('honesty note + featured-reader scan', () => {
  it('the note is built from what the chapters actually drew on', () => {
    const chapters: BookChapter[] = [
      {
        id: 'c1',
        schemaVersion: 1,
        partId: 'p1',
        order: 0,
        title: 't',
        markdown: 'Angel was there.',
        revision: 1,
        status: 'reviewed',
        sourceSignature: '',
        provenance: [{ anchor: 'p0', refs: [{ kind: 'insight', id: 'i1', at: 'now' }] }],
        protectedBlocks: [],
        pinnedQuotes: [],
        imagePlacements: [],
      },
    ];
    expect(noteOnBook(chapters)).toContain('1 coaching insights');
    // The featured-reader scan is a word-boundary match.
    expect(bookMentionsReader(chapters, 'Angel')).toBe(true);
    expect(bookMentionsReader(chapters, 'Angela')).toBe(false);
  });
});

describe('export (64 §3.9)', () => {
  it('renders the published head as a Markdown document', () => {
    const manifest: PublishedManifest = {
      schemaVersion: 1,
      publishedAt: 'now',
      title: 'The Story of Ben',
      matter: { dedication: 'For my mother', epigraph: 'Begin.', acknowledgments: 'Thanks.' },
      noteOnBook: 'Drawn from your record — never invented.',
      parts: [{ id: 'p1', title: 'Roots', chapterIds: ['c1'] }],
      chapterOrder: ['c1'],
      images: [],
    };
    const md = bookToMarkdown(manifest, [
      {
        id: 'c1',
        title: 'The Garage',
        markdown: 'The garage smelled of pine.',
        imagePlacements: [],
      },
    ]);
    expect(md).toContain('# The Story of Ben');
    expect(md).toContain('> Begin.');
    expect(md).toContain('*For my mother*');
    expect(md).toContain('## Roots');
    expect(md).toContain('### The Garage');
    expect(md).toContain('The garage smelled of pine.');
    expect(md).toContain('## Acknowledgments');
    expect(md).toContain('*Drawn from your record — never invented.*');
    expect(exportFileStem('The Story of Ben!')).toBe('The-Story-of-Ben');
  });

  it('builds Markdown from the published head, null before publishing', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    expect(await buildPublishedMarkdown(fs, key, 'author', bookId)).toBeNull(); // not published yet
    await publishBook(fs, key, 'author', bookId, now);
    const built = await buildPublishedMarkdown(fs, key, 'author', bookId);
    expect(built?.title).toBe('The Story of Ben');
    expect(built?.markdown).toContain('### The Garage'); // the one Reviewed chapter
  });

  it('renders the published head as a self-contained, safely-escaped print HTML document', () => {
    const manifest: PublishedManifest = {
      schemaVersion: 1,
      publishedAt: 'now',
      title: 'The Story of Ben',
      matter: { dedication: 'For my mother', epigraph: 'Begin.', acknowledgments: 'Thanks.' },
      noteOnBook: 'Drawn from your record — never invented.',
      parts: [{ id: 'p1', title: 'Roots', chapterIds: ['c1'] }],
      chapterOrder: ['c1'],
      images: [],
    };
    const html = bookToHtml(manifest, [
      // a hostile chapter: raw HTML + bold/italic; escaping must neutralize the tag but keep the formatting
      {
        id: 'c1',
        title: 'The Garage',
        markdown: 'The **garage** smelled <script>alert(1)</script> of *pine*.',
        imagePlacements: [],
      },
    ]);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<style>');
    expect(html).toContain('<h1>The Story of Ben</h1>');
    expect(html).toContain('<h2>Roots</h2>');
    expect(html).toContain('<h3>The Garage</h3>');
    expect(html).toContain('<strong>garage</strong>');
    expect(html).toContain('<em>pine</em>');
    expect(html).toContain('<h2>Acknowledgments</h2>');
    // safety: the raw <script> is escaped, never a live tag (spec-34's no-raw-HTML rule).
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('builds print HTML from the published head, null before publishing', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    expect(await buildPublishedHtml(fs, key, 'author', bookId)).toBeNull(); // not published yet
    await publishBook(fs, key, 'author', bookId, now);
    const built = await buildPublishedHtml(fs, key, 'author', bookId);
    expect(built?.title).toBe('The Story of Ben');
    expect(built?.html).toContain('<h3>The Garage</h3>');
  });

  it('embeds the cover + placed images as inline data URIs (§3.8)', () => {
    const manifest: PublishedManifest = {
      schemaVersion: 1,
      publishedAt: 'now',
      title: 'The Story of Ben',
      coverImageId: 'cov',
      parts: [{ id: 'p1', title: 'Roots', chapterIds: ['c1'] }],
      chapterOrder: ['c1'],
      images: [
        { id: 'cov', kind: 'cover', mime: 'image/png', createdAt: 'now' },
        { id: 'ph1', kind: 'uploaded', mime: 'image/jpeg', createdAt: 'now' },
      ],
    };
    const chapters = [
      {
        id: 'c1',
        title: 'The Garage',
        markdown: 'Para one.\n\nPara two.',
        imagePlacements: [{ imageId: 'ph1', afterAnchor: 'p0', caption: 'The garage' }],
      },
    ];
    const images = {
      cov: { mime: 'image/png', base64: 'AAAA' },
      ph1: { mime: 'image/jpeg', base64: 'BBBB' },
    };
    const md = bookToMarkdown(manifest, chapters, images);
    expect(md).toContain('![Cover](data:image/png;base64,AAAA)');
    expect(md).toContain('![The garage](data:image/jpeg;base64,BBBB)');
    const html = bookToHtml(manifest, chapters, images);
    expect(html).toContain('<img class="coverImg" src="data:image/png;base64,AAAA"');
    expect(html).toContain('<figure class="placed"><img src="data:image/jpeg;base64,BBBB"');
    expect(html).toContain('<figcaption>The garage</figcaption>');
  });
});

describe('published image snapshot + shared read (§3.8)', () => {
  it('freezes referenced image bytes at publish and serves them to a granted reader, re-gated', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    // Place an uploaded photo in the reviewed chapter c1 (c2 is not reviewed → not published).
    const photo = await addUploadedPhoto(
      fs,
      key,
      'author',
      bookId,
      { bytes: new Uint8Array([1, 2, 3, 4]), mime: 'image/png' },
      now,
    );
    await setImagePlacement(fs, key, 'author', bookId, 'c1', {
      imageId: photo.id,
      afterAnchor: 'p0',
    });

    await publishBook(fs, key, 'author', bookId, now);
    // The bytes are frozen in the published head + recorded on the manifest.
    expect(await getPublishedImageBytes(fs, key, 'author', bookId, photo.id)).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );

    // A granted reader can read the published image; a stranger / a revoked reader cannot.
    await grantReader(fs, key, 'author', bookId, 'reader', now);
    const served = await readSharedImage(fs, key, 'reader', 'author', bookId, photo.id);
    expect(served?.mime).toBe('image/png');
    expect(Array.from(served!.bytes)).toEqual([1, 2, 3, 4]);
    expect(await readSharedImage(fs, key, 'stranger', 'author', bookId, photo.id)).toBeNull();

    await revokeReader(fs, key, 'author', bookId, 'reader', now);
    expect(await readSharedImage(fs, key, 'reader', 'author', bookId, photo.id)).toBeNull();
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import type { ClaudeClient, FileSystem } from '../host';
import { memFileSystem } from '../host/memFileSystem';
import { savePerson } from '../people';
import type { AiDeps } from '../questionnaires';
import type { BookChapter, BookConfig, Person } from '../schemas';
import {
  anchorIndex,
  paragraphAnchor,
  removeImagePlacement,
  setImagePlacement,
  suggestImagePlacement,
} from './storyPlacementService';
import { addUploadedPhoto, createBook, getChapter, saveChapter } from './storyService';

const key = generateMasterKey();
const now = new Date('2026-07-16T00:00:00.000Z');
const config: BookConfig = { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true };
const PNG = new Uint8Array([137, 80, 78, 71]);

let fs: FileSystem;
beforeEach(() => {
  fs = memFileSystem();
});

function fakeClaude(text: string): ClaudeClient {
  return {
    send: () => Promise.resolve(''),
    stream: () =>
      Promise.resolve({
        text,
        usage: { inputTokens: 5, outputTokens: 2, cacheWriteTokens: 0, cacheReadTokens: 0 },
      }),
  };
}

function person(id: string): Person {
  return {
    id,
    schemaVersion: 2,
    displayName: `Name-${id}`,
    isSubject: true,
    tags: [],
    createdAt: 'now',
    updatedAt: 'now',
  };
}

const chapter = (over: Partial<BookChapter> = {}): BookChapter => ({
  id: 'c1',
  schemaVersion: 1,
  partId: 'p1',
  order: 0,
  title: 'The Garage',
  markdown: 'First paragraph about the garage.\n\nSecond paragraph.\n\nThird paragraph, the end.',
  revision: 1,
  status: 'reviewed',
  sourceSignature: '',
  provenance: [],
  protectedBlocks: [],
  pinnedQuotes: [],
  imagePlacements: [],
  ...over,
});

async function seed(): Promise<{ bookId: string; imageId: string }> {
  await savePerson(fs, key, person('author'));
  const book = await createBook(fs, key, {
    personId: 'author',
    type: 'biography',
    title: 'The Story of Ben',
    config,
    now,
  });
  await saveChapter(fs, key, 'author', book.id, chapter());
  const photo = await addUploadedPhoto(
    fs,
    key,
    'author',
    book.id,
    { bytes: PNG, mime: 'image/png' },
    now,
  );
  return { bookId: book.id, imageId: photo.id };
}

function deps(claude: ClaudeClient): AiDeps {
  return {
    fs,
    key,
    client: claude,
    apiKey: 'sk',
    model: 'claude-sonnet-4-6',
    personId: 'author',
    now,
  };
}

describe('anchor helpers', () => {
  it('round-trips a paragraph anchor', () => {
    expect(paragraphAnchor(2)).toBe('p2');
    expect(anchorIndex('p2')).toBe(2);
    expect(anchorIndex('nope')).toBeNull();
  });
});

describe('suggestImagePlacement (AI-suggested anchor, §3.8)', () => {
  it('returns the model’s chosen paragraph as a clamped anchor', async () => {
    const { bookId, imageId } = await seed();
    const res = await suggestImagePlacement(deps(fakeClaude('1')), {
      bookId,
      chapterId: 'c1',
      imageId,
    });
    expect(res).toEqual({ ok: true, afterAnchor: 'p1' });
  });

  it('clamps an out-of-range suggestion into the chapter', async () => {
    const { bookId, imageId } = await seed();
    const res = await suggestImagePlacement(deps(fakeClaude('99')), {
      bookId,
      chapterId: 'c1',
      imageId,
    });
    expect(res).toEqual({ ok: true, afterAnchor: 'p2' }); // 3 paragraphs → max index 2
  });

  it('surfaces a NO_KEY failure honestly (the caller can still place manually)', async () => {
    const { bookId, imageId } = await seed();
    const noKey = await suggestImagePlacement(
      { ...deps(fakeClaude('1')), apiKey: null },
      { bookId, chapterId: 'c1', imageId },
    );
    expect(noKey.ok === false && noKey.reason).toBe('NO_KEY');
  });
});

describe('setImagePlacement / removeImagePlacement (instant, no-AI)', () => {
  it('upserts a placement (deduped by imageId), clamps the anchor, and rejects an unknown image', async () => {
    const { bookId, imageId } = await seed();
    // Unknown image → refused.
    expect(
      await setImagePlacement(fs, key, 'author', bookId, 'c1', {
        imageId: 'ghost',
        afterAnchor: 'p0',
      }),
    ).toBeNull();

    // Place after p1.
    await setImagePlacement(fs, key, 'author', bookId, 'c1', {
      imageId,
      afterAnchor: 'p1',
      caption: 'Here',
    });
    let c = await getChapter(fs, key, 'author', bookId, 'c1');
    expect(c?.imagePlacements).toEqual([{ imageId, afterAnchor: 'p1', caption: 'Here' }]);

    // Move it (same imageId → deduped, replaced, not doubled); an off-the-end anchor clamps.
    await setImagePlacement(fs, key, 'author', bookId, 'c1', { imageId, afterAnchor: 'p9' });
    c = await getChapter(fs, key, 'author', bookId, 'c1');
    expect(c?.imagePlacements).toEqual([{ imageId, afterAnchor: 'p2', caption: '' }]); // one entry, clamped

    // Remove it.
    await removeImagePlacement(fs, key, 'author', bookId, 'c1', imageId);
    c = await getChapter(fs, key, 'author', bookId, 'c1');
    expect(c?.imagePlacements).toEqual([]);
  });
});

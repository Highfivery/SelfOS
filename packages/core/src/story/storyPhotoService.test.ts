import { beforeEach, describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import type { ClaudeClient, FileSystem } from '../host';
import { memFileSystem } from '../host/memFileSystem';
import { savePerson } from '../people';
import type { BookConfig, Person } from '../schemas';
import { queryUsage, setPersonBudget } from '../usage';
import { analyzeStoryPhoto } from './storyPhotoService';
import {
  addPhotoAnswer,
  addUploadedPhoto,
  createBook,
  getPhotoAnswers,
  getStoryImageIndex,
} from './storyService';
import { getStoryImage } from './storyImageService';

const key = generateMasterKey();
const now = new Date('2026-07-16T00:00:00.000Z');
const config: BookConfig = { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true };
const ALL = { from: '2000-01-01T00:00:00.000Z', to: '2100-01-01T00:00:00.000Z' };
const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);

let fs: FileSystem;
beforeEach(() => {
  fs = memFileSystem();
});

/** A fake Claude returning a fixed vision JSON (caption + questions). */
function fakeClaude(
  text = '{"caption":"A garage in winter","questions":["Who is in this photo?","What were you fixing?"]}',
): ClaudeClient {
  return {
    send: () => Promise.resolve(''),
    stream: () =>
      Promise.resolve({
        text,
        usage: { inputTokens: 30, outputTokens: 12, cacheWriteTokens: 0, cacheReadTokens: 0 },
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

async function seed(): Promise<string> {
  await savePerson(fs, key, person('author'));
  const book = await createBook(fs, key, {
    personId: 'author',
    type: 'biography',
    title: 'The Story of Ben',
    config,
    now,
  });
  return book.id;
}

describe('addUploadedPhoto + photo answers (§3.7)', () => {
  it('stores an uploaded photo (indexed `uploaded`), decrypts back, and persists photo answers', async () => {
    const bookId = await seed();
    const entry = await addUploadedPhoto(
      fs,
      key,
      'author',
      bookId,
      { bytes: PNG, mime: 'image/png' },
      now,
    );
    expect(entry.kind).toBe('uploaded');
    const index = await getStoryImageIndex(fs, key, 'author', bookId);
    expect(index.images.map((i) => i.id)).toEqual([entry.id]);
    const got = await getStoryImage(fs, key, 'author', bookId, entry.id);
    expect(Array.from(got!.bytes)).toEqual(Array.from(PNG));

    // A photo answer lands in the interview corpus.
    await addPhotoAnswer(
      fs,
      key,
      'author',
      bookId,
      { imageId: entry.id, question: 'Who took this?', answer: 'My father.' },
      now,
    );
    const answers = await getPhotoAnswers(fs, key, 'author', bookId);
    expect(answers).toEqual([
      {
        imageId: entry.id,
        question: 'Who took this?',
        answer: 'My father.',
        at: now.toISOString(),
      },
    ]);
  });
});

describe('analyzeStoryPhoto (Claude vision, §3.7)', () => {
  async function seedWithPhoto(): Promise<{ bookId: string; imageId: string }> {
    const bookId = await seed();
    const entry = await addUploadedPhoto(
      fs,
      key,
      'author',
      bookId,
      { bytes: PNG, mime: 'image/png' },
      now,
    );
    return { bookId, imageId: entry.id };
  }
  function deps(over: Partial<Parameters<typeof analyzeStoryPhoto>[0]> = {}) {
    return {
      fs,
      key,
      claude: fakeClaude(),
      anthropicApiKey: 'sk-a' as string | null,
      claudeModel: 'claude-sonnet-4-6',
      personId: 'author',
      bookId: 'REPLACED',
      imageId: 'REPLACED',
      now,
      ...over,
    };
  }

  it('requires the Claude key, then the photo to exist', async () => {
    const { bookId, imageId } = await seedWithPhoto();
    const noKey = await analyzeStoryPhoto(deps({ bookId, imageId, anthropicApiKey: null }));
    expect(noKey.ok === false && noKey.reason).toBe('NO_KEY');
    const missing = await analyzeStoryPhoto(deps({ bookId, imageId: 'nope' }));
    expect(missing.ok === false && missing.reason).toBe('ERROR');
  });

  it('captions + asks questions, stamps the caption on the entry, and meters story.vision', async () => {
    const { bookId, imageId } = await seedWithPhoto();
    const res = await analyzeStoryPhoto(deps({ bookId, imageId }));
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.analysis.caption).toBe('A garage in winter');
    expect(res.analysis.questions).toEqual(['Who is in this photo?', 'What were you fixing?']);
    // The caption is stamped onto the index entry (durable label).
    const index = await getStoryImageIndex(fs, key, 'author', bookId);
    expect(index.images[0]?.caption).toBe('A garage in winter');
    // Metered.
    const usage = await queryUsage(fs, key, { ...ALL, personId: 'author' });
    expect(usage.some((u) => u.type === 'story.vision')).toBe(true);
  });

  it('surfaces an honest ERROR on an unparseable reply (but still meters the paid call, §7)', async () => {
    const { bookId, imageId } = await seedWithPhoto();
    const res = await analyzeStoryPhoto(
      deps({ bookId, imageId, claude: fakeClaude('sorry, not JSON') }),
    );
    expect(res.ok === false && res.reason).toBe('ERROR');
    const usage = await queryUsage(fs, key, { ...ALL, personId: 'author' });
    expect(usage.some((u) => u.type === 'story.vision')).toBe(true);
  });

  it('caps the questions at 4 and drops blanks', async () => {
    const { bookId, imageId } = await seedWithPhoto();
    const res = await analyzeStoryPhoto(
      deps({
        bookId,
        imageId,
        claude: fakeClaude('{"caption":"x","questions":["a","","b","c","d","e"]}'),
      }),
    );
    if (!res.ok) throw new Error('expected ok');
    expect(res.analysis.questions).toEqual(['a', 'b', 'c', 'd']);
  });

  it('refuses when the AI budget is reached, before the vision call', async () => {
    const { bookId, imageId } = await seedWithPhoto();
    await setPersonBudget(fs, key, 'author', {
      limitUsd: 0.000001,
      period: 'week',
      warnRatio: 0.8,
    });
    await analyzeStoryPhoto(deps({ bookId, imageId })); // burn the tiny budget
    const res = await analyzeStoryPhoto(deps({ bookId, imageId }));
    expect(res.ok === false && res.reason).toBe('BUDGET');
  });
});

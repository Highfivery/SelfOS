import { beforeEach, describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import type {
  ClaudeClient,
  ClaudeStreamOptions,
  FileSystem,
  ImageClient,
  ImageGenerateOutcome,
} from '../host';
import { memFileSystem } from '../host/memFileSystem';
import { savePerson } from '../people';
import type { BookChapter, BookConfig, Person } from '../schemas';
import { queryUsage, setPersonBudget } from '../usage';
import {
  buildStoryImagePromptInput,
  deleteStoryImage,
  generateStoryImage,
  getStoryImage,
  type GenerateStoryImageDeps,
} from './storyImageService';
import { createBook, getBook, getStoryImageIndex, saveChapter, updateBook } from './storyService';

const key = generateMasterKey();
const now = new Date('2026-07-16T00:00:00.000Z');
const config: BookConfig = { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true };

const captured: { claudeInput?: string | undefined; imagePrompt?: string | undefined } = {};
const ALL = { from: '2000-01-01T00:00:00.000Z', to: '2100-01-01T00:00:00.000Z' };

let fs: FileSystem;
beforeEach(() => {
  fs = memFileSystem();
  captured.claudeInput = undefined;
  captured.imagePrompt = undefined;
});

/** A fake Claude that records the distillation input and returns a fixed, NAME-FREE distilled prompt. */
function fakeClaude(
  distilled = 'a lone lantern on a dark winter road, symbolic and painterly',
): ClaudeClient {
  return {
    send: () => Promise.resolve(''),
    stream: (options) => {
      captured.claudeInput = options.messages.map((m) => m.content).join('\n');
      return Promise.resolve({
        text: distilled,
        usage: { inputTokens: 20, outputTokens: 10, cacheWriteTokens: 0, cacheReadTokens: 0 },
      });
    },
  };
}

/** A fake image client that records the prompt OpenAI would see and returns a configurable outcome. */
function fakeImage(outcome?: ImageGenerateOutcome): ImageClient {
  return {
    verify: () => Promise.resolve(),
    generate: (options) => {
      captured.imagePrompt = options.prompt;
      return Promise.resolve(
        outcome ?? {
          ok: true,
          image: { bytes: new Uint8Array([1, 2, 3, 4, 5]), mime: 'image/png' },
        },
      );
    },
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

/** Seed an author with a book whose essence + one chapter give a symbolic seed. */
async function seed(essence = 'A quiet man who kept things running.'): Promise<string> {
  await savePerson(fs, key, person('author'));
  const book = await createBook(fs, key, {
    personId: 'author',
    type: 'biography',
    title: 'The Story of Ben',
    config,
    now,
  });
  const chapter: BookChapter = {
    id: 'c1',
    schemaVersion: 1,
    partId: 'p1',
    order: 0,
    title: 'The Garage',
    markdown: 'The garage smelled of pine and motor oil, and Ben learned that a machine obeys.',
    revision: 1,
    status: 'reviewed',
    sourceSignature: '',
    provenance: [],
    protectedBlocks: [],
    pinnedQuotes: [],
    imagePlacements: [],
  };
  await saveChapter(fs, key, 'author', book.id, chapter);
  await updateBook(fs, key, 'author', book.id, { essence }, now);
  return book.id;
}

function deps(over: Partial<GenerateStoryImageDeps> = {}): GenerateStoryImageDeps {
  return {
    fs,
    key,
    claude: fakeClaude(),
    image: fakeImage(),
    anthropicApiKey: 'sk-a',
    openaiApiKey: 'sk-o',
    consent: true,
    claudeModel: 'claude-sonnet-4-6',
    imageModel: 'gpt-image-1',
    style: 'oil painting',
    personId: 'author',
    bookId: 'REPLACED',
    target: { kind: 'cover' },
    now,
    ...over,
  };
}

describe('buildStoryImagePromptInput (name-free by construction)', () => {
  it('builds a symbolic brief with the style + framing, and augments with styleNotes', () => {
    const input = buildStoryImagePromptInput({
      kind: 'cover',
      title: 'The Story of Ben',
      seed: 'resilience, machines, quiet devotion',
      style: 'oil painting',
      styleNotes: 'muted blues',
    });
    expect(input).toContain('symbolic book cover');
    expect(input).toContain('resilience, machines, quiet devotion');
    expect(input).toContain('Visual style: oil painting.');
    expect(input).toContain('Additional style direction: muted blues.');
    expect(input).toContain('NEVER a portrait'); // the non-likeness framing
    // Blank notes add no line.
    const noNotes = buildStoryImagePromptInput({
      kind: 'illustration',
      title: 'x',
      seed: 'y',
      style: 'z',
    });
    expect(noNotes).not.toContain('Additional style direction');
  });
});

describe('generateStoryImage (§3.8)', () => {
  it('gates on consent, then the OpenAI key, then the Claude key', async () => {
    const bookId = await seed();
    expect((await generateStoryImage(deps({ bookId, consent: false }))).ok).toBe(false);
    expect((await generateStoryImage(deps({ bookId, consent: false }))).ok).toBe(false);
    const noConsent = await generateStoryImage(deps({ bookId, consent: false }));
    expect(noConsent.ok === false && noConsent.reason).toBe('NO_CONSENT');
    const noKey = await generateStoryImage(deps({ bookId, openaiApiKey: null }));
    expect(noKey.ok === false && noKey.reason).toBe('NO_KEY');
    const noClaude = await generateStoryImage(deps({ bookId, anthropicApiKey: null }));
    expect(noClaude.ok === false && noClaude.reason).toBe('NO_KEY');
  });

  it('disables adaptive thinking on the distillation call (the bounded-output rule)', async () => {
    // Adaptive thinking SHARES the 400-token distillation budget and can starve the prompt to empty while
    // still billing the call ([[adaptive-thinking-shares-maxtokens]]) — the option must be off.
    const bookId = await seed();
    let streamOptions: ClaudeStreamOptions | undefined;
    const capturing: ClaudeClient = {
      send: () => Promise.resolve(''),
      stream: (options) => {
        streamOptions = options;
        return Promise.resolve({
          text: 'a lone lantern on a dark road',
          usage: { inputTokens: 20, outputTokens: 10, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    const res = await generateStoryImage(deps({ bookId, claude: capturing }));
    expect(res.ok).toBe(true);
    expect(streamOptions?.extendedThinking).toBe(false);
  });

  it('uses the book’s OWN image style + direction over the global fallback (§3.8)', async () => {
    const bookId = await seed();
    await updateBook(
      fs,
      key,
      'author',
      bookId,
      { config: { ...config, imageStyle: 'ukiyo-e', imageStyleNotes: 'muted blues' } },
      now,
    );
    captured.claudeInput = undefined;
    // deps.style is the GLOBAL fallback; the book set its own, so its style wins in the distillation input.
    const res = await generateStoryImage(deps({ bookId, style: 'oil painting' }));
    expect(res.ok).toBe(true);
    expect(captured.claudeInput).toContain('Visual style: ukiyo-e.');
    expect(captured.claudeInput).not.toContain('oil painting');
    expect(captured.claudeInput).toContain('Additional style direction: muted blues.');
  });

  it('distills → renders → encrypts → indexes → stamps the cover, metering both charges', async () => {
    const bookId = await seed();
    const res = await generateStoryImage(deps({ bookId, target: { kind: 'cover' } }));
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.image.kind).toBe('cover');

    // The book now points at the cover; the index has the entry; the bytes decrypt back.
    const book = await getBook(fs, key, 'author', bookId);
    expect(book?.coverImageId).toBe(res.image.id);
    const index = await getStoryImageIndex(fs, key, 'author', bookId);
    expect(index.images.map((i) => i.id)).toEqual([res.image.id]);
    const got = await getStoryImage(fs, key, 'author', bookId, res.image.id);
    expect(got?.mime).toBe('image/png');
    expect(Array.from(got!.bytes)).toEqual([1, 2, 3, 4, 5]);

    // Both usage events landed (the Claude distill + the flat OpenAI image).
    const usage = await queryUsage(fs, key, { ...ALL, personId: 'author' });
    expect(usage.some((u) => u.type === 'story.imagePrompt')).toBe(true);
    expect(usage.some((u) => u.type === 'story.image')).toBe(true);
    // OpenAI only ever saw the distilled, name-free prompt — never the raw essence/chapter.
    expect(captured.imagePrompt).toBe(
      'a lone lantern on a dark winter road, symbolic and painterly',
    );
  });

  it('regenerating a cover reaps the previous image (no orphan)', async () => {
    const bookId = await seed();
    const first = await generateStoryImage(deps({ bookId }));
    if (!first.ok) throw new Error('first failed');
    const second = await generateStoryImage(deps({ bookId }));
    if (!second.ok) throw new Error('second failed');
    expect(second.image.id).not.toBe(first.image.id);
    const index = await getStoryImageIndex(fs, key, 'author', bookId);
    expect(index.images.map((i) => i.id)).toEqual([second.image.id]); // the old cover is gone
    expect(await getStoryImage(fs, key, 'author', bookId, first.image.id)).toBeNull();
    const book = await getBook(fs, key, 'author', bookId);
    expect(book?.coverImageId).toBe(second.image.id);
  });

  it('an illustration carries its chapterId and does NOT become the cover', async () => {
    const bookId = await seed();
    const res = await generateStoryImage(
      deps({ bookId, target: { kind: 'illustration', chapterId: 'c1' } }),
    );
    if (!res.ok) throw new Error('failed');
    expect(res.image.kind).toBe('generated');
    expect(res.image.chapterId).toBe('c1');
    const book = await getBook(fs, key, 'author', bookId);
    expect(book?.coverImageId).toBeUndefined(); // an illustration never sets the cover
    // The chapter seed reached Claude (defense-in-depth strips the name from the OUTPUT).
    expect(captured.claudeInput).toContain('The Garage');
  });

  it('a REFUSED render is uncharged for the image (only the distillation billed)', async () => {
    const bookId = await seed();
    const res = await generateStoryImage(
      deps({ bookId, image: fakeImage({ ok: false, reason: 'REFUSED', message: 'policy' }) }),
    );
    expect(res.ok === false && res.reason).toBe('REFUSED');
    const usage = await queryUsage(fs, key, { ...ALL, personId: 'author' });
    expect(usage.some((u) => u.type === 'story.imagePrompt')).toBe(true);
    expect(usage.some((u) => u.type === 'story.image')).toBe(false); // never billed the render
    // No image was written.
    expect((await getStoryImageIndex(fs, key, 'author', bookId)).images).toEqual([]);
  });

  it('an oversized/wrong-format return AFTER a billed render is still metered (§7)', async () => {
    const bookId = await seed();
    const res = await generateStoryImage(
      deps({
        bookId,
        image: fakeImage({ ok: true, image: { bytes: new Uint8Array(0), mime: 'image/png' } }),
      }),
    );
    expect(res.ok === false && res.reason).toBe('ERROR');
    const usage = await queryUsage(fs, key, { ...ALL, personId: 'author' });
    expect(usage.some((u) => u.type === 'story.image')).toBe(true); // the paid render is recorded
    expect((await getStoryImageIndex(fs, key, 'author', bookId)).images).toEqual([]); // but nothing stored
  });

  it('refuses when the AI budget is reached, before any provider call', async () => {
    const bookId = await seed();
    await setPersonBudget(fs, key, 'author', {
      limitUsd: 0.000001,
      period: 'week',
      warnRatio: 0.8,
    });
    // Burn the tiny budget with a prior generate.
    await generateStoryImage(deps({ bookId }));
    const res = await generateStoryImage(deps({ bookId }));
    expect(res.ok === false && res.reason).toBe('BUDGET');
  });

  it('deleteStoryImage removes bytes + index entry and clears the cover pointer', async () => {
    const bookId = await seed();
    const res = await generateStoryImage(deps({ bookId }));
    if (!res.ok) throw new Error('failed');
    await deleteStoryImage(fs, key, 'author', bookId, res.image.id, now);
    expect((await getStoryImageIndex(fs, key, 'author', bookId)).images).toEqual([]);
    expect(await getStoryImage(fs, key, 'author', bookId, res.image.id)).toBeNull();
    expect((await getBook(fs, key, 'author', bookId))?.coverImageId).toBeUndefined();
  });
});

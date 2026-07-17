import type { ClaudeClient, FileSystem, ImageClient } from '../host';
import { uuid } from '../id';
import type { StoryImageEntry, StoryImageGenerateResult, UsageEvent } from '../schemas';
import { checkBudget, costOf, recordUsage } from '../usage';
import {
  clearBookCover,
  getBook,
  getChapter,
  getStoryImageIndex,
  getStoryImageBytes,
  removeStoryImage,
  saveStoryImageBytes,
  saveStoryImageIndex,
  updateBook,
} from './storyService';

/**
 * Your Story image generation (64-your-story §3.8, Phase H). Reuses the spec-13 two-provider flow: a
 * **Claude** pass distills the book (cover) or chapter (illustration) into a tight, **name-free, symbolic**
 * visual prompt (metered `story.imagePrompt`), then **OpenAI** renders pixels (flat `story.image`). The
 * result is encrypted to `images/<imageId>.enc` and indexed. A cover is symbolic — never a portrait or a
 * photoreal likeness of the subject (§8.2 spirit): the distillation instruction forbids any name, any real-
 * person likeness, and any text/typography in the image. Both keys stay host-side; consent + budget gate
 * every call. Gen shares the ONE image consent (`dreams.imageGenerationEnabled`) + the OpenAI key (owner
 * decision 2026-07-16 — one switch for all AI images).
 */

const IMAGE_SIZE = '1024x1024'; // a fixed square (the dream precedent); cost seeds at the 1024² estimate
const ALLOWED_MIME = ['image/png', 'image/webp', 'image/jpeg'] as const;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // ~5 MB (the 08 §13.2 bound, reused)
const DISTILL_MAX_TOKENS = 400;
const CHAPTER_SEED_CHARS = 800; // a bounded excerpt is plenty for a symbolic scene

function isAllowedMime(mime: string): boolean {
  return (ALLOWED_MIME as readonly string[]).includes(mime);
}

// Applied to EVERY prompt regardless of preset: a life-story image is symbolic — never a portrait/likeness of
// the real subject, and never any text/title in the image (the renderer owns the title). Non-negotiable.
const STORY_IMAGE_FRAMING =
  'Render it as an evocative, non-photorealistic, SYMBOLIC artwork in the chosen style — a mood, a place, an ' +
  'object, or a landscape, clearly an artistic interpretation and NEVER a portrait or photoreal likeness of ' +
  'any real person. Put NO text, letters, title, or typography anywhere in the image. Keep everything within ' +
  'content policy.';

const DISTILLATION_INSTRUCTION =
  'You turn a life-story brief into a SINGLE vivid visual prompt for an image generator. Output ONLY the ' +
  'prompt — one tight paragraph, no preamble, no quotes, no lists. Make it SYMBOLIC and evocative — a mood, ' +
  'a place, an object, a landscape — NEVER a portrait or literal likeness of any real person, and NEVER ' +
  'include any person’s name. Do NOT put any words, letters, title, or typography in the image. Keep it ' +
  'non-photorealistic and strictly within content policy — never explicit, violent, or disallowed imagery, ' +
  'and add nothing designed to evade a content policy.';

/**
 * Assemble the **distillation input** handed to Claude — pure, so it is unit-tested in isolation. Name-free by
 * construction: the seed is thematic prose (the book essence, or a chapter's title/brief/excerpt), and any
 * name inside it is stripped by the distillation instruction before the prompt reaches OpenAI. Optional
 * `styleNotes` augments the preset (never replaces it); blank/absent adds no line.
 */
export function buildStoryImagePromptInput(input: {
  kind: 'cover' | 'illustration';
  title: string;
  seed: string;
  style: string;
  styleNotes?: string;
}): string {
  const what = input.kind === 'cover' ? 'book cover' : 'chapter illustration';
  const lines: string[] = [
    `Brief for a symbolic ${what} for a life-story titled “${input.title}”.`,
    `Themes to evoke:\n${input.seed.trim()}`,
    `Visual style: ${input.style}.`,
  ];
  const styleNotes = input.styleNotes?.trim();
  if (styleNotes) lines.push(`Additional style direction: ${styleNotes}.`);
  lines.push(STORY_IMAGE_FRAMING);
  return lines.join('\n\n');
}

function usageEvent(
  type: 'story.imagePrompt' | 'story.image',
  model: string,
  bookId: string,
  personId: string,
  at: string,
  tokens: {
    inputTokens: number;
    outputTokens: number;
    cacheWriteTokens: number;
    cacheReadTokens: number;
  },
): UsageEvent {
  return {
    id: uuid(),
    schemaVersion: 1,
    type,
    personId,
    sessionId: bookId,
    model,
    at,
    ...tokens,
    costUsd: costOf(model, tokens),
  };
}

async function overBudget(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  now: Date,
  override: boolean | undefined,
): Promise<boolean> {
  const person = await checkBudget(fs, key, { scope: 'person', personId, now, override });
  const app = await checkBudget(fs, key, { scope: 'app', now, override });
  return person.state === 'over' || app.state === 'over';
}

export type StoryImageTarget = { kind: 'cover' } | { kind: 'illustration'; chapterId: string };

export interface GenerateStoryImageDeps {
  fs: FileSystem;
  key: Uint8Array;
  claude: ClaudeClient;
  image: ImageClient;
  anthropicApiKey: string | null;
  openaiApiKey: string | null;
  consent: boolean; // the shared dreams.imageGenerationEnabled (§6)
  claudeModel: string;
  imageModel: string;
  style: string;
  styleNotes?: string;
  personId: string;
  bookId: string;
  target: StoryImageTarget;
  now: Date;
  override?: boolean;
  /** Realtime phase callback (§ UI progress): `composing` before the Claude distillation, `rendering`
   *  before the OpenAI render — the bridge forwards these to the renderer so it shows live progress. */
  onPhase?: (phase: 'composing' | 'rendering') => void;
}

/**
 * Generate (or regenerate) a cover or chapter illustration: consent + keys + budget gates → distill the
 * prompt via Claude (records `story.imagePrompt`) → render via OpenAI → validate bytes/mime → encrypt to
 * `images/<id>.enc` + add an index entry → for a cover, stamp `book.coverImageId` and delete the previous
 * cover (its bytes + entry) so a regenerate never orphans. A `REFUSED` is uncharged (no `story.image`); an
 * oversized/wrong-MIME return after a billed generate IS metered (the §7 "a paid call is recorded" rule). A
 * failed generate never touches a prior image (we write only on success).
 */
export async function generateStoryImage(
  deps: GenerateStoryImageDeps,
): Promise<StoryImageGenerateResult> {
  const { fs, key, claude, image, anthropicApiKey, openaiApiKey, consent } = deps;
  const { claudeModel, imageModel, style, personId, bookId, target, now } = deps;

  if (!consent) {
    return {
      ok: false,
      reason: 'NO_CONSENT',
      message: 'Turn on AI image generation in Settings first.',
    };
  }
  if (!openaiApiKey) {
    return {
      ok: false,
      reason: 'NO_KEY',
      message: 'Add your OpenAI key in Settings to create images.',
    };
  }
  if (!anthropicApiKey) {
    return {
      ok: false,
      reason: 'NO_KEY',
      message: 'Add your Claude key first — it prepares the prompt.',
    };
  }

  const book = await getBook(fs, key, personId, bookId);
  if (!book) return { ok: false, reason: 'ERROR', message: 'That book could no longer be found.' };

  // Seed the brief. A cover draws on the book essence + title; an illustration on its chapter's themes.
  let seed: string;
  if (target.kind === 'cover') {
    seed = book.essence?.trim() || book.title;
  } else {
    const chapter = await getChapter(fs, key, personId, bookId, target.chapterId);
    if (!chapter)
      return { ok: false, reason: 'ERROR', message: 'That chapter could no longer be found.' };
    seed = [chapter.title, chapter.markdown.slice(0, CHAPTER_SEED_CHARS)]
      .filter(Boolean)
      .join('\n\n');
    if (!seed.trim()) seed = chapter.title || book.title;
  }

  if (await overBudget(fs, key, personId, now, deps.override)) {
    return { ok: false, reason: 'BUDGET', message: 'AI budget reached for this period.' };
  }

  const at = now.toISOString();
  const promptInput = buildStoryImagePromptInput({
    kind: target.kind,
    title: book.title,
    seed,
    style,
    ...(deps.styleNotes ? { styleNotes: deps.styleNotes } : {}),
  });

  // 1. Distill via Claude. A pre-render failure here makes no OpenAI call and is not metered.
  deps.onPhase?.('composing');
  let distilled;
  try {
    distilled = await claude.stream(
      {
        apiKey: anthropicApiKey,
        model: claudeModel,
        system: DISTILLATION_INSTRUCTION,
        messages: [{ role: 'user', content: promptInput }],
        maxTokens: DISTILL_MAX_TOKENS,
      },
      () => {},
    );
  } catch {
    return {
      ok: false,
      reason: 'ERROR',
      message: 'Couldn’t prepare the image prompt. Please try again.',
    };
  }
  const promptUsage = usageEvent(
    'story.imagePrompt',
    claudeModel,
    bookId,
    personId,
    at,
    distilled.usage,
  );
  await recordUsage(fs, key, promptUsage);

  const distilledPrompt = distilled.text.trim();
  if (!distilledPrompt) {
    return {
      ok: false,
      reason: 'ERROR',
      message: 'The image prompt came back empty. Please try again.',
      promptUsage,
    };
  }

  // 2. Render via OpenAI from the distilled, name-free prompt only.
  deps.onPhase?.('rendering');
  const outcome = await image.generate({
    apiKey: openaiApiKey,
    model: imageModel,
    prompt: distilledPrompt,
    size: IMAGE_SIZE,
  });
  if (!outcome.ok) {
    if (outcome.reason === 'REFUSED') {
      return {
        ok: false,
        reason: 'REFUSED',
        message:
          'OpenAI declined to generate this image (its content policy). You can adjust the style or direction and try again.',
        promptUsage,
      };
    }
    return {
      ok: false,
      reason: 'ERROR',
      message: outcome.message || 'The image couldn’t be generated. Please try again.',
      promptUsage,
    };
  }

  // The OpenAI call was billed → meter the flat charge regardless of post-validation (§7). Zero tokens: the
  // flat per-image price comes from IMAGE_PRICING in costOf, not from token counts.
  const imageUsage = usageEvent('story.image', imageModel, bookId, personId, at, {
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
  });
  await recordUsage(fs, key, imageUsage);

  const { bytes, mime } = outcome.image;
  if (!isAllowedMime(mime) || bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      reason: 'ERROR',
      message: 'The generated image came back in an unexpected format. Please try again.',
      promptUsage,
      imageUsage,
    };
  }

  // 3. Store + index. Only here do we mutate — a failed generate above left any prior image intact.
  const imageId = uuid();
  await saveStoryImageBytes(fs, key, personId, bookId, imageId, bytes);
  const entry: StoryImageEntry = {
    id: imageId,
    kind: target.kind === 'cover' ? 'cover' : 'generated',
    mime,
    createdAt: at,
    ...(target.kind === 'illustration' ? { chapterId: target.chapterId } : {}),
  };
  const index = await getStoryImageIndex(fs, key, personId, bookId);
  await saveStoryImageIndex(fs, key, personId, bookId, {
    ...index,
    images: [...index.images, entry],
  });

  if (target.kind === 'cover') {
    // Replace the previous cover: point the book at the new one, then reap the old bytes + entry so a
    // regenerate never orphans an image (idempotent — a first cover has no previous).
    const previousCoverId = book.coverImageId;
    await updateBook(fs, key, personId, bookId, { coverImageId: imageId }, now);
    if (previousCoverId && previousCoverId !== imageId) {
      await removeStoryImage(fs, key, personId, bookId, previousCoverId);
    }
  }

  return { ok: true, image: entry, promptUsage, imageUsage };
}

/** Read + decrypt an image's bytes with its indexed MIME; null if there's no such image or it's unreadable. */
export async function getStoryImage(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  imageId: string,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const index = await getStoryImageIndex(fs, key, personId, bookId);
  const entry = index.images.find((img) => img.id === imageId);
  if (!entry) return null;
  const bytes = await getStoryImageBytes(fs, key, personId, bookId, imageId);
  return bytes ? { bytes, mime: entry.mime } : null;
}

/** Delete an image (bytes + index entry). If it was the cover, clear `book.coverImageId` too. */
export async function deleteStoryImage(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
  imageId: string,
  now: Date,
): Promise<void> {
  const book = await getBook(fs, key, personId, bookId);
  await removeStoryImage(fs, key, personId, bookId, imageId);
  if (book?.coverImageId === imageId) {
    await clearBookCover(fs, key, personId, bookId, now);
  }
}

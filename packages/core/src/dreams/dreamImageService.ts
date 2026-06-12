import { decryptBytes, encryptBytes, isEncryptedEnvelope } from '../crypto';
import type { ClaudeClient, FileSystem, ImageClient } from '../host';
import { uuid } from '../id';
import type { DreamImageDescriptor, DreamImageGenerateResult, UsageEvent } from '../schemas';
import { checkBudget, costOf, recordUsage } from '../usage';
import { buildDepictionNote } from '../people';
import { getDream, saveDream } from './dreamService';

/**
 * Dream-image generation service (13-dream-images §5.2). Two providers, one orchestrator: a **Claude**
 * pass distills the dream into a tight, **name-free** visual prompt (metered `dream.imagePrompt`), then
 * **OpenAI** renders pixels from that prompt (flat `dream.image`). The result is encrypted to
 * `image.enc` beside the dream and stamped onto `Dream.image`. The privacy boundary is upstream
 * (`buildDepictionNote` is name-free + private-free, §8.2); the distillation system instruction is
 * defense in depth, forbidding any name in the prompt that reaches OpenAI. Both keys stay host-side.
 */

const IMAGE_SIZE = '1024x1024'; // v1 is a fixed square (§4.4); cost seeds at the high-quality 1024² estimate

/** Formats we accept back from the provider (§4.4). Bounded blob size keeps vault sync sane. */
const ALLOWED_DREAM_IMAGE_MIME = ['image/png', 'image/webp', 'image/jpeg'] as const;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // ~5 MB (the 08 §13.2 bound, reused)

function isAllowedImageMime(mime: string): boolean {
  return (ALLOWED_DREAM_IMAGE_MIME as readonly string[]).includes(mime);
}

/** A dream's single canonical image lives inside its folder, so `deleteDream` purges it with the folder. */
export function dreamImagePath(personId: string, dreamId: string): string {
  return `people/${personId}/dreams/${dreamId}/image.enc`;
}

/**
 * Guard (the `08` §13.2 `isMediaPath` spirit): a caller-supplied path must address a dream's `image.enc`
 * and nothing else, so a malicious renderer can't read/delete an arbitrary vault file by path. The bridge
 * addresses images by `(personId, dreamId)` and derives the path itself — this is defense in depth.
 */
export function isDreamImagePath(path: string): boolean {
  return /^people\/[^/]+\/dreams\/[^/]+\/image\.enc$/.test(path) && !path.includes('..');
}

const DREAMLIKE_FRAMING =
  'Render it dreamlike and non-photorealistic — soft, surreal, evocative, clearly an artistic ' +
  'interpretation rather than a literal photograph. Keep everything within content policy.';

/**
 * Assemble the **distillation input** handed to Claude (13 §5.3) — pure, so it is unit-tested in isolation.
 * It injects **no person's name**: the narrative is the dreamer's own words, and the depiction notes
 * (`buildDepictionNote`) are already name-free + private-free. A free-name dream person contributes nothing
 * here (it's already in the narrative). The chosen style + the dreamlike framing are always present.
 */
export function buildImagePromptInput(input: {
  narrative: string;
  depictionNotes: string[];
  style: string;
}): string {
  const lines: string[] = [`Dream narrative:\n"${input.narrative}"`];
  const notes = input.depictionNotes.map((n) => n.trim()).filter(Boolean);
  if (notes.length > 0) {
    lines.push('Figures that appeared (describe generically, NEVER by name):');
    for (const note of notes) lines.push(`- ${note}`);
  }
  lines.push(`Visual style: ${input.style}.`);
  lines.push(DREAMLIKE_FRAMING);
  return lines.join('\n\n');
}

const DISTILLATION_INSTRUCTION =
  'You turn a dream description into a SINGLE vivid visual prompt for an image generator. Output ONLY the ' +
  'prompt — one tight paragraph, no preamble, no quotes, no lists. NEVER include any person’s name; ' +
  'describe any figure only by the generic physical descriptions provided. Keep it dreamlike and ' +
  'non-photorealistic, and strictly within content policy — never produce explicit, violent, or disallowed ' +
  'imagery, and add nothing designed to evade a content policy.';

const DISTILL_MAX_TOKENS = 400;

export interface GenerateDreamImageDeps {
  fs: FileSystem;
  key: Uint8Array;
  claude: ClaudeClient;
  image: ImageClient;
  anthropicApiKey: string | null;
  openaiApiKey: string | null;
  consent: boolean; // dreams.imageGenerationEnabled (the one-time third-party consent, §6)
  claudeModel: string;
  imageModel: string;
  style: string; // per-image override or the Settings default
  personId: string;
  dreamId: string;
  now: Date;
  override?: boolean;
}

function promptUsageEvent(
  model: string,
  dreamId: string,
  personId: string,
  at: string,
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheWriteTokens: number;
    cacheReadTokens: number;
  },
): UsageEvent {
  return {
    id: uuid(),
    schemaVersion: 1,
    type: 'dream.imagePrompt',
    personId,
    sessionId: dreamId,
    model,
    at,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    cacheReadTokens: usage.cacheReadTokens,
    costUsd: costOf(model, usage),
  };
}

function imageUsageEvent(model: string, dreamId: string, personId: string, at: string): UsageEvent {
  const tokens = { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 };
  return {
    id: uuid(),
    schemaVersion: 1,
    type: 'dream.image',
    personId,
    sessionId: dreamId,
    model,
    at,
    ...tokens,
    costUsd: costOf(model, tokens), // the flat per-image price (§4.5)
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

/**
 * Generate (or regenerate) a dream's image: consent + key + budget gates → distill the prompt via Claude
 * (records `dream.imagePrompt`) → render via OpenAI → validate bytes/mime → encrypt to `image.enc` → stamp
 * `Dream.image` → record the flat `dream.image`. A `REFUSED` is uncharged (no `dream.image`); an oversized
 * /wrong-MIME return after a billed generate IS metered (the §7 "a paid call is recorded" rule). A failed
 * generate leaves any existing image untouched (we overwrite only on success).
 */
export async function generateDreamImage(
  deps: GenerateDreamImageDeps,
): Promise<DreamImageGenerateResult> {
  const { fs, key, claude, image, anthropicApiKey, openaiApiKey, consent } = deps;
  const { claudeModel, imageModel, style, personId, dreamId, now } = deps;

  if (!consent) {
    return {
      ok: false,
      reason: 'NO_CONSENT',
      message: 'Turn on dream-image generation in Settings first.',
    };
  }
  if (!openaiApiKey) {
    return {
      ok: false,
      reason: 'NO_KEY',
      message: 'Add your OpenAI key in Settings to visualize dreams.',
    };
  }
  if (!anthropicApiKey) {
    return {
      ok: false,
      reason: 'NO_KEY',
      message: 'Add your Claude key first — it prepares the image prompt.',
    };
  }

  const dream = await getDream(fs, key, personId, dreamId);
  if (!dream)
    return { ok: false, reason: 'ERROR', message: 'That dream could no longer be found.' };

  if (await overBudget(fs, key, personId, now, deps.override)) {
    return { ok: false, reason: 'BUDGET', message: 'AI budget reached for this period.' };
  }

  const at = now.toISOString();

  // 1. Name-free depiction notes for the People-graph-linked figures (free names contribute nothing).
  const depictionNotes: string[] = [];
  for (const ref of dream.people) {
    if (!ref.personId) continue;
    const note = await buildDepictionNote(fs, key, ref.personId, now);
    if (note) depictionNotes.push(note);
  }
  const promptInput = buildImagePromptInput({ narrative: dream.narrative, depictionNotes, style });

  // 2. Distill via Claude. A pre-generation failure here makes no OpenAI call and is not metered.
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
  const promptUsage = promptUsageEvent(claudeModel, dreamId, personId, at, distilled.usage);
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

  // 3. Render via OpenAI from the distilled, name-free prompt only.
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
          'OpenAI declined to generate this image (its content policy). Your dream is saved; you can edit the description and try again.',
        promptUsage, // the distillation ran + billed; the refused render did not
      };
    }
    return {
      ok: false,
      reason: 'ERROR',
      message: outcome.message || 'The image couldn’t be generated. Please try again.',
      promptUsage,
    };
  }

  // The OpenAI call was billed → meter the flat charge regardless of post-validation (§7).
  const imageUsage = imageUsageEvent(imageModel, dreamId, personId, at);
  await recordUsage(fs, key, imageUsage);

  const { bytes, mime } = outcome.image;
  if (!isAllowedImageMime(mime) || bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      reason: 'ERROR',
      message: 'The generated image came back in an unexpected format. Please try again.',
      promptUsage,
      imageUsage,
    };
  }

  // 4. Encrypt + store, then stamp the descriptor. Overwriting only here means a failed regenerate keeps
  //    the prior image. A regenerate preserves who the image was shared with (the dreamer's choice, §3.6).
  const envelope = await encryptBytes(bytes, key);
  await fs.writeAtomic(
    dreamImagePath(personId, dreamId),
    new TextEncoder().encode(JSON.stringify(envelope)),
  );
  const descriptor: DreamImageDescriptor = {
    style,
    mime,
    generatedAt: at,
    model: imageModel,
    ...(dream.image?.shareableWith && dream.image.shareableWith.length > 0
      ? { shareableWith: dream.image.shareableWith }
      : {}),
  };
  await saveDream(fs, key, { ...dream, image: descriptor, updatedAt: at });

  return { ok: true, descriptor, mime, promptUsage, imageUsage };
}

/** Read + decrypt a dream's image; null if there's no image, it's out of bounds, or it's unreadable. */
export async function getDreamImage(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  dreamId: string,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const dream = await getDream(fs, key, personId, dreamId);
  if (!dream?.image) return null;
  const path = dreamImagePath(personId, dreamId);
  if (!isDreamImagePath(path)) return null;
  const raw = await fs.read(path);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(raw));
    if (!isEncryptedEnvelope(parsed)) return null;
    return { bytes: await decryptBytes(parsed, key), mime: dream.image.mime };
  } catch {
    return null;
  }
}

/** Delete a dream's image: remove `image.enc` and clear the `Dream.image` descriptor. */
export async function deleteDreamImage(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  dreamId: string,
  now: Date,
): Promise<void> {
  const path = dreamImagePath(personId, dreamId);
  if (isDreamImagePath(path)) await fs.remove(path);
  const dream = await getDream(fs, key, personId, dreamId);
  if (dream?.image) {
    const cleared: typeof dream = { ...dream, updatedAt: now.toISOString() };
    delete cleared.image;
    await saveDream(fs, key, cleared);
  }
}

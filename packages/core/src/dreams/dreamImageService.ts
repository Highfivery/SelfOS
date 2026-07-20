import { decryptBytes, encryptBytes, isEncryptedEnvelope } from '../crypto';
import type { ClaudeClient, FileSystem, ImageClient } from '../host';
import { uuid } from '../id';
import type {
  DreamImageDescriptor,
  DreamImageGenerateResult,
  DreamSharedImage,
  DreamShareResult,
  UsageEvent,
} from '../schemas';
import { checkBudget, costOf, recordUsage } from '../usage';
import { buildDepictionNote, listPeople, listRelatedPeople } from '../people';
import { deleteDream, getDream, listDreams, saveDream } from './dreamService';

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

// The baseline safety framing applied to EVERY prompt regardless of preset (§8.2/§15.1): a figure may
// resemble a real person from name-free depiction notes, so the image must never read as a photoreal
// likeness. Softened from "dreamlike" to "evocative, non-photorealistic" so it blends with a non-dreamlike
// preset (e.g. cinematic/realistic → filmic / painterly-realistic) rather than contradicting it — but the
// non-photorealism guarantee is non-negotiable.
const DREAMLIKE_FRAMING =
  'Render it as an evocative, non-photorealistic artwork in the chosen style — clearly an artistic ' +
  'interpretation rather than a literal photograph, and never a photoreal likeness of any real person. ' +
  'Keep everything within content policy.';

/**
 * Assemble the **distillation input** handed to Claude (13 §5.3) — pure, so it is unit-tested in isolation.
 * It injects **no person's name**: the narrative is the dreamer's own words, and the depiction notes
 * (`buildDepictionNote`) are already name-free + private-free. A free-name dream person contributes nothing
 * here (it's already in the narrative). The chosen style + the non-photorealistic framing are always present.
 * Optional `styleNotes` (the dreamer's free-text style direction, §15.2) augments — never replaces — the
 * preset, appended after the style line and before the baseline framing (which still wins). Blank/absent
 * notes add no line (§15.4); style notes are visual direction only and pass through the same name-free
 * distillation, so the §5.3/§8 privacy guarantees are unchanged.
 */
export function buildImagePromptInput(input: {
  narrative: string;
  depictionNotes: string[];
  style: string;
  styleNotes?: string;
}): string {
  const lines: string[] = [`Dream narrative:\n"${input.narrative}"`];
  const notes = input.depictionNotes.map((n) => n.trim()).filter(Boolean);
  if (notes.length > 0) {
    lines.push('Figures that appeared (describe generically, NEVER by name):');
    for (const note of notes) lines.push(`- ${note}`);
  }
  lines.push(`Visual style: ${input.style}.`);
  const styleNotes = input.styleNotes?.trim();
  if (styleNotes) lines.push(`Additional style direction: ${styleNotes}.`);
  lines.push(DREAMLIKE_FRAMING);
  return lines.join('\n\n');
}

const DISTILLATION_INSTRUCTION =
  'You turn a dream description into a SINGLE vivid visual prompt for an image generator. Output ONLY the ' +
  'prompt — one tight paragraph, no preamble, no quotes, no lists. NEVER include any person’s name; ' +
  'describe any figure only by the generic physical descriptions provided. Keep it evocative and ' +
  'non-photorealistic — an artistic interpretation, never a photoreal likeness of a real person — and ' +
  'strictly within content policy — never produce explicit, violent, or disallowed imagery, and add ' +
  'nothing designed to evade a content policy.';

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
  styleNotes?: string; // dreams.imageStyleNotes — Settings-only free-text style direction (§15.2)
  personId: string;
  dreamId: string;
  now: Date;
  override?: boolean;
  /** Realtime phase callback: `composing` before the Claude distillation, `rendering` before the OpenAI
   *  render — forwarded to the renderer so the dream-image panel shows live progress instead of a spinner. */
  onPhase?: (phase: 'composing' | 'rendering') => void;
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
  const promptInput = buildImagePromptInput({
    narrative: dream.narrative,
    depictionNotes,
    style,
    ...(deps.styleNotes ? { styleNotes: deps.styleNotes } : {}),
  });

  // 2. Distill via Claude. A pre-generation failure here makes no OpenAI call and is not metered.
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
  //    RE-READ before writing. The `dream` above was fetched BEFORE two network calls (the Claude
  //    distillation + the OpenAI render), so by now it is tens of seconds stale — spreading it would
  //    clobber a narrative edit the dreamer saved while the image was generating, losing typed prose
  //    (strictly worse than losing a regenerable image). Only the image fields are ours to write here;
  //    everything else comes from the current record. `shareableWith` is read from the fresh copy too,
  //    so a share/un-share made during generation is honoured rather than reverted.
  const fresh = await getDream(fs, key, personId, dreamId);
  if (!fresh) {
    // Deleted mid-generation. Writing here would RESURRECT the dream the dreamer just deleted — and the
    // `writeAtomic` above has already recreated its folder to hold the bytes — so undo that and fail
    // honestly instead. Both calls really happened, so the usage stays reported (a billed failure, like
    // the wrong-MIME branch above). Deleting again is idempotent: it just removes the folder we recreated.
    await deleteDream(fs, personId, dreamId);
    return {
      ok: false,
      reason: 'ERROR',
      message: 'That dream was deleted while its image was being created.',
      promptUsage,
      imageUsage,
    };
  }
  const carriedShares = fresh.image?.shareableWith;
  const descriptor: DreamImageDescriptor = {
    style,
    mime,
    generatedAt: at,
    model: imageModel,
    ...(carriedShares && carriedShares.length > 0 ? { shareableWith: carriedShares } : {}),
  };
  await saveDream(fs, key, { ...fresh, image: descriptor, updatedAt: at });

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

/**
 * Share (or unshare) a dream's image with a **related** person (13-dream-images §3.6). Mirrors the §13.5
 * per-fact sharing: refuses a sensitive-tier dream (intimate content can't leave the dreamer) and a
 * non-related / unknown target. Toggles the person in `Dream.image.shareableWith` (dropping the prop when
 * empty). The image still never enters anyone's AI coaching context — sharing only makes it viewable.
 */
export async function setDreamImageShare(deps: {
  fs: FileSystem;
  key: Uint8Array;
  dreamerId: string;
  dreamId: string;
  targetPersonId: string;
  shared: boolean;
  now: Date;
}): Promise<DreamShareResult> {
  const { fs, key, dreamerId, dreamId, targetPersonId, shared, now } = deps;
  const dream = await getDream(fs, key, dreamerId, dreamId);
  if (!dream?.image) return { ok: false, reason: 'NOT_FOUND' };
  if (dream.sensitivity !== 'standard') return { ok: false, reason: 'SENSITIVE' };
  const targets = await listRelatedPeople(fs, key, dreamerId);
  if (!targets.some((target) => target.id === targetPersonId)) {
    return { ok: false, reason: 'NOT_FOUND' };
  }

  const next = new Set(dream.image.shareableWith ?? []);
  if (shared) next.add(targetPersonId);
  else next.delete(targetPersonId);
  const image: DreamImageDescriptor = { ...dream.image };
  if (next.size > 0) image.shareableWith = [...next];
  else delete image.shareableWith;
  await saveDream(fs, key, { ...dream, image, updatedAt: now.toISOString() });
  return { ok: true };
}

/**
 * A recipient reads an image shared **with them** — re-validating the relationship + the share +
 * standard-tier at READ time (so un-sharing or removing the relationship immediately denies; no stale
 * access, the §13.5 read-time re-gate). Null if not currently shared with the viewer.
 */
export async function getSharedDreamImage(
  fs: FileSystem,
  key: Uint8Array,
  viewerId: string,
  dreamerId: string,
  dreamId: string,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  if (viewerId === dreamerId) return null; // your own image is read via getDreamImage
  const dream = await getDream(fs, key, dreamerId, dreamId);
  if (!dream?.image || dream.sensitivity !== 'standard') return null;
  if (!(dream.image.shareableWith ?? []).includes(viewerId)) return null;
  // The relationship is re-checked here, so deleting it drops the share without touching shareableWith.
  const related = await listRelatedPeople(fs, key, viewerId);
  if (!related.some((person) => person.id === dreamerId)) return null;
  return getDreamImage(fs, key, dreamerId, dreamId);
}

/**
 * Every dream image currently shared with the viewer — the "Shared with you" surface (13-dream-images
 * §3.6). Scans the viewer's **related** people's dreams for a standard-tier image whose `shareableWith`
 * includes the viewer. Metadata only (bytes fetched via `getSharedDreamImage`). The relationship re-gate
 * means an un-shared / un-related image simply stops appearing.
 */
export async function listImagesSharedWith(
  fs: FileSystem,
  key: Uint8Array,
  viewerId: string,
): Promise<DreamSharedImage[]> {
  const relatedIds = new Set((await listRelatedPeople(fs, key, viewerId)).map((p) => p.id));
  const out: DreamSharedImage[] = [];
  for (const person of await listPeople(fs, key)) {
    if (person.id === viewerId || !relatedIds.has(person.id)) continue;
    for (const dream of await listDreams(fs, key, person.id)) {
      if (dream.sensitivity !== 'standard' || !dream.image) continue;
      if (!(dream.image.shareableWith ?? []).includes(viewerId)) continue;
      out.push({
        dreamerId: person.id,
        dreamerName: person.displayName,
        dreamId: dream.id,
        mime: dream.image.mime,
      });
    }
  }
  return out;
}

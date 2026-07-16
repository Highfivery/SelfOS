import { classifyParseOutcome, extractJsonObject } from '../ai';
import type { ClaudeClient, ContentBlock, FileSystem } from '../host';
import { toBase64 } from '../encoding';
import { uuid } from '../id';
import { z } from 'zod';
import type { StoryPhotoAnalyzeResult, UsageEvent } from '../schemas';
import { checkBudget, costOf, recordUsage } from '../usage';
import { setStoryImageAnalysis } from './storyService';
import { getStoryImage } from './storyImageService';

/**
 * Your Story photo vision analysis (64-your-story §3.7, Phase H2). An uploaded photo (already downscaled +
 * EXIF-stripped in the renderer, spec 45) is analyzed by **Claude vision** — one metered `story.vision` call
 * that proposes a short caption + 2–4 questions to draw out the memory behind the photo. The caption is
 * stamped onto the image index entry; the questions are returned for the person to answer inline, and each
 * answer persists to the interview corpus (`addPhotoAnswer`) so the gap engine + generation can draw on it.
 *
 * A photo is NEVER an image-GENERATION input (§3.8) — it's only ever read by vision here. The key stays
 * host-side; budget gates the call; a failure is honest (the photo is still saved either way).
 */

const VISION_MAX_TOKENS = 600;
const MAX_QUESTIONS = 4;

const VISION_SYSTEM =
  'You are a warm biographer looking at a personal photo the author uploaded for their life story. Suggest a ' +
  'short, gentle caption (one line, no quotes) and 2–4 open questions that would draw out the memory, people, ' +
  'place, and feeling behind it — the kind a good interviewer asks. Do NOT guess names or invent facts; ask ' +
  'about them instead. Output ONLY JSON: {"caption": string, "questions": string[]}. No preamble, no code fence.';

const AnalysisDraftSchema = z.object({
  caption: z.string().catch(''),
  questions: z.array(z.string()).catch([]),
});

export interface AnalyzeStoryPhotoDeps {
  fs: FileSystem;
  key: Uint8Array;
  claude: ClaudeClient;
  anthropicApiKey: string | null;
  claudeModel: string;
  personId: string;
  bookId: string;
  imageId: string;
  now: Date;
  override?: boolean;
  /** Include the flat $ figure (admins only) — the bridge decides. */
  showCost?: boolean;
}

/**
 * Analyze an uploaded photo: key + budget gates → Claude vision (records `story.vision`, meter-before-parse) →
 * tolerant-parse {caption, questions} → stamp the caption onto the index entry → return the analysis. An
 * unparseable reply is an honest failure. The photo itself is untouched on failure (it was already stored).
 */
export async function analyzeStoryPhoto(
  deps: AnalyzeStoryPhotoDeps,
): Promise<StoryPhotoAnalyzeResult> {
  const { fs, key, claude, anthropicApiKey, claudeModel, personId, bookId, imageId, now } = deps;
  if (!anthropicApiKey) {
    return { ok: false, reason: 'NO_KEY', message: 'Add your Claude key in Settings first.' };
  }
  const photo = await getStoryImage(fs, key, personId, bookId, imageId);
  if (!photo)
    return { ok: false, reason: 'ERROR', message: 'That photo could no longer be found.' };

  const person = await checkBudget(fs, key, {
    scope: 'person',
    personId,
    now,
    override: deps.override,
  });
  const app = await checkBudget(fs, key, { scope: 'app', now, override: deps.override });
  if (person.state === 'over' || app.state === 'over') {
    return { ok: false, reason: 'BUDGET', message: 'AI budget reached for this period.' };
  }

  const content: ContentBlock[] = [
    { type: 'text', text: 'Here is the photo:' },
    {
      type: 'image',
      source: { type: 'base64', media_type: photo.mime, data: toBase64(photo.bytes) },
    },
  ];

  let streamed;
  try {
    streamed = await claude.stream(
      {
        apiKey: anthropicApiKey,
        model: claudeModel,
        system: VISION_SYSTEM,
        messages: [{ role: 'user', content }],
        maxTokens: VISION_MAX_TOKENS,
        extendedThinking: false, // bounded structured JSON — keep the full budget for the output
      },
      () => {},
    );
  } catch {
    return {
      ok: false,
      reason: 'ERROR',
      message: 'Couldn’t analyze that photo. Please try again.',
    };
  }

  const usage: UsageEvent = {
    id: uuid(),
    schemaVersion: 1,
    type: 'story.vision',
    personId,
    sessionId: bookId,
    model: claudeModel,
    at: now.toISOString(),
    inputTokens: streamed.usage.inputTokens,
    outputTokens: streamed.usage.outputTokens,
    cacheWriteTokens: streamed.usage.cacheWriteTokens,
    cacheReadTokens: streamed.usage.cacheReadTokens,
    costUsd: costOf(claudeModel, streamed.usage),
  };
  await recordUsage(fs, key, usage); // meter-before-parse (§7)

  const json = extractJsonObject(streamed.text);
  if (!json) {
    // Any parse outcome (truncated / malformed / refused) is surfaced honestly; the photo stays saved.
    const { message } = classifyParseOutcome(streamed.text, 'photo caption');
    return { ok: false, reason: 'ERROR', message };
  }
  const draft = AnalysisDraftSchema.parse(json);
  const caption = draft.caption.trim();
  const questions = draft.questions
    .map((q) => q.trim())
    .filter(Boolean)
    .slice(0, MAX_QUESTIONS);

  await setStoryImageAnalysis(fs, key, personId, bookId, imageId, {
    ...(caption ? { caption } : {}),
    ...(caption ? { visionNotes: caption } : {}),
  });

  return {
    ok: true,
    analysis: { caption, questions },
    ...(deps.showCost ? { costUsd: usage.costUsd } : {}),
  };
}

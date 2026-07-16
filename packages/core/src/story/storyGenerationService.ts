import { z } from 'zod';
import { classifyParseOutcome, extractJsonObject, tolerantArray } from '../ai';
import { uuid } from '../id';
import { type AiDeps, runClaude } from '../questionnaires';
import {
  LIFE_AREAS,
  type AiFailureReason,
  type BookChapter,
  type BookConfig,
  type BookOutline,
  type ExclusionItem,
  type LifeTimeline,
  type OutlineChapter,
  type UsageEvent,
} from '../schemas';
import { getBookType, type BookType } from './bookTypes';
import { buildStoryCorpus, type StoryCorpus } from './storyCorpus';
import {
  buildBiographerSystem,
  buildChapterUserMessage,
  buildFoundationsUserMessage,
  tagCorpusItems,
} from './storyPromptBuilder';
import { stripSourceMarkers } from './storyText';
// Re-exported so existing importers (tests, the bridge) keep their `./storyGenerationService` entry points.
export { chapterParagraphs, stripSourceMarkers } from './storyText';
import {
  getBook,
  getChapter,
  getExclusions,
  getOutline,
  saveChapter,
  updateBook,
} from './storyService';

/**
 * The Your Story generation service (64-your-story §5.3) — the orchestrator that turns the corpus into the
 * book. This slice (A2) is the FOUNDATIONS pass: essence + timeline + outline. Chapter generation and the
 * batch-markup revision land in slice B; each is an independent bounded `runClaude` call, metered + budget-
 * gated + resumable, so a book is a queue of small calls (no single giant generation).
 *
 * `runClaude` already: gates the budget, disables adaptive thinking (so the JSON isn't truncated to empty),
 * and RECORDS USAGE before returning — so metering happens BEFORE we parse (a billed-but-unparseable call is
 * still metered, the meter-before-parse rule). We then parse tolerantly and classify any failure honestly
 * (TRUNCATED / MALFORMED / REFUSED — never assume a refusal).
 */

/** A compliant foundations response is ~2–4k tokens; give generous headroom so a rich corpus doesn't
 *  truncate the outline (the portrait-synthesis lesson). */
const FOUNDATIONS_MAX_TOKENS = 8000;

/** Tolerant draft schema — one bad chapter/part/event drops itself, never the whole outline (37 §3.1). */
const DraftChapterSchema = z.object({
  title: z.string().catch(''),
  brief: z.string().catch(''),
  eraFrom: z.string().optional().catch(undefined),
  eraTo: z.string().optional().catch(undefined),
  lifeAreas: z.array(z.string()).optional().catch(undefined),
});
type DraftChapter = z.infer<typeof DraftChapterSchema>;

const DraftPartSchema = z.object({
  title: z.string().catch(''),
  chapters: tolerantArray(
    DraftChapterSchema,
    { title: '', brief: '' } as DraftChapter,
    (c) => c.title.trim().length > 0,
  ),
});
type DraftPart = z.infer<typeof DraftPartSchema>;

const DraftTimelineEventSchema = z.object({
  label: z.string().catch(''),
  date: z.string().optional().catch(undefined),
  approx: z.string().optional().catch(undefined),
});
type DraftTimelineEvent = z.infer<typeof DraftTimelineEventSchema>;

const FoundationsDraftSchema = z.object({
  essence: z.string().catch(''),
  timeline: tolerantArray(
    DraftTimelineEventSchema,
    { label: '' } as DraftTimelineEvent,
    (e) => e.label.trim().length > 0,
  ).catch([]),
  outline: z
    .object({
      parts: tolerantArray(
        DraftPartSchema,
        { title: '', chapters: [] } as DraftPart,
        (p) => p.chapters.length > 0,
      ),
    })
    .catch({ parts: [] }),
});

export type FoundationsResult =
  | { ok: true; essence: string; outline: BookOutline; timeline: LifeTimeline; usage: UsageEvent }
  | { ok: false; reason: AiFailureReason; message: string };

/**
 * Run the foundations pass: read the whole corpus and propose the essence, timeline, and outline. Returns
 * the parsed result WITHOUT persisting — the caller (the bridge/service, slice A3) writes it to the book's
 * files. Ids and order are minted here (never trusted from the model). Works even on a thin corpus (§7): the
 * outline just proposes fewer, broader chapters.
 */
export async function generateFoundations(
  deps: AiDeps,
  opts: { bookType: BookType; config: BookConfig; exclusions?: ExclusionItem[] },
): Promise<FoundationsResult> {
  const corpus = await buildStoryCorpus(deps.fs, deps.key, deps.personId, opts.exclusions ?? []);
  const system = buildBiographerSystem(opts.bookType, opts.config, corpus.personName);
  const user = buildFoundationsUserMessage(corpus, opts.bookType);

  const result = await runClaude(deps, system, user, 'story.outline', FOUNDATIONS_MAX_TOKENS);
  if (!result.ok) return { ok: false, reason: result.reason, message: result.message };

  // Usage is already recorded (meter-before-parse). Now parse tolerantly; an unparseable reply is an honest
  // failure the caller can retry — never a silent empty outline.
  const json = extractJsonObject(result.text);
  const parsed = json ? FoundationsDraftSchema.safeParse(json) : null;
  if (!parsed || !parsed.success) {
    const { reason, message } = classifyParseOutcome(result.text, 'outline');
    return { ok: false, reason, message };
  }

  const draft = parsed.data;
  // A parseable-but-empty reply ({} or all chapters salvaged away) is NOT a valid outline — even a thin
  // corpus should yield some broad chapters (§7). Report it honestly so the caller can retry, rather than
  // persisting a blank book (the "never a silent empty outline" contract).
  const chapterCount = draft.outline.parts.reduce((n, part) => n + part.chapters.length, 0);
  if (chapterCount === 0) {
    const { reason, message } = classifyParseOutcome(result.text, 'outline');
    return { ok: false, reason, message };
  }

  const validArea = new Set<string>(LIFE_AREAS);
  const outline: BookOutline = {
    schemaVersion: 1,
    approved: false,
    parts: draft.outline.parts.map((part, partIndex) => {
      const partId = uuid();
      return {
        id: partId,
        title: part.title.trim() || `Part ${partIndex + 1}`,
        chapters: part.chapters.map((chapter, chapterIndex) => ({
          id: uuid(),
          title: chapter.title.trim(),
          brief: chapter.brief.trim(),
          ...(chapter.eraFrom ? { eraFrom: chapter.eraFrom } : {}),
          ...(chapter.eraTo ? { eraTo: chapter.eraTo } : {}),
          // Normalize the advisory life-areas against the fixed taxonomy (the schema's server-side promise) —
          // drop anything the model invented; an empty list stays empty (never forced to 'Other').
          lifeAreas: (chapter.lifeAreas ?? []).filter((area) => validArea.has(area)),
          order: chapterIndex,
        })),
      };
    }),
  };
  const timeline: LifeTimeline = {
    schemaVersion: 1,
    events: draft.timeline.map((event) => ({
      id: uuid(),
      label: event.label.trim(),
      ...(event.date ? { date: event.date } : {}),
      ...(event.approx ? { approx: event.approx } : {}),
      userEdited: false,
    })),
  };

  return { ok: true, essence: draft.essence.trim(), outline, timeline, usage: result.usage };
}

// --- Chapter generation (§5.3) ---------------------------------------------------------------------------

/** A chapter is ~1,500–3,000 words (≈2–4k tokens); give headroom so a rich chapter doesn't truncate. */
const CHAPTER_MAX_TOKENS = 8000;

export type ChapterResult =
  | { ok: true; chapter: BookChapter }
  | { ok: false; reason: AiFailureReason; message: string };

/**
 * Generate (or regenerate) ONE chapter's prose from the corpus + its outline brief (§5.3). Reads the book +
 * outline, builds the corpus (or reuses a pre-built one — the orchestrator builds it once for the whole book),
 * runs the metered `story.chapter` pass, strips the citation markers into provenance, and PERSISTS the chapter.
 * A `reviewed` chapter's protected blocks + pinned quotes are carried forward (their code-enforcement is slice
 * C); status becomes `updated` on a regenerate, `new` on first write. Returns the saved chapter or an honest
 * failure. Never trusts model ids — the chapter id/partId/order/title come from the outline.
 */
export async function generateChapter(
  deps: AiDeps,
  args: { bookId: string; chapterId: string; corpus?: StoryCorpus },
): Promise<ChapterResult> {
  const book = await getBook(deps.fs, deps.key, deps.personId, args.bookId);
  if (!book) return { ok: false, reason: 'ERROR', message: 'That book is no longer here.' };
  const bookType = getBookType(book.type);
  if (!bookType) return { ok: false, reason: 'ERROR', message: 'Unknown book type.' };
  const outline = await getOutline(deps.fs, deps.key, deps.personId, args.bookId);
  if (!outline) return { ok: false, reason: 'ERROR', message: 'This book has no outline yet.' };

  let target: OutlineChapter | undefined;
  let partId = '';
  for (const part of outline.parts) {
    const found = part.chapters.find((c) => c.id === args.chapterId);
    if (found) {
      target = found;
      partId = part.id;
      break;
    }
  }
  if (!target)
    return { ok: false, reason: 'ERROR', message: 'That chapter is no longer in the outline.' };

  const corpus =
    args.corpus ??
    (await buildStoryCorpus(
      deps.fs,
      deps.key,
      deps.personId,
      await getExclusions(deps.fs, deps.key, deps.personId, args.bookId),
    ));
  const tagged = tagCorpusItems(corpus);
  const tagToRef = new Map(tagged.map((t) => [t.tag, t.sourceRef]));
  const system = buildBiographerSystem(bookType, book.config, corpus.personName);
  const user = buildChapterUserMessage(corpus, tagged, {
    chapter: target,
    outline,
    ...(book.essence ? { essence: book.essence } : {}),
  });

  const result = await runClaude(deps, system, user, 'story.chapter', CHAPTER_MAX_TOKENS);
  if (!result.ok) return { ok: false, reason: result.reason, message: result.message };

  const { markdown, provenance } = stripSourceMarkers(result.text, tagToRef);
  if (markdown.trim().length === 0) {
    const { reason, message } = classifyParseOutcome(result.text, 'chapter');
    return { ok: false, reason, message };
  }

  const existing = await getChapter(deps.fs, deps.key, deps.personId, args.bookId, args.chapterId);
  const chapter: BookChapter = {
    id: target.id,
    schemaVersion: 1,
    partId,
    order: target.order,
    title: target.title,
    markdown,
    revision: (existing?.revision ?? 0) + 1,
    status: existing ? 'updated' : 'new',
    sourceSignature: '', // computed by the freshness engine (slice D)
    provenance,
    protectedBlocks: existing?.protectedBlocks ?? [], // preserved across regeneration (enforced in slice C)
    pinnedQuotes: existing?.pinnedQuotes ?? [],
    imagePlacements: existing?.imagePlacements ?? [],
    lastGeneratedAt: deps.now.toISOString(),
    ...(existing?.lastReviewedAt ? { lastReviewedAt: existing.lastReviewedAt } : {}),
  };
  await saveChapter(deps.fs, deps.key, deps.personId, args.bookId, chapter);
  return { ok: true, chapter };
}

export interface BookChaptersResult {
  ok: boolean;
  generated: number;
  reason?: AiFailureReason;
  message?: string;
}

/**
 * The chapter orchestrator (§5.3): generate every not-yet-written (or stale) chapter of an approved book, as a
 * queue of independent metered `story.chapter` calls. Builds the corpus ONCE and reuses it for every chapter
 * (the review perf note). A `reviewed` chapter is never overwritten; an already-written non-stale chapter is
 * skipped (idempotent + resumable). Stops cleanly on `BUDGET` (the remaining chapters resume next period); a
 * per-chapter non-budget failure is skipped so one bad chapter never blocks the rest. Marks the book `ready`
 * once every outline chapter has prose.
 */
export async function generateBookChapters(
  deps: AiDeps,
  bookId: string,
): Promise<BookChaptersResult> {
  const outline = await getOutline(deps.fs, deps.key, deps.personId, bookId);
  if (!outline || outline.parts.length === 0) {
    return { ok: false, generated: 0, reason: 'ERROR', message: 'This book has no outline yet.' };
  }
  const corpus = await buildStoryCorpus(
    deps.fs,
    deps.key,
    deps.personId,
    await getExclusions(deps.fs, deps.key, deps.personId, bookId),
  );

  const chapters = outline.parts.flatMap((part) => part.chapters);
  let generated = 0;
  let budgetHit = false;
  let allWritten = true;
  let lastFailure: { reason: AiFailureReason; message: string } | null = null;
  for (const chapter of chapters) {
    const existing = await getChapter(deps.fs, deps.key, deps.personId, bookId, chapter.id);
    // Skip a chapter that's already written and not flagged stale (idempotent/resumable). Never overwrite a
    // reviewed chapter.
    if (existing && existing.status !== 'stale') continue;
    const res = await generateChapter(deps, { bookId, chapterId: chapter.id, corpus });
    if (res.ok) {
      generated += 1;
      continue;
    }
    allWritten = false; // an unwritten chapter remains → the book isn't fully drafted
    if (res.reason === 'BUDGET') {
      budgetHit = true;
      break; // stop the queue cleanly; the rest resume next period
    }
    // A per-chapter failure (REFUSED/TRUNCATED/ERROR) — remember it in case NOTHING succeeds, then continue
    // so one bad chapter never blocks the rest.
    lastFailure = { reason: res.reason, message: res.message };
  }

  // `allWritten` is exact from the loop: an already-written non-stale chapter is skipped (keeps it true); any
  // freshly-written chapter keeps it true; any fail/budget sets it false — so no second pass is needed. Mark
  // the book ready only once every outline chapter has prose.
  if (allWritten) {
    await updateBook(deps.fs, deps.key, deps.personId, bookId, { status: 'ready' }, deps.now);
  }

  if (budgetHit) {
    return {
      ok: true,
      generated,
      reason: 'BUDGET',
      message: 'AI budget reached — the rest resume next period.',
    };
  }
  // Every attempted chapter failed and none succeeded → surface it so the UI isn't a silent dead-end (the DoD
  // "never a silent dead-end" rule). A PARTIAL pass (some written, some failed) stays quiet — the progress is
  // visible in the overview/reader.
  if (generated === 0 && lastFailure) {
    return { ok: false, generated: 0, reason: lastFailure.reason, message: lastFailure.message };
  }
  return { ok: true, generated };
}

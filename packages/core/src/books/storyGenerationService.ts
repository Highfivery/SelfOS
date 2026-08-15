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
  type ChapterMarkup,
  type ExclusionItem,
  type LifeTimeline,
  type MarkupMark,
  type OutlineChapter,
  type StoryCraftPhase,
  type UsageEvent,
} from '../schemas';
import { getBookType, resolveSpine, resolveTypeOptions, type BookType } from './bookTypes';
import { resolvePersonOptionNames } from './castRegister';
import { CHAPTER_CORPUS_TOKEN_BUDGET, budgetCorpus, sliceCorpusForChapter } from './corpusBudget';
import { buildStoryCorpus, type CorpusItem, type StoryCorpus } from './storyCorpus';
import { critiqueChapter, planChapter, reviseChapter } from './storyCraft';
import { computeSourceSignature } from './storyFreshness';
import { enforceProtected } from './storyMarkup';
import { syncChapterTodos } from './storyMarkupService';
import {
  buildAnswerAuthorMessage,
  buildBiographerSystem,
  buildChapterUserMessage,
  buildFoundationsUserMessage,
  buildRevisionUserMessage,
  renderTaggedCorpus,
  tagCorpusItems,
} from './storyPromptBuilder';
import { chapterParagraphs, countWords, stripSourceMarkers } from './storyText';
import { generatedEventId } from './storyTimeline';
// Re-exported so existing importers (tests, the bridge) keep their `./storyGenerationService` entry points.
export { chapterParagraphs, stripSourceMarkers } from './storyText';
import {
  appendChapterVersion,
  getBook,
  getChapter,
  getExclusions,
  getMarkup,
  getOutline,
  saveChapter,
  saveMarkup,
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
  title: z.string().catch(''),
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
  | {
      ok: true;
      title: string;
      essence: string;
      outline: BookOutline;
      timeline: LifeTimeline;
      usage: UsageEvent;
    }
  | { ok: false; reason: AiFailureReason; message: string };

/**
 * Run the foundations pass: read the whole corpus and propose the essence, timeline, and outline. Returns
 * the parsed result WITHOUT persisting — the caller (the bridge/service, slice A3) writes it to the book's
 * files. Ids and order are minted here (never trusted from the model). Works even on a thin corpus (§7): the
 * outline just proposes fewer, broader chapters.
 */
export async function generateFoundations(
  deps: AiDeps,
  opts: { bookId: string; bookType: BookType; config: BookConfig; exclusions?: ExclusionItem[] },
): Promise<FoundationsResult> {
  const corpus = budgetCorpus(
    await buildStoryCorpus(deps.fs, deps.key, deps.personId, opts.bookId, opts.exclusions ?? []),
  );
  const system = buildBiographerSystem(
    opts.bookType,
    opts.config,
    corpus.personName,
    undefined,
    await resolvePersonOptionNames(deps.fs, deps.key, opts.bookType, opts.config.typeOptions),
  );
  const user = buildFoundationsUserMessage(corpus, opts.bookType, opts.config);

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
  // A `pages` spine states an exact count, and until now that was a request in the prompt with nothing
  // behind it — a 32-page picture book could come back with 40 pages. Enforce the ceiling here (the model
  // gets the count, the code guarantees it). A SHORT reply is left alone deliberately: dropping pages the
  // model actually wrote briefs for is honest, padding with empty shells is the §7.5 defect we removed.
  const spine = resolveSpine(
    opts.bookType,
    resolveTypeOptions(opts.bookType, opts.config.typeOptions),
  );
  const pageCap = spine.kind === 'pages' ? spine.count : Infinity;
  let taken = 0;
  const outline: BookOutline = {
    schemaVersion: 1,
    approved: false,
    parts: draft.outline.parts
      .map((part, partIndex) => {
        const partId = uuid();
        // `taken` runs across parts, not within one, so the cap is the BOOK's page count even if the model
        // split a picture book into several parts.
        const kept = part.chapters.filter(() => taken++ < pageCap);
        return {
          id: partId,
          title: part.title.trim() || `Part ${partIndex + 1}`,
          chapters: kept.map((chapter, chapterIndex) => ({
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
      })
      // A part the cap emptied would render as a heading with nothing under it.
      .filter((part) => part.chapters.length > 0),
  };
  const timeline: LifeTimeline = {
    schemaVersion: 1,
    events: draft.timeline.map((event) => ({
      // Stable across passes (§16.2) — a fresh uuid per pass would defeat the merge on a rename, orphan a
      // `source` exclusion, and stale every chapter citing the moment.
      id: generatedEventId(event.label),
      label: event.label.trim(),
      ...(event.date ? { date: event.date } : {}),
      ...(event.approx ? { approx: event.approx } : {}),
      userEdited: false,
    })),
  };

  return {
    ok: true,
    title: draft.title.trim(),
    essence: draft.essence.trim(),
    outline,
    timeline,
    usage: result.usage,
  };
}

// --- Chapter generation (§5.3) ---------------------------------------------------------------------------

/**
 * The output ceiling for one chapter (72 §5.3). This was 8,000 with a comment describing a `standard`-length
 * chapter (~1,500–3,000 words) — but `full` is the DEFAULT length and asks for 2,500–5,000 words, which tops
 * out above that ceiling once the per-paragraph `[[SRC:…]]` markers are counted. A truncated chapter is refused
 * outright (never persisted half-finished), so the longest chapters were the most likely to fail entirely.
 */
const CHAPTER_MAX_TOKENS = 16000;

/** How much of the draft a revision must keep to be accepted. Fixing named defects trims a chapter a little;
 *  it does not halve it. Below this the reply is a fragment, not a revision, and the draft stands. */
const COLLAPSE_FLOOR = 0.6;

export type ChapterResult =
  | { ok: true; chapter: BookChapter }
  | { ok: false; reason: AiFailureReason; message: string };

/**
 * Generate (or regenerate) ONE chapter through the CRAFT LOOP (72 §5.3): plan → draft → critique → revise.
 * Only the draft is load-bearing — the plan, the critique, and the revision each fail soft, so the loop can
 * improve a chapter but never lose one. Reads the book + outline, builds the corpus (or reuses a pre-built
 * one — the orchestrator builds it once for the whole book), strips the citation markers into provenance,
 * and PERSISTS the chapter ONCE, from whichever text survived the loop.
 * Protected blocks + pinned quotes ride the prompt's PRESERVE list AND are code-enforced after the call
 * (`enforceProtected` — the person's own words survive every rewrite path, not just revisions); the replaced
 * text is archived to the chapter's version history first (§13.9). Status becomes `updated` on a regenerate,
 * `new` on first write. Returns the saved chapter or an honest failure (incl. TRUNCATED — a half-finished
 * chapter is never persisted). Never trusts model ids — id/partId/order/title come from the outline.
 */
export async function generateChapter(
  deps: AiDeps,
  args: {
    bookId: string;
    chapterId: string;
    corpus?: StoryCorpus;
    /** Fired as each craft-loop pass begins, so the caller can stream a live phase to the UI (§12) — a
     *  chapter is three or four calls now, and a progress bar that doesn't move for minutes reads as hung. */
    onPhase?: (phase: StoryCraftPhase) => void;
  },
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
      args.bookId,
      await getExclusions(deps.fs, deps.key, deps.personId, args.bookId),
    ));
  // Read the existing chapter BEFORE the call — its protected blocks + pinned quotes go into the prompt's
  // PRESERVE list, so a rewrite carries the person's own words in the prose (not just as metadata).
  const existing = await getChapter(deps.fs, deps.key, deps.personId, args.bookId, args.chapterId);
  const preserve = existing
    ? [
        ...existing.protectedBlocks.map((b) => b.text),
        ...existing.pinnedQuotes.map((q) => q.text),
      ].filter((t) => t.trim().length > 0)
    : [];
  // Slice the corpus to what's most relevant to THIS chapter, within a token budget (§17.1) — so a long life
  // neither blows the window nor dilutes the chapter. The freshness signature below stays over the FULL corpus
  // (a chapter is fresh against the whole life state), so a budget/relevance tweak never stales every chapter.
  const slice = sliceCorpusForChapter(corpus, target);
  const tagged = tagCorpusItems(slice);
  const tagToRef = new Map(tagged.map((t) => [t.tag, t.sourceRef]));
  // The corpus goes in the SYSTEM prompt, where `cache_control` sits — so the ~40k tokens of source material
  // are written to the cache once and read at ~0.1× by the three or four passes that follow, instead of being
  // paid for in full each time (72 §5.3). The slice is per-chapter, so the cache hits within a chapter.
  const system = buildBiographerSystem(
    bookType,
    book.config,
    corpus.personName,
    renderTaggedCorpus(slice, tagged),
    await resolvePersonOptionNames(deps.fs, deps.key, bookType, book.config.typeOptions),
  );

  // Pass 1 of the craft loop (72 §5.3) — decide what this chapter IS before writing a word. Optional by
  // design: a failed plan (or one the budget stopped) leaves the drafter working from the brief alone,
  // exactly as it did before the loop existed.
  args.onPhase?.('planning');
  const plan = await planChapter(deps, slice, {
    chapter: target,
    outline,
    ...(book.essence ? { essence: book.essence } : {}),
    system,
  });

  const user = buildChapterUserMessage(slice, {
    chapter: target,
    outline,
    ...(book.essence ? { essence: book.essence } : {}),
    ...(preserve.length > 0 ? { preserve } : {}),
    ...(plan ? { plan } : {}),
  });

  // Pass 2 — the draft. The only load-bearing pass: everything before and after it is an improvement that
  // can fail without costing the chapter.
  args.onPhase?.('drafting');
  const result = await runClaude(deps, system, user, 'story.chapter', CHAPTER_MAX_TOKENS);
  if (!result.ok) return { ok: false, reason: result.reason, message: result.message };
  // Still cut off after the bounded continuations: NEVER persist a half-finished chapter as if complete —
  // a book chapter ending mid-scene with no warning is a silent integrity failure (the call is already
  // metered; honesty beats salvage here, unlike the JSON passes where tolerant parsing salvages).
  if (result.truncated) {
    return {
      ok: false,
      reason: 'TRUNCATED',
      message: 'The chapter was cut off before it finished. Please try again.',
    };
  }

  const drafted = stripSourceMarkers(result.text, tagToRef);
  if (drafted.markdown.trim().length === 0) {
    const { reason, message } = classifyParseOutcome(result.text, 'chapter');
    return { ok: false, reason, message };
  }

  // Pass 3 — an editor reads the draft against the doctrine and names what's wrong. An empty result is the
  // healthy answer (the chapter ships as drafted) AND the failure answer, so a critique that can't run
  // simply costs the chapter nothing.
  args.onPhase?.('critiquing');
  const findings = await critiqueChapter(deps, slice, {
    chapter: target,
    markdown: drafted.markdown,
    ...(plan ? { plan } : {}),
    system,
    // So an invented-events book isn't marked down for inventing (72 §4.1).
    truthMode: bookType.truthMode,
  });

  // Pass 4 — fix exactly what the critique found. The DRAFT stands on any failure: a revision that was cut
  // off, came back empty, or hit the budget must never replace a whole good chapter with part of one.
  let markdown = drafted.markdown;
  let provenance = drafted.provenance;
  if (findings.length > 0) {
    args.onPhase?.('revising');
    const revised = await reviseChapter(deps, slice, {
      chapter: target,
      markdown: drafted.markdown,
      findings,
      ...(preserve.length > 0 ? { preserve } : {}),
      system,
      maxTokens: CHAPTER_MAX_TOKENS,
    });
    if (revised.ok) {
      const stripped = stripSourceMarkers(revised.text, tagToRef);
      // The loop's guarantee is that it can never LOSE a chapter, and "non-empty" is not enough to keep it.
      // A revision that returns only the corrected paragraphs, or a chapter cut to a third, ends with
      // `end_turn` and plenty of text — it would replace the whole draft, and on a FIRST draft there is no
      // archived version to restore. So a collapse is refused like a truncation: keep the draft.
      const collapsed =
        countWords(stripped.markdown) < COLLAPSE_FLOOR * countWords(drafted.markdown);
      // Likewise a revision that drops its [[SRC:…]] markers. Empty provenance is worse than an empty
      // Sources panel: `computeSourceSignature` returns '' for a chapter citing nothing, and the freshness
      // engine skips chapters with no signature — so the chapter would silently stop noticing new material
      // for the rest of its life.
      const lostCitations = drafted.provenance.length > 0 && stripped.provenance.length === 0;
      if (stripped.markdown.trim().length > 0 && !collapsed && !lostCitations) {
        markdown = stripped.markdown;
        provenance = stripped.provenance;
      }
    }
  }

  // Re-read the chapter LIVE after the slowest call in the app: a pin / markup / image placement made while
  // the generation was in flight must not be reverted by the pre-call snapshot (mirrors applyMarkup below —
  // `existing` above is the pre-call read, kept only to seed the prompt's PRESERVE list). Null on a first draft.
  const live = await getChapter(deps.fs, deps.key, deps.personId, args.bookId, args.chapterId);
  // Code-enforce the person's protected/pinned words on EVERY generation path — the PRESERVE list above is
  // the first line of defense, this is the guarantee (§5.3/§5.4; previously only the revision path enforced,
  // so a stale-chapter auto-rewrite could silently drop the person's own words). Enforce against the LIVE set
  // so a passage pinned while the rewrite was in flight survives this rewrite too.
  const enforced = live
    ? enforceProtected(markdown, live.protectedBlocks, live.pinnedQuotes)
    : { markdown, reinserted: 0 };

  // Drafts are sacred (§13.9): archive the text this rewrite replaces before overwriting it.
  if (live && live.markdown.trim().length > 0) {
    await appendChapterVersion(deps.fs, deps.key, deps.personId, args.bookId, args.chapterId, {
      revision: live.revision,
      markdown: live.markdown,
      provenance: live.provenance,
      sourceSignature: live.sourceSignature,
      savedAt: deps.now.toISOString(),
      reason: 'rewrite',
    });
  }

  const chapter: BookChapter = {
    id: target.id,
    schemaVersion: 1,
    partId,
    order: target.order,
    title: target.title,
    markdown: enforced.markdown,
    revision: (live?.revision ?? 0) + 1,
    status: live ? 'updated' : 'new',
    // Stamp the freshness fingerprint from the corpus it was just written against (§5.4), so a later source
    // change flags this chapter stale.
    sourceSignature: computeSourceSignature(corpus, { provenance }),
    provenance,
    protectedBlocks: live?.protectedBlocks ?? [],
    pinnedQuotes: live?.pinnedQuotes ?? [],
    imagePlacements: live?.imagePlacements ?? [],
    lastGeneratedAt: deps.now.toISOString(),
    ...(live?.lastReviewedAt ? { lastReviewedAt: live.lastReviewedAt } : {}),
    // Keep the prior text so the "What changed" diff can show what a rewrite altered (§13.5). Only a rewrite of
    // existing prose has something to diff — a first draft ('new', no existing) carries none.
    ...(live?.markdown.trim() ? { previousMarkdown: live.markdown } : {}),
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
  onProgress?: (progress: {
    chaptersDone: number;
    chaptersTotal: number;
    title: string;
    craft?: StoryCraftPhase;
  }) => void,
): Promise<BookChaptersResult> {
  const outline = await getOutline(deps.fs, deps.key, deps.personId, bookId);
  if (!outline || outline.parts.length === 0) {
    return { ok: false, generated: 0, reason: 'ERROR', message: 'This book has no outline yet.' };
  }
  const corpus = await buildStoryCorpus(
    deps.fs,
    deps.key,
    deps.personId,
    bookId,
    await getExclusions(deps.fs, deps.key, deps.personId, bookId),
  );

  const chapters = outline.parts.flatMap((part) => part.chapters);
  // Progress reflects the whole book: already-written chapters count as done (a resumed draft picks up where it
  // left off), and `title` is the chapter about to be written.
  const total = chapters.length;
  let completed = 0; // chapters already done or completed this pass
  let generated = 0;
  let budgetHit = false;
  let allWritten = true;
  let lastFailure: { reason: AiFailureReason; message: string } | null = null;
  for (const chapter of chapters) {
    const existing = await getChapter(deps.fs, deps.key, deps.personId, bookId, chapter.id);
    // Skip a chapter that already HAS PROSE (idempotent/resumable). Drift is a proposal now, not a status
    // (72 §4.4), so this queue only ever writes first drafts — a rewrite is always an explicit act.
    if (existing && existing.markdown.trim().length > 0) {
      completed += 1;
      continue;
    }
    onProgress?.({ chaptersDone: completed, chaptersTotal: total, title: chapter.title });
    const res = await generateChapter(deps, {
      bookId,
      chapterId: chapter.id,
      corpus,
      // Re-emit the same counts with the live craft phase, so the UI shows movement WITHIN a chapter.
      onPhase: (craft) =>
        onProgress?.({
          chaptersDone: completed,
          chaptersTotal: total,
          title: chapter.title,
          craft,
        }),
    });
    if (res.ok) {
      generated += 1;
      completed += 1;
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

// --- The batch markup revision (§3.3.1/§5.3) -------------------------------------------------------------

/** The marks a batch revision applies: pending deletes, open addContext/fix comments, and open `ask` to-dos.
 *  A `question` comment (dialogue, not an edit), a `remind` to-do (personal), and a `questions` to-do (routes
 *  to the interview engine, §5.5) are all left untouched. */
export function pendingRevisionMarks(marks: MarkupMark[]): MarkupMark[] {
  return marks.filter((m) => {
    if (m.kind === 'delete') return m.status === 'pending';
    if (m.kind === 'comment') return m.status === 'open' && m.intent !== 'question';
    if (m.kind === 'todo') return m.status === 'open' && m.todoKind === 'ask';
    return false;
  });
}

/** Stamp an included mark as applied at the new revision (delete/comment → `applied`; `ask` to-do → `applied`). */
function markApplied(mark: MarkupMark, revision: number): MarkupMark {
  if (mark.kind === 'delete' || mark.kind === 'comment') {
    return { ...mark, status: 'applied', appliedRevision: revision };
  }
  return { ...mark, status: 'applied' };
}

/**
 * Apply a chapter's pending markup as ONE metered `story.chapter` revision (§3.3.1/§5.3): seed the model with
 * the current prose + each pending mark rendered as an instruction, re-cite for fresh provenance, then
 * code-enforce the protected/pinned passages (`enforceProtected` — never trust the prompt alone) and persist.
 * On success the chapter goes `updated` (revision bumped) and every included mark → `applied`. Instant marks
 * (inline edit, pin) are already in the chapter; excluded material is filtered at the corpus boundary. Returns
 * an honest failure on an empty/unparseable reply, or a no-op error when there's nothing pending.
 */
export async function applyMarkup(
  deps: AiDeps,
  args: { bookId: string; chapterId: string },
): Promise<ChapterResult> {
  const book = await getBook(deps.fs, deps.key, deps.personId, args.bookId);
  if (!book) return { ok: false, reason: 'ERROR', message: 'That book is no longer here.' };
  const bookType = getBookType(book.type);
  if (!bookType) return { ok: false, reason: 'ERROR', message: 'Unknown book type.' };
  const existing = await getChapter(deps.fs, deps.key, deps.personId, args.bookId, args.chapterId);
  if (!existing) return { ok: false, reason: 'ERROR', message: 'That chapter is no longer here.' };

  const markup: ChapterMarkup = await getMarkup(
    deps.fs,
    deps.key,
    deps.personId,
    args.bookId,
    args.chapterId,
  );
  const pending = pendingRevisionMarks(markup.marks);
  if (pending.length === 0) {
    return { ok: false, reason: 'ERROR', message: 'There are no changes to apply yet.' };
  }

  const exclusions = await getExclusions(deps.fs, deps.key, deps.personId, args.bookId);
  const corpus = await buildStoryCorpus(deps.fs, deps.key, deps.personId, args.bookId, exclusions);
  // Revising ONE chapter — slice to that chapter's relevant material within budget (§17.1); if the outline
  // entry is somehow gone, still cap the whole corpus so a long life can't blow the window.
  const outline = await getOutline(deps.fs, deps.key, deps.personId, args.bookId);
  const outlineChapter = outline?.parts
    .flatMap((p) => p.chapters)
    .find((c) => c.id === args.chapterId);
  const source = outlineChapter
    ? sliceCorpusForChapter(corpus, outlineChapter)
    : budgetCorpus(corpus, { tokenBudget: CHAPTER_CORPUS_TOKEN_BUDGET });
  const tagged = tagCorpusItems(source);
  const tagToRef = new Map(tagged.map((t) => [t.tag, t.sourceRef]));
  const system = buildBiographerSystem(
    bookType,
    book.config,
    corpus.personName,
    undefined,
    await resolvePersonOptionNames(deps.fs, deps.key, bookType, book.config.typeOptions),
  );
  const user = buildRevisionUserMessage(source, tagged, {
    chapter: existing,
    marks: pending,
    exclusions,
  });

  const result = await runClaude(deps, system, user, 'story.chapter', CHAPTER_MAX_TOKENS);
  if (!result.ok) return { ok: false, reason: result.reason, message: result.message };
  // A truncated revision is worse than a failed one: the model returns the FULL revised chapter, so a
  // half-length reply would replace the whole text. Refuse honestly (already metered) — see generateChapter.
  if (result.truncated) {
    return {
      ok: false,
      reason: 'TRUNCATED',
      message: 'The revision was cut off before it finished. Please try again.',
    };
  }

  const stripped = stripSourceMarkers(result.text, tagToRef);
  if (stripped.markdown.trim().length === 0) {
    const { reason, message } = classifyParseOutcome(result.text, 'chapter');
    return { ok: false, reason, message };
  }

  // Re-read both records before writing. `existing`/`markup` predate the chapter rewrite — the slowest
  // call in the app — so spreading them would revert whatever landed meanwhile: `imagePlacements`
  // (setImagePlacement), `order`/`partId` (syncPartChapterOrder), and any mark the user added during the
  // revision. Only the rewritten text and its provenance are ours. (`generateChapter` above re-reads live
  // after its call the same way.)
  const liveChapter =
    (await getChapter(deps.fs, deps.key, deps.personId, args.bookId, args.chapterId)) ?? existing;
  // Code-enforce the person's protected/pinned words — the prompt asked, but the guarantee is code
  // (§5.3/§5.4). Enforce against the LIVE chapter's set: a passage pinned while the slow revision call was
  // in flight must survive this revision too, not just the next one.
  const enforced = enforceProtected(
    stripped.markdown,
    liveChapter.protectedBlocks,
    liveChapter.pinnedQuotes,
  );
  // Drafts are sacred (§13.9): archive the text this revision replaces before overwriting it.
  if (liveChapter.markdown.trim().length > 0) {
    await appendChapterVersion(deps.fs, deps.key, deps.personId, args.bookId, args.chapterId, {
      revision: liveChapter.revision,
      markdown: liveChapter.markdown,
      provenance: liveChapter.provenance,
      sourceSignature: liveChapter.sourceSignature,
      savedAt: deps.now.toISOString(),
      reason: 'revision',
    });
  }
  const chapter: BookChapter = {
    ...liveChapter,
    markdown: enforced.markdown,
    revision: liveChapter.revision + 1,
    status: 'updated',
    provenance: stripped.provenance,
    // Re-stamp the freshness fingerprint against the corpus this revision was written from (§5.4).
    sourceSignature: computeSourceSignature(corpus, { provenance: stripped.provenance }),
    lastGeneratedAt: deps.now.toISOString(),
    // The pre-revision text drives the "What changed" diff (§13.5); cleared when the chapter is Reviewed.
    previousMarkdown: liveChapter.markdown,
  };
  await saveChapter(deps.fs, deps.key, deps.personId, args.bookId, chapter);

  // Stamp every applied mark; leave the rest (questions, reminders, dismissed) as they were.
  const includedIds = new Set(pending.map((m) => m.id));
  const liveMarkup =
    (await getMarkup(deps.fs, deps.key, deps.personId, args.bookId, args.chapterId)) ?? markup;
  const marks = liveMarkup.marks.map((m) =>
    includedIds.has(m.id) ? markApplied(m, chapter.revision) : m,
  );
  await saveMarkup(deps.fs, deps.key, deps.personId, args.bookId, { ...liveMarkup, marks });
  // Keep the book-level to-do roll-up in step — an applied `ask` to-do must flip to `applied` there too, or
  // the overview's one-read list would show it still open (the roll-up is denormalized; §3.3.2).
  await syncChapterTodos(deps.fs, deps.key, deps.personId, args.bookId, args.chapterId, marks);

  return { ok: true, chapter };
}

// --- Answer-the-author: the biographer answers a "question" comment (§3.3) -------------------------------

/** A short, grounded reply — never a chapter. */
const ANSWER_MAX_TOKENS = 800;

export type AnswerAuthorResult =
  | { ok: true; markup: ChapterMarkup; answer: string }
  | { ok: false; reason: AiFailureReason; message: string };

/**
 * Answer a `question`-intent comment (§3.3 — "answer the author"): the person asked their biographer about a
 * passage, and the biographer replies grounded in the SOURCE MATERIAL that paragraph actually drew on (its
 * provenance, resolved to corpus items) — closing the dead-end where a question comment was recorded but never
 * answered. Metered `story.answer`; the reply is stored on the comment mark (`answer` + `answeredAt`) so it
 * renders at the paragraph and survives navigation. No chapter rewrite; a non-question mark is refused.
 */
export async function answerAuthorQuestion(
  deps: AiDeps,
  args: { bookId: string; chapterId: string; markId: string },
): Promise<AnswerAuthorResult> {
  const book = await getBook(deps.fs, deps.key, deps.personId, args.bookId);
  if (!book) return { ok: false, reason: 'ERROR', message: 'That book is no longer here.' };
  const bookType = getBookType(book.type);
  if (!bookType) return { ok: false, reason: 'ERROR', message: 'Unknown book type.' };
  const chapter = await getChapter(deps.fs, deps.key, deps.personId, args.bookId, args.chapterId);
  if (!chapter) return { ok: false, reason: 'ERROR', message: 'That chapter is no longer here.' };
  const markup = await getMarkup(deps.fs, deps.key, deps.personId, args.bookId, args.chapterId);
  const mark = markup.marks.find((m) => m.id === args.markId);
  if (!mark || mark.kind !== 'comment' || mark.intent !== 'question') {
    return { ok: false, reason: 'ERROR', message: 'That question is no longer here.' };
  }

  // Resolve the asked paragraph + the corpus items its provenance cited. The comment's anchor is paragraph-
  // level (`p<i>`); map that paragraph's provenance refs to their corpus items so the reply is grounded.
  const paras = chapterParagraphs(chapter.markdown);
  const m = /^p(\d+)$/.exec(mark.anchor.paragraphId);
  const paraIndex = m ? Number(m[1]) : -1;
  const paragraph =
    paraIndex >= 0 && paraIndex < paras.length ? paras[paraIndex]! : chapter.markdown;
  const corpus = await buildStoryCorpus(
    deps.fs,
    deps.key,
    deps.personId,
    args.bookId,
    await getExclusions(deps.fs, deps.key, deps.personId, args.bookId),
  );
  const byRefId = new Map(corpus.items.map((it) => [it.sourceRef.id, it]));
  const citedIds = new Set(
    chapter.provenance
      .filter((p) => p.anchor === mark.anchor.paragraphId)
      .flatMap((p) => p.refs.map((r) => r.id)),
  );
  const sources = [...citedIds]
    .map((id) => byRefId.get(id))
    .filter((it): it is CorpusItem => Boolean(it));

  const system = buildBiographerSystem(
    bookType,
    book.config,
    corpus.personName,
    undefined,
    await resolvePersonOptionNames(deps.fs, deps.key, bookType, book.config.typeOptions),
  );
  const user = buildAnswerAuthorMessage({
    personName: corpus.personName,
    chapterTitle: chapter.title,
    paragraph,
    question: mark.text,
    sources,
  });
  const result = await runClaude(deps, system, user, 'story.answer', ANSWER_MAX_TOKENS);
  if (!result.ok) return { ok: false, reason: result.reason, message: result.message };
  const answer = result.text.trim();
  if (answer.length === 0) {
    const { reason, message } = classifyParseOutcome(result.text, 'answer');
    return { ok: false, reason, message };
  }

  // Re-read + store the answer on the mark (the model call is slow; a mark may have been added meanwhile).
  const live = await getMarkup(deps.fs, deps.key, deps.personId, args.bookId, args.chapterId);
  const updated: ChapterMarkup = {
    ...live,
    marks: live.marks.map((mk) =>
      mk.id === args.markId && mk.kind === 'comment'
        ? { ...mk, answer, answeredAt: deps.now.toISOString() }
        : mk,
    ),
  };
  await saveMarkup(deps.fs, deps.key, deps.personId, args.bookId, updated);
  return { ok: true, markup: updated, answer };
}

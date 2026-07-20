import { z } from 'zod';
import { classifyParseOutcome, extractJsonObject, tolerantArray } from '../ai';
import { uuid } from '../id';
import { listInsightsForPerson } from '../insights';
import type {
  AiFailureReason,
  BookChapter,
  BookOutline,
  QuestionnaireInput,
  StoryAnsweredCheckIn,
  StoryCheckInResult,
  StoryCompleteness,
  StoryCompletenessStage,
  StoryFrameworkCoverage,
  StoryGap,
  StoryGapsView,
  StoryInterviewCadenceResult,
  StoryInterviewOutcome,
  StoryPartCoverage,
  UsageEvent,
} from '../schemas';
import {
  createAssignment,
  getAssignment,
  listAssignments,
  updateAssignmentStatus,
} from '../questionnaires/assignmentService';
import { type AiDeps, generateQuestions, runClaude } from '../questionnaires/generationService';
import {
  getQuestionnaire,
  saveQuestionnaire,
  validateQuestionnaire,
} from '../questionnaires/questionnaireService';
import { getResponse } from '../questionnaires/responseService';
import { queryUsage } from '../usage';
import { MCADAMS_SCENES, getBookType } from './bookTypes';
import { buildStoryCorpus, type StoryCorpus } from './storyCorpus';
import { buildBiographerSystem, buildGapPassUserMessage } from './storyPromptBuilder';
import {
  getBook,
  getExclusions,
  getInterviewState,
  getOutline,
  listChapters,
  saveInterviewState,
} from './storyService';

/**
 * The Your Story interview bridge (64-your-story §3.3.2/§5.5) — the ONE path that turns a to-do into a targeted
 * story check-in. It reuses the existing questionnaire pipeline verbatim (`generateQuestions` → `saveQuestionnaire`
 * → `createAssignment`), differing only in the FOCUS (the to-do text) and the `storyProvenance` stamp. The full
 * interview engine (the McAdams gap pass) is a later phase; this is the single mint the markup layer needs.
 *
 * The check-in is a SELF-send: the book's subject is the active person, so the questions are for them, delivered
 * to their own Inbox with the biographer eyebrow. Metered `questionnaire.generate` via `generateQuestions` +
 * budget-gated; the caller (bridge) also short-circuits when AI is off.
 */

const STORY_CHECKIN_COUNT = 4;

/**
 * Mint a story check-in whose FOCUS is the given to-do text, delivered as an in-app self-send. Returns the new
 * assignment id (so the caller can stamp the to-do `questionsSent` + `assignmentId`), or an honest failure —
 * on which NOTHING is persisted (no orphan questionnaire, no half-sent to-do).
 */
export async function mintStoryCheckInFromTodo(
  deps: AiDeps,
  args: { bookId: string; focus: string },
): Promise<StoryCheckInResult> {
  const focus = args.focus.trim();
  if (focus.length === 0) {
    return { ok: false, reason: 'ERROR', message: 'This to-do has no text to ask about.' };
  }

  const gen = await generateQuestions(deps, {
    type: 'general',
    sensitivity: 'standard',
    brief: `Your biographer wants to go deeper on this for the book: ${focus}`,
    context: {
      authorPersonId: deps.personId,
      includeAuthor: true,
      includeTarget: false,
      includeRelationship: false,
    },
    existingPrompts: [],
    count: STORY_CHECKIN_COUNT,
  });
  if (!gen.ok) {
    return {
      ok: false,
      reason: gen.reason ?? 'ERROR',
      message: gen.message ?? 'Couldn’t generate those questions. Try again.',
    };
  }
  const questions = gen.questions ?? [];
  if (questions.length === 0) {
    return { ok: false, reason: 'MALFORMED', message: 'No questions came back — try again.' };
  }

  const draft: QuestionnaireInput = {
    title: gen.title?.trim() || 'A few questions for your story',
    type: 'general',
    sensitivity: 'standard',
    recipient: { kind: 'person', personId: deps.personId },
    questions,
    storyProvenance: {
      bookId: args.bookId,
      gapBrief: focus.slice(0, 280),
      generatedAt: deps.now.toISOString(),
    },
  };
  // Generation can emit an authoring-only answer type (matrix/allocation/…) that `createAssignment` would
  // reject by throwing — pre-validate so a bad draft fails cleanly with nothing persisted.
  if (validateQuestionnaire(draft).length > 0) {
    return {
      ok: false,
      reason: 'MALFORMED',
      message: 'Those questions didn’t come out sendable — try again.',
    };
  }

  try {
    const questionnaire = await saveQuestionnaire(deps.fs, deps.key, draft, deps.personId);
    const assignment = await createAssignment(deps.fs, deps.key, {
      questionnaireId: questionnaire.id,
      senderPersonId: deps.personId,
      recipient: { kind: 'person', personId: deps.personId },
      channel: 'inApp',
      privacy: 'standard',
      senderVisibleToRecipient: true,
    });
    return { ok: true, assignmentId: assignment.id };
  } catch {
    return { ok: false, reason: 'ERROR', message: 'Couldn’t send those questions. Try again.' };
  }
}

// --- The gap engine: completeness + the gap pass (§3.6/§3.7/§5.5) ----------------------------------------

/** How far along a story is, derived deterministically from the framework coverage (no AI). The 12 dimensions:
 *  the eight McAdams scenes + life-chapters + challenges + ideology + future-script. Owner decision (2026-07-16):
 *  a QUALITATIVE stage + a subtle ratio, never a bare percentage. */
export function computeStoryCompleteness(coverage: StoryFrameworkCoverage): StoryCompleteness {
  const total = MCADAMS_SCENES.length + 4;
  let covered = 0;
  if (coverage.chapters) covered += 1;
  for (const s of MCADAMS_SCENES) if (coverage.scenes[s.key]) covered += 1;
  if (coverage.challenges) covered += 1;
  if (coverage.ideology) covered += 1;
  if (coverage.futureScript) covered += 1;
  const ratio = total > 0 ? covered / total : 0;
  const stage: StoryCompletenessStage =
    ratio >= 0.8
      ? 'richlyTold'
      : ratio >= 0.5
        ? 'comingTogether'
        : ratio >= 0.25
          ? 'takingShape'
          : 'beginning';
  return { stage, ratio, covered, total };
}

/** The book's current completeness — a cheap read from the stored coverage (no AI, no spend). */
export async function getStoryCompleteness(
  fs: AiDeps['fs'],
  key: Uint8Array,
  personId: string,
  bookId: string,
): Promise<StoryCompleteness> {
  const interview = await getInterviewState(fs, key, personId, bookId);
  return computeStoryCompleteness(interview.frameworkCoverage);
}

const GAP_MAX_TOKENS = 3000;
const MAX_GAPS = 6;

const GapItemSchema = z.object({
  dimension: z.string().catch(''),
  label: z.string().catch(''),
  focus: z.string().catch(''),
  priority: z.number().catch(0),
});
const GapDraftSchema = z.object({
  coverage: z
    .object({
      chapters: z.boolean().optional().catch(undefined),
      scenes: z.record(z.string(), z.boolean()).optional().catch(undefined),
      challenges: z.boolean().optional().catch(undefined),
      ideology: z.boolean().optional().catch(undefined),
      futureScript: z.boolean().optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
  gaps: tolerantArray(
    GapItemSchema,
    { dimension: '', label: '', focus: '', priority: 0 },
    (g) => g.focus.trim().length > 0,
  ).catch([]),
  // Per-part coverage for the life map (§13.6.4): partId → 0..1 how richly told. Tolerant; a missing/invalid
  // reading falls back to the written/reviewed ratio host-side.
  partCoverage: z.record(z.string(), z.number()).optional().catch(undefined),
});

export type GapPassResult =
  | { ok: true; completeness: StoryCompleteness; gaps: StoryGap[]; usage?: UsageEvent }
  | { ok: false; reason: AiFailureReason; message: string };

/**
 * Score the book against the McAdams framework + craft needs (§3.7): a metered `story.interview` pass that reads
 * the outline + drafted chapters + corpus, decides which dimensions the material genuinely covers ("take no one
 * at their word"), and emits the prioritized GAPS worth interviewing for. PERSISTS the refreshed coverage (+
 * `lastGapPassAt`) to `interview.enc` and returns the completeness + gaps. Meter-before-parse; an unparseable
 * reply is an honest failure; a book with no outline yet is a no-op (nothing to score, no spend).
 */
export async function runGapPass(
  deps: AiDeps,
  args: { bookId: string; corpus?: StoryCorpus },
): Promise<GapPassResult> {
  const book = await getBook(deps.fs, deps.key, deps.personId, args.bookId);
  if (!book) return { ok: false, reason: 'ERROR', message: 'That book is no longer here.' };
  const bookType = getBookType(book.type);
  if (!bookType) return { ok: false, reason: 'ERROR', message: 'Unknown book type.' };
  const outline = await getOutline(deps.fs, deps.key, deps.personId, args.bookId);
  const chapterCount = outline?.parts.reduce((n, p) => n + p.chapters.length, 0) ?? 0;
  const interview = await getInterviewState(deps.fs, deps.key, deps.personId, args.bookId);
  // Nothing to score yet — return the current completeness without spending.
  if (!outline || chapterCount === 0) {
    return {
      ok: true,
      completeness: computeStoryCompleteness(interview.frameworkCoverage),
      gaps: [],
    };
  }

  const chapters = await listChapters(deps.fs, deps.key, deps.personId, args.bookId);
  const corpus =
    args.corpus ??
    (await buildStoryCorpus(
      deps.fs,
      deps.key,
      deps.personId,
      args.bookId,
      await getExclusions(deps.fs, deps.key, deps.personId, args.bookId),
    ));
  const system = buildBiographerSystem(bookType, book.config, corpus.personName);
  const user = buildGapPassUserMessage(corpus, {
    outline,
    chapters,
    framework: bookType.interview,
    askedPrompts: interview.askedPrompts,
    ...(book.essence ? { essence: book.essence } : {}),
  });

  const result = await runClaude(deps, system, user, 'story.interview', GAP_MAX_TOKENS);
  if (!result.ok) return { ok: false, reason: result.reason, message: result.message };

  // Usage is already recorded (meter-before-parse). An unparseable reply is an honest failure.
  const json = extractJsonObject(result.text);
  if (!json) {
    const { reason, message } = classifyParseOutcome(result.text, 'gaps');
    return { ok: false, reason, message };
  }
  const draft = GapDraftSchema.parse(json);

  // Build the coverage from the draft, normalizing the scene keys against the fixed framework (drop invented ones).
  const scenes: Record<string, boolean> = {};
  for (const s of MCADAMS_SCENES) scenes[s.key] = Boolean(draft.coverage?.scenes?.[s.key]);
  const coverage: StoryFrameworkCoverage = {
    chapters: Boolean(draft.coverage?.chapters),
    scenes,
    challenges: Boolean(draft.coverage?.challenges),
    ideology: Boolean(draft.coverage?.ideology),
    futureScript: Boolean(draft.coverage?.futureScript),
  };
  const gaps: StoryGap[] = (draft.gaps ?? [])
    .filter((g) => g.focus.trim().length > 0)
    .map((g) => ({
      id: uuid(),
      dimension: g.dimension.trim(),
      label: g.label.trim() || 'Something worth telling',
      focus: g.focus.trim(),
      priority: g.priority,
    }))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, MAX_GAPS);

  // Per-part coverage for the life map (§13.6.4): the model's reading where valid (clamped 0..1), else the
  // deterministic written/reviewed fallback.
  const partCoverage = computePartCoverage(outline, chapters, draft.partCoverage);

  // Re-read: `interview` predates the gap-pass model call, and this record holds `photoAnswers` (typed
  // prose) plus `askedPrompts`/`openCheckinAssignmentId` that other paths write — so spreading the stale
  // copy would revert a photo answer saved during the pass. Same rule already noted below for `after`.
  const liveInterview =
    (await getInterviewState(deps.fs, deps.key, deps.personId, args.bookId)) ?? interview;
  await saveInterviewState(deps.fs, deps.key, deps.personId, args.bookId, {
    ...liveInterview,
    frameworkCoverage: coverage,
    lastGaps: gaps,
    lastPartCoverage: partCoverage,
    lastGapPassAt: deps.now.toISOString(),
  });

  return {
    ok: true,
    completeness: computeStoryCompleteness(coverage),
    gaps,
    ...(result.usage ? { usage: result.usage } : {}),
  };
}

/**
 * Per-part coverage for the life map (§13.6.4): prefer the model's clamped 0..1 reading per part; fall back to
 * the deterministic written/reviewed ratio (a reviewed chapter = 1, a written-not-reviewed = 0.5, unwritten = 0).
 */
export function computePartCoverage(
  outline: BookOutline,
  chapters: BookChapter[],
  modelReading?: Record<string, number>,
): StoryPartCoverage[] {
  const byId = new Map(chapters.map((c) => [c.id, c]));
  return outline.parts.map((part) => {
    const model = modelReading?.[part.id];
    if (typeof model === 'number' && Number.isFinite(model)) {
      return { partId: part.id, score: Math.max(0, Math.min(1, model)) };
    }
    if (part.chapters.length === 0) return { partId: part.id, score: 0 };
    const total = part.chapters.reduce((sum, oc) => {
      const chapter = byId.get(oc.id);
      const written = (chapter?.markdown.trim().length ?? 0) > 0;
      return sum + (chapter?.status === 'reviewed' ? 1 : written ? 0.5 : 0);
    }, 0);
    return { partId: part.id, score: total / part.chapters.length };
  });
}

/**
 * The persisted gap-pass output for the Interview tab (§13.6.3) — FREE, no AI. Reads `interview.enc`; part
 * coverage falls back to the written/reviewed ratio when a pass hasn't persisted one yet.
 */
export async function getStoryGaps(
  fs: AiDeps['fs'],
  key: Uint8Array,
  personId: string,
  bookId: string,
): Promise<StoryGapsView> {
  const interview = await getInterviewState(fs, key, personId, bookId);
  const outline = await getOutline(fs, key, personId, bookId);
  const chapters = await listChapters(fs, key, personId, bookId);
  // The persisted per-part coverage reflects the AI reading AT THE LAST GAP PASS — it doesn't move as chapters
  // are written/reviewed until the next pass (a model reading can't be recomputed without AI). Before any pass,
  // the live written/reviewed ratio fills in.
  const partCoverage =
    interview.lastPartCoverage ?? (outline ? computePartCoverage(outline, chapters) : []);
  return {
    gaps: interview.lastGaps ?? [],
    partCoverage,
    ...(interview.lastGapPassAt ? { lastGapPassAt: interview.lastGapPassAt } : {}),
    hasOpenCheckin: Boolean(interview.openCheckinAssignmentId),
  };
}

/** Statuses that mean an open check-in has resolved (so "Ask me about this" is free again). */
const RESOLVED_CHECKIN_STATUSES = new Set([
  'submitted',
  'analyzed',
  'declined',
  'expired',
  'revoked',
]);

/**
 * "Ask me about this" (§13.6.5) — the EXPLICIT, user-triggered mint of a check-in from a specific persisted gap,
 * the same self-send path the auto-cadence + the to-do use. Honors the ≤1-open-check-in invariant: refuses while
 * one is genuinely still open (answer that one first), but proceeds if the prior one has resolved.
 */
export async function askGap(
  deps: AiDeps,
  args: { bookId: string; gapId: string },
): Promise<StoryCheckInResult> {
  const interview = await getInterviewState(deps.fs, deps.key, deps.personId, args.bookId);
  if (interview.openCheckinAssignmentId) {
    const open = await getAssignment(deps.fs, deps.key, interview.openCheckinAssignmentId);
    if (open && !RESOLVED_CHECKIN_STATUSES.has(open.status)) {
      return {
        ok: false,
        reason: 'ERROR',
        message: 'A check-in is already waiting in your Inbox — answer that one first.',
      };
    }
  }
  const gap = (interview.lastGaps ?? []).find((g) => g.id === args.gapId);
  if (!gap) {
    return {
      ok: false,
      reason: 'ERROR',
      message: 'That gap is no longer here — try “Find what’s missing” again.',
    };
  }
  const mint = await mintStoryCheckInFromTodo(deps, { bookId: args.bookId, focus: gap.focus });
  if (!mint.ok) return mint;
  // Re-read (the assignment write may have touched interview state elsewhere) then stamp the new open check-in.
  const after = await getInterviewState(deps.fs, deps.key, deps.personId, args.bookId);
  await saveInterviewState(deps.fs, deps.key, deps.personId, args.bookId, {
    ...after,
    askedPrompts: [...after.askedPrompts, gap.focus].slice(-50),
    openCheckinAssignmentId: mint.assignmentId,
  });
  return mint;
}

/**
 * The answered biographer check-ins (§13.6.5) — submitted/analyzed story-provenance assignments for this book,
 * newest-first. Deterministic, no AI. Each is joined "wove into <chapter>" WHERE DERIVABLE: the answer's
 * analysis produces an Insight (`provenance.assignmentId` = the check-in), and a chapter cites that insight in
 * its paragraph provenance — so the linkage appears once the insight is analyzed + a chapter that draws on it
 * is (re)drafted. Absent otherwise (a just-answered, not-yet-woven check-in shows no chapter, honestly).
 */
export async function listAnsweredStoryCheckIns(
  fs: AiDeps['fs'],
  key: Uint8Array,
  personId: string,
  bookId: string,
): Promise<StoryAnsweredCheckIn[]> {
  const assignments = await listAssignments(fs, key, { senderPersonId: personId });

  // assignmentId → the id of the Insight that analyzing that answer produced (the deterministic link key).
  const insightForAssignment = new Map<string, string>();
  for (const insight of await listInsightsForPerson(fs, key, personId)) {
    const aId = insight.provenance.assignmentId;
    if (aId) insightForAssignment.set(aId, insight.id);
  }
  // insightId → the title of the FIRST chapter (in `listChapters`' canonical order) whose paragraph provenance
  // cites that insight. Every citing chapter is a correct "wove into" answer, so among the rare multi-citation
  // case we just take the first the app would list.
  const chapterForInsight = new Map<string, string>();
  for (const chapter of await listChapters(fs, key, personId, bookId)) {
    for (const entry of chapter.provenance) {
      for (const ref of entry.refs) {
        if (ref.kind === 'insight' && !chapterForInsight.has(ref.id)) {
          chapterForInsight.set(ref.id, chapter.title);
        }
      }
    }
  }

  const out: StoryAnsweredCheckIn[] = [];
  for (const a of assignments) {
    if (a.status !== 'submitted' && a.status !== 'analyzed') continue;
    // Per-item guard: a single corrupt/undecryptable questionnaire or response skips only that entry rather
    // than blanking the whole history (this join reads three files per assignment).
    try {
      const q = await getQuestionnaire(fs, key, a.questionnaireId);
      if (q?.storyProvenance?.bookId !== bookId) continue;
      const response = await getResponse(fs, key, a.id);
      const insightId = insightForAssignment.get(a.id);
      const wroteIntoChapterTitle = insightId ? chapterForInsight.get(insightId) : undefined;
      out.push({
        assignmentId: a.id,
        title: q.title,
        answeredAt: response?.submittedAt ?? a.updatedAt,
        ...(wroteIntoChapterTitle ? { wroteIntoChapterTitle } : {}),
      });
    } catch {
      continue;
    }
  }
  return out; // listAssignments already sorts newest-first
}

// --- The autonomous interview cadence (§3.7 — the spec-63 loop) ------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
/** The AUTO cadence re-checks for gaps at most this often (the spec-63 base interval; a manual check bypasses). */
export const STORY_INTERVIEW_INTERVAL_DAYS = 7;
/** An ignored open check-in lapses after this so the loop isn't blocked forever (spec-63 AUTO_CHECKIN_EXPIRY_DAYS). */
export const STORY_CHECKIN_EXPIRY_DAYS = 14;
/** A hard weekly cap on gap passes (protects the MANUAL path, which bypasses the interval throttle). */
export const STORY_INTERVIEW_WEEKLY_CAP = 2;

/** An open check-in is one the person still hasn't answered (nor declined). */
const PENDING_STATUSES = new Set(['sent', 'opened', 'inProgress']);

/**
 * The autonomous interview loop (§3.7, owner decision 2026-07-16 = the spec-63 cadence): when warranted, run a
 * gap pass and mint ONE story check-in from the top gap into the person's Inbox. Self-pacing + gentle:
 *  - never spends during a crisis (`auto` + `crisis`);
 *  - keeps AT MOST ONE open check-in at a time — while one is unanswered it mints nothing (the back-off), and an
 *    ignored one lapses after `STORY_CHECKIN_EXPIRY_DAYS` so the loop isn't blocked forever;
 *  - the AUTO cadence re-checks at most every `STORY_INTERVIEW_INTERVAL_DAYS`; a manual check bypasses that but
 *    both are bounded by `STORY_INTERVIEW_WEEKLY_CAP` gap passes / rolling 7 days.
 * When the open check-in is answered, the corpus grows → the next gap pass re-scores it covered and the next
 * refresh stales the relevant chapter; this call clears the resolved id so the loop can mint the next gap.
 */
export async function runStoryInterviewCadence(
  deps: AiDeps,
  args: { bookId: string; auto: boolean; crisis?: boolean },
): Promise<StoryInterviewCadenceResult> {
  // The cadence never spends during an active crisis (§8).
  if (args.auto && args.crisis) return { outcome: 'crisis' };

  const book = await getBook(deps.fs, deps.key, deps.personId, args.bookId);
  const outline = book ? await getOutline(deps.fs, deps.key, deps.personId, args.bookId) : null;
  const chapterCount = outline?.parts.reduce((n, p) => n + p.chapters.length, 0) ?? 0;
  if (!book || !outline || chapterCount === 0) return { outcome: 'noBook' };

  const interview = await getInterviewState(deps.fs, deps.key, deps.personId, args.bookId);

  // ≤1 open check-in. A still-unanswered one blocks a new mint (the back-off). An ANSWERED one lets the loop
  // continue (reward engagement — the flag is cleared below). An IGNORED one that has lapsed is expired + we
  // back off this run (don't pile a second check-in on someone who isn't answering).
  if (interview.openCheckinAssignmentId) {
    const a = await getAssignment(deps.fs, deps.key, interview.openCheckinAssignmentId);
    if (a && PENDING_STATUSES.has(a.status)) {
      const lapsed =
        deps.now.getTime() - Date.parse(a.createdAt) > STORY_CHECKIN_EXPIRY_DAYS * DAY_MS;
      if (!lapsed) return { outcome: 'openCheckin' };
      await updateAssignmentStatus(deps.fs, deps.key, a.id, 'expired');
      await saveInterviewState(deps.fs, deps.key, deps.personId, args.bookId, {
        ...interview,
        openCheckinAssignmentId: undefined,
      });
      return { outcome: 'throttled' }; // backed off; a future interval may mint a fresh gap
    }
    // Resolved / gone → clear the flag so the loop can mint the next gap (the saves below own it).
  }

  // The AUTO cadence re-checks at most every interval (the last gap pass drives it); manual bypasses.
  if (args.auto && interview.lastGapPassAt) {
    const since = deps.now.getTime() - Date.parse(interview.lastGapPassAt);
    if (since < STORY_INTERVIEW_INTERVAL_DAYS * DAY_MS) {
      return await clearOpenIfResolved(deps, args.bookId, interview, 'throttled');
    }
  }
  // Both cadences are bounded by the weekly cap (protects the manual path from spamming the gap pass).
  const weekAgo = new Date(deps.now.getTime() - 7 * DAY_MS).toISOString();
  const passes = await queryUsage(deps.fs, deps.key, {
    from: weekAgo,
    to: deps.now.toISOString(),
    personId: deps.personId,
    type: 'story.interview',
  });
  if (passes.length >= STORY_INTERVIEW_WEEKLY_CAP) {
    return await clearOpenIfResolved(deps, args.bookId, interview, 'throttled');
  }

  // Run the gap pass (persists coverage + lastGapPassAt).
  const pass = await runGapPass(deps, { bookId: args.bookId });
  if (!pass.ok) {
    return await clearOpenIfResolved(deps, args.bookId, interview, 'noGaps');
  }
  const top = pass.gaps[0];
  if (!top) {
    // The gap pass already persisted fresh coverage + lastGapPassAt — clear a resolved flag ON TOP of THAT
    // (re-read `after`, not the stale top-level `interview`, or we'd revert the fresh coverage/throttle stamp).
    const after = await getInterviewState(deps.fs, deps.key, deps.personId, args.bookId);
    if (after.openCheckinAssignmentId) {
      await saveInterviewState(deps.fs, deps.key, deps.personId, args.bookId, {
        ...after,
        openCheckinAssignmentId: undefined,
      });
    }
    return { outcome: 'noGaps', completeness: pass.completeness };
  }

  // Mint ONE check-in from the top gap (the same self-send path the markup to-do uses).
  const mint = await mintStoryCheckInFromTodo(deps, { bookId: args.bookId, focus: top.focus });
  // Re-read: the gap pass persisted fresh coverage/lastGapPassAt — build the final save on top of THAT.
  const after = await getInterviewState(deps.fs, deps.key, deps.personId, args.bookId);
  if (!mint.ok) {
    await saveInterviewState(deps.fs, deps.key, deps.personId, args.bookId, {
      ...after,
      askedPrompts: after.askedPrompts,
      openCheckinAssignmentId: undefined,
    });
    return { outcome: 'noGaps', completeness: pass.completeness };
  }
  await saveInterviewState(deps.fs, deps.key, deps.personId, args.bookId, {
    ...after,
    askedPrompts: [...after.askedPrompts, top.focus].slice(-50),
    openCheckinAssignmentId: mint.assignmentId,
  });
  return { outcome: 'minted', assignmentId: mint.assignmentId, completeness: pass.completeness };
}

/** A no-spend early return that still clears a resolved/lapsed open-check-in flag so the loop can advance. */
async function clearOpenIfResolved(
  deps: AiDeps,
  bookId: string,
  interview: Awaited<ReturnType<typeof getInterviewState>>,
  outcome: StoryInterviewOutcome,
  completeness?: StoryCompleteness,
): Promise<StoryInterviewCadenceResult> {
  if (interview.openCheckinAssignmentId) {
    await saveInterviewState(deps.fs, deps.key, deps.personId, bookId, {
      ...interview,
      openCheckinAssignmentId: undefined,
    });
  }
  return { outcome, ...(completeness ? { completeness } : {}) };
}

import { z } from 'zod';
import { classifyParseOutcome, extractJsonObject, tolerantArray } from '../ai';
import type {
  AiFailureReason,
  QuestionnaireInput,
  StoryCompleteness,
  StoryCompletenessStage,
  StoryFrameworkCoverage,
  StoryGap,
  StoryInterviewCadenceResult,
  StoryInterviewOutcome,
  UsageEvent,
} from '../schemas';
import {
  createAssignment,
  getAssignment,
  updateAssignmentStatus,
} from '../questionnaires/assignmentService';
import { type AiDeps, generateQuestions, runClaude } from '../questionnaires/generationService';
import { saveQuestionnaire, validateQuestionnaire } from '../questionnaires/questionnaireService';
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

export type StoryCheckInResult =
  | { ok: true; assignmentId: string }
  | { ok: false; reason: AiFailureReason; message: string };

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
      dimension: g.dimension.trim(),
      label: g.label.trim() || 'Something worth telling',
      focus: g.focus.trim(),
      priority: g.priority,
    }))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, MAX_GAPS);

  await saveInterviewState(deps.fs, deps.key, deps.personId, args.bookId, {
    ...interview,
    frameworkCoverage: coverage,
    lastGapPassAt: deps.now.toISOString(),
  });

  return {
    ok: true,
    completeness: computeStoryCompleteness(coverage),
    gaps,
    ...(result.usage ? { usage: result.usage } : {}),
  };
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
    return await clearOpenIfResolved(deps, args.bookId, interview, 'noGaps', pass.completeness);
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

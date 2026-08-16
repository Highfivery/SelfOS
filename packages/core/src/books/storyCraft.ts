import { z } from 'zod';
import { extractJsonObject, tolerantArray } from '../ai';
import { type AiDeps, runClaude } from '../questionnaires';
import type { BookOutline, OutlineChapter } from '../schemas';
import {
  buildChapterPlanMessage,
  buildCritiqueMessage,
  buildReviseMessage,
  type ChapterPlan,
  type CritiqueFinding,
} from './storyPromptBuilder';
import type { BookTruthMode } from './bookTypes';
import type { StoryCorpus } from './storyCorpus';

/**
 * The craft loop (72 §5.3) — the three passes around the draft that turn a generated chapter into a written
 * one: **plan** before writing, **critique** after, **revise** what the critique found.
 *
 * The measurement that motivated this: the shipped one-pass biography narrated its own construction once
 * every 168 words ("the record doesn't say", "this chapter has to hold…"). A single generation pass has to
 * decide what the chapter is, render it, and police itself simultaneously, and it does the last badly. Split
 * into passes, each one has a single job — and the critique pass, given nothing to do but find defects,
 * finds them.
 *
 * Every pass is independently metered + budget-gated (`runClaude`) and independently OPTIONAL: a plan that
 * fails leaves the drafter working from the brief alone, and a critique or revision that fails leaves the
 * draft standing. Only the draft itself is load-bearing, so the loop can only ever improve a chapter — it can
 * never lose one. All of them run on Opus (`BOOK_TASK_MODELS`).
 */

const PLAN_MAX_TOKENS = 3000;
const CRITIQUE_MAX_TOKENS = 4000;

/** Tolerant: one malformed scene/finding drops itself, never the whole plan or critique (37 §3.1). */
const PlanSceneSchema = z.object({
  title: z.string().catch(''),
  beat: z.string().catch(''),
  sources: z.array(z.string()).catch([]),
});
type PlanSceneDraft = z.infer<typeof PlanSceneSchema>;

const PlanDraftSchema = z.object({
  thread: z.string().catch(''),
  opening: z.string().catch(''),
  scenes: tolerantArray(
    PlanSceneSchema,
    { title: '', beat: '', sources: [] } as PlanSceneDraft,
    (s) => s.beat.trim().length > 0 || s.title.trim().length > 0,
  ).catch([]),
  avoid: z.array(z.string()).catch([]),
});

/** The kinds the critique pass may report. An unrecognized kind lands on `other` rather than dropping the
 *  finding — a real defect described in unexpected words is still a real defect. */
const CritiqueKindSchema = z
  .enum([
    'metaNarration',
    'inventedDetail',
    // The invented-events types report this instead (72 §4.1): their events are theirs to make up, so the
    // defect is contradicting the PERSON, never inventing detail.
    'inventedPerson',
    'summaryNotScene',
    'repetition',
    'aiTell',
    'voice',
    'other',
  ])
  .catch('other');

const CritiqueFindingSchema = z.object({
  kind: CritiqueKindSchema,
  quote: z.string().catch(''),
  fix: z.string().catch(''),
});
type CritiqueFindingDraft = z.infer<typeof CritiqueFindingSchema>;

const CritiqueDraftSchema = z.object({
  verdict: z.enum(['ship', 'revise']).catch('revise'),
  findings: tolerantArray(
    CritiqueFindingSchema,
    { kind: 'other' as const, quote: '', fix: '' } as CritiqueFindingDraft,
    // A finding with no fix is unactionable; a finding with no quote can't be located in the prose.
    (f) => f.quote.trim().length > 0 && f.fix.trim().length > 0,
  ).catch([]),
});

/** How many scenes/avoid lines a plan may carry into the drafter's prompt (a runaway plan would crowd out
 *  the source material it is meant to organize). */
const MAX_PLAN_SCENES = 8;
const MAX_PLAN_AVOID = 8;
/** How many findings one revision may be asked to fix. Beyond this the draft is better re-generated than
 *  patched, and a huge fix list is itself a signal the critique pass over-reported. */
const MAX_CRITIQUE_FINDINGS = 12;

/**
 * Pass 1 — plan the chapter. Returns `null` on any failure (including budget): a plan is an enhancement, so
 * the caller falls through to drafting from the brief alone rather than losing the chapter. The call is still
 * metered when it billed, so nothing is spent silently.
 */
export async function planChapter(
  deps: AiDeps,
  corpus: StoryCorpus,
  opts: {
    chapter: OutlineChapter;
    outline: BookOutline;
    essence?: string;
    system: string;
    truthMode?: BookTruthMode;
  },
): Promise<ChapterPlan | null> {
  const user = buildChapterPlanMessage(corpus, {
    chapter: opts.chapter,
    outline: opts.outline,
    ...(opts.essence ? { essence: opts.essence } : {}),
    // So an invented-events book plans invented scenes rather than a retelling (72 §4.1).
    ...(opts.truthMode ? { truthMode: opts.truthMode } : {}),
  });
  const result = await runClaude(deps, opts.system, user, 'book.plan', PLAN_MAX_TOKENS);
  if (!result.ok) return null;
  const json = extractJsonObject(result.text);
  if (!json) return null;
  const parsed = PlanDraftSchema.safeParse(json);
  if (!parsed.success) return null;

  const scenes = parsed.data.scenes
    .map((s) => ({
      title: s.title.trim(),
      beat: s.beat.trim(),
      sources: s.sources.map((t) => t.trim()).filter((t) => t.length > 0),
    }))
    .filter((s) => s.beat.length > 0 || s.title.length > 0)
    .slice(0, MAX_PLAN_SCENES);
  // A plan with no scenes is not a plan — it would add a heading and nothing under it. Treat it as absent so
  // the drafter works from the brief rather than being told it has a plan it doesn't.
  if (scenes.length === 0) return null;
  return {
    thread: parsed.data.thread.trim(),
    opening: parsed.data.opening.trim(),
    scenes,
    avoid: parsed.data.avoid
      .map((a) => a.trim())
      .filter((a) => a.length > 0)
      .slice(0, MAX_PLAN_AVOID),
  };
}

/**
 * Pass 3 — critique the draft. Returns the findings worth revising for, or an empty array when the chapter
 * ships as drafted (the healthy result) or the pass itself failed. An empty array means the caller skips the
 * revision pass entirely, so a clean chapter costs three calls, not four.
 */
export async function critiqueChapter(
  deps: AiDeps,
  corpus: StoryCorpus,
  opts: {
    chapter: OutlineChapter;
    markdown: string;
    plan?: ChapterPlan;
    system: string;
    truthMode?: BookTruthMode;
  },
): Promise<CritiqueFinding[]> {
  const user = buildCritiqueMessage(corpus, {
    chapter: opts.chapter,
    markdown: opts.markdown,
    ...(opts.plan ? { plan: opts.plan } : {}),
    ...(opts.truthMode ? { truthMode: opts.truthMode } : {}),
  });
  const result = await runClaude(deps, opts.system, user, 'book.critique', CRITIQUE_MAX_TOKENS);
  if (!result.ok) return [];
  const json = extractJsonObject(result.text);
  if (!json) return [];
  const parsed = CritiqueDraftSchema.safeParse(json);
  if (!parsed.success) return [];
  // `ship` is the model's own judgment that the chapter is clean — honor it even if it also listed findings
  // (a "ship, but you could tighten this" is not worth a billed revision that re-rolls good prose).
  if (parsed.data.verdict === 'ship') return [];
  return parsed.data.findings
    .map((f) => ({ kind: f.kind, quote: f.quote.trim(), fix: f.fix.trim() }))
    .filter((f) => f.quote.length > 0 && f.fix.length > 0)
    .slice(0, MAX_CRITIQUE_FINDINGS);
}

export type ReviseResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'BUDGET' | 'OTHER'; truncated?: boolean };

/**
 * Pass 4 — revise the draft against the critique's findings. The caller keeps the ORIGINAL draft on any
 * failure (a truncated revision would replace a whole good chapter with half of one), so this returns the
 * raw model text and lets the caller strip markers + enforce protected passages exactly as it does for a
 * first draft. `maxTokens` mirrors the draft ceiling — a revision returns the full chapter.
 */
export async function reviseChapter(
  deps: AiDeps,
  corpus: StoryCorpus,
  opts: {
    chapter: OutlineChapter;
    markdown: string;
    findings: CritiqueFinding[];
    preserve?: string[];
    system: string;
    maxTokens: number;
  },
): Promise<ReviseResult> {
  const user = buildReviseMessage(corpus, {
    chapter: opts.chapter,
    markdown: opts.markdown,
    findings: opts.findings,
    ...(opts.preserve && opts.preserve.length > 0 ? { preserve: opts.preserve } : {}),
  });
  const result = await runClaude(deps, opts.system, user, 'book.revise', opts.maxTokens);
  if (!result.ok) return { ok: false, reason: result.reason === 'BUDGET' ? 'BUDGET' : 'OTHER' };
  // A cut-off revision is worse than no revision: it would replace the full draft with a partial one. Keep
  // the draft (the call is already metered — honesty beats salvage on a persisted artifact).
  if (result.truncated) return { ok: false, reason: 'OTHER', truncated: true };
  if (result.text.trim().length === 0) return { ok: false, reason: 'OTHER' };
  return { ok: true, text: result.text };
}

export type { ChapterPlan, CritiqueFinding };

import type { AiFailureReason } from '../schemas';
import { type AiDeps } from '../questionnaires';
import { queryUsage } from '../usage';
import { buildStoryCorpus } from './storyCorpus';
import { markStaleChapters } from './storyFreshness';
import { generateChapter } from './storyGenerationService';
import { getExclusions, listChapters } from './storyService';
import { generateStructuralProposals } from './storyStructureService';

/**
 * The Your Story refresh pass (64-your-story §3.4/§5.4) — the living-book cadence. It first marks stale any
 * chapter whose cited sources changed (free, `markStaleChapters`), then AUTO-REWRITES stale chapters, budget-
 * gated per chapter and, in the automatic cadence, capped at `STORY_WEEKLY_AUTO_CAP` rewrites per rolling 7
 * days so it can never run away on cost. Finally it runs the STRUCTURAL pass (proposes new/split/reorder/prologue
 * changes — never applied silently), which rides the same cadence (owner decision 2026-07-16) but has its own,
 * uniform weekly cap (`STORY_STRUCTURE_WEEKLY_CAP`, applied to BOTH auto and manual) so an analysis call can't
 * run away either. A rewrite respects protected blocks / pinned quotes / exclusions (via `generateChapter`) and
 * re-stamps the freshness signature so the chapter leaves `stale`. The caller supplies `auto` (the throttled
 * launch/focus cadence vs a manual "Refresh now") and `crisis` (the cadence never spends during an active
 * crisis, §8 — neither rewrites nor proposals).
 */

export const STORY_WEEKLY_AUTO_CAP = 10;
/** Structural analysis passes are cheaper + less frequent than rewrites — a tighter cap, applied to auto AND
 *  manual (a structural proposal is a background suggestion, not a "write my chapter now" force action). */
export const STORY_STRUCTURE_WEEKLY_CAP = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface StoryRefreshResult {
  ok: boolean;
  /** Chapters newly flagged stale this pass. */
  staled: number;
  /** Stale chapters auto-rewritten this pass. */
  rewritten: number;
  /** New structural proposals filed this pass (waiting for one-tap approval). */
  proposalsAdded?: number;
  /** The auto cadence hit the rewrite weekly cap (no rewrite ran). */
  capped?: boolean;
  /** A per-chapter budget stop ended the pass early. */
  budgetReached?: boolean;
  reason?: AiFailureReason;
  message?: string;
}

async function countPasses(deps: AiDeps, type: string): Promise<number> {
  const weekAgo = new Date(deps.now.getTime() - 7 * DAY_MS).toISOString();
  const passes = await queryUsage(deps.fs, deps.key, {
    from: weekAgo,
    to: deps.now.toISOString(),
    personId: deps.personId,
    type,
  });
  return passes.length;
}

/**
 * Run the refresh pass. `markStaleChapters` always runs (free); nothing is generated in either cadence during a
 * crisis. The rewrite weekly cap applies to the AUTO cadence only (a manual refresh is the deliberate force
 * path); the structural cap applies to both. The corpus is built ONCE and reused. Never marks a chapter that
 * was mid-generation.
 */
export async function refreshBook(
  deps: AiDeps,
  args: { bookId: string; auto: boolean; crisis?: boolean },
): Promise<StoryRefreshResult> {
  const staled = await markStaleChapters(deps.fs, deps.key, deps.personId, args.bookId);
  // The cadence never spends during an active crisis (§8) — mark-stale is free, but no rewrite, no proposals.
  if (args.auto && args.crisis) return { ok: true, staled, rewritten: 0 };

  // Rewrite allowance — the weekly cap applies to the AUTO cadence only (manual is the uncapped force path,
  // still budget-gated per chapter). NOTE: the cap counts ALL `story.chapter` passes (writes + revisions +
  // rewrites) — a deliberately CONSERVATIVE cap (it can only reduce auto-rewrites, never cause runaway).
  let capped = false;
  let rewriteAllowance = Infinity;
  if (args.auto) {
    rewriteAllowance = Math.max(
      0,
      STORY_WEEKLY_AUTO_CAP - (await countPasses(deps, 'story.chapter')),
    );
    if (rewriteAllowance === 0) capped = true;
  }

  const stale = (await listChapters(deps.fs, deps.key, deps.personId, args.bookId)).filter(
    (c) => c.status === 'stale',
  );
  // The structural pass runs on every refresh (new material may warrant a new chapter even if nothing drifted),
  // bounded by its own weekly cap on BOTH cadences.
  const mayPropose = (await countPasses(deps, 'story.structure')) < STORY_STRUCTURE_WEEKLY_CAP;

  const willRewrite = stale.length > 0 && rewriteAllowance > 0;
  // Nothing to do at all → return without building the corpus (a rewrite-capped, nothing-to-propose no-op).
  if (!willRewrite && !mayPropose) {
    return { ok: true, staled, rewritten: 0, ...(capped ? { capped: true } : {}) };
  }

  // Build the corpus ONCE and reuse it for every rewrite AND the structural pass (the generation perf note).
  const corpus = await buildStoryCorpus(
    deps.fs,
    deps.key,
    deps.personId,
    args.bookId,
    await getExclusions(deps.fs, deps.key, deps.personId, args.bookId),
  );

  let rewritten = 0;
  let budgetReached = false;
  if (willRewrite) {
    for (const chapter of stale.slice(
      0,
      rewriteAllowance === Infinity ? stale.length : rewriteAllowance,
    )) {
      const res = await generateChapter(deps, {
        bookId: args.bookId,
        chapterId: chapter.id,
        corpus,
      });
      if (res.ok) {
        rewritten += 1;
        continue;
      }
      if (res.reason === 'BUDGET') {
        budgetReached = true;
        break; // stop cleanly; the rest resume next cadence
      }
      // A per-chapter failure (REFUSED/TRUNCATED/ERROR) — leave it stale and continue.
    }
  }

  // The structural pass — skip if a rewrite already hit the budget (don't spend more this pass).
  let proposalsAdded = 0;
  if (mayPropose && !budgetReached) {
    const gen = await generateStructuralProposals(deps, { bookId: args.bookId, corpus });
    if (gen.ok) proposalsAdded = gen.added;
    else if (gen.reason === 'BUDGET') budgetReached = true;
    // A structural failure (REFUSED/TRUNCATED/ERROR) is non-fatal — the rewrites still count.
  }

  return {
    ok: true,
    staled,
    rewritten,
    ...(proposalsAdded > 0 ? { proposalsAdded } : {}),
    ...(capped ? { capped: true } : {}),
    ...(budgetReached ? { budgetReached: true } : {}),
  };
}

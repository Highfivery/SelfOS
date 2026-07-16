import type { AiFailureReason } from '../schemas';
import { type AiDeps } from '../questionnaires';
import { queryUsage } from '../usage';
import { buildStoryCorpus } from './storyCorpus';
import { markStaleChapters } from './storyFreshness';
import { generateChapter } from './storyGenerationService';
import { getExclusions, listChapters } from './storyService';

/**
 * The Your Story refresh pass (64-your-story §3.4/§5.4) — the living-book cadence. It first marks stale any
 * chapter whose cited sources changed (free, `markStaleChapters`), then AUTO-REWRITES stale chapters, budget-
 * gated per chapter and, in the automatic cadence, capped at `STORY_WEEKLY_AUTO_CAP` rewrites per rolling 7
 * days (the owner override bypasses the cap, like a budget stop) so it can never run away on cost. A rewrite
 * respects protected blocks / pinned quotes / exclusions (via `generateChapter`) and re-stamps the freshness
 * signature so the chapter leaves `stale`. The caller supplies `auto` (the throttled launch/focus cadence vs a
 * manual "Refresh now") and `crisis` (the auto cadence never spends during an active crisis, §8).
 */

export const STORY_WEEKLY_AUTO_CAP = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface StoryRefreshResult {
  ok: boolean;
  /** Chapters newly flagged stale this pass. */
  staled: number;
  /** Stale chapters auto-rewritten this pass. */
  rewritten: number;
  /** The auto cadence hit the weekly cap (no rewrite ran). */
  capped?: boolean;
  /** A per-chapter budget stop ended the rewrite loop early. */
  budgetReached?: boolean;
  reason?: AiFailureReason;
  message?: string;
}

/**
 * Run the refresh pass. `markStaleChapters` always runs (free); the rewrite is skipped in the auto cadence
 * during a crisis. In the auto cadence the weekly cap limits how many chapters rewrite; a manual refresh is
 * uncapped (still budget-gated per chapter). Never marks a chapter that was mid-generation.
 */
export async function refreshBook(
  deps: AiDeps,
  args: { bookId: string; auto: boolean; crisis?: boolean },
): Promise<StoryRefreshResult> {
  const staled = await markStaleChapters(deps.fs, deps.key, deps.personId, args.bookId);
  // The auto cadence never spends during an active crisis (§8) — mark-stale is free, but no rewrite.
  if (args.auto && args.crisis) return { ok: true, staled, rewritten: 0 };

  // The weekly cap applies to the AUTO cadence only — a manual "Refresh now" is user-initiated, so it's the
  // deliberate "force past the cap" path (still budget-gated per chapter). No owner-override lever is needed:
  // auto is always capped so the background cadence can never run away on cost; manual is always uncapped.
  let allowance = Infinity;
  if (args.auto) {
    // NOTE: the cap counts ALL `story.chapter` passes (initial writes + revisions + rewrites), not a dedicated
    // rewrite type — a deliberately CONSERVATIVE cap (it can only reduce auto-rewrites, never cause runaway).
    const weekAgo = new Date(deps.now.getTime() - 7 * DAY_MS).toISOString();
    const passes = await queryUsage(deps.fs, deps.key, {
      from: weekAgo,
      to: deps.now.toISOString(),
      personId: deps.personId,
      type: 'story.chapter',
    });
    allowance = Math.max(0, STORY_WEEKLY_AUTO_CAP - passes.length);
    if (allowance === 0) return { ok: true, staled, rewritten: 0, capped: true };
  }

  const stale = (await listChapters(deps.fs, deps.key, deps.personId, args.bookId)).filter(
    (c) => c.status === 'stale',
  );
  if (stale.length === 0) return { ok: true, staled, rewritten: 0 };

  // Build the corpus ONCE and reuse it for every rewrite (the generation perf note).
  const corpus = await buildStoryCorpus(
    deps.fs,
    deps.key,
    deps.personId,
    await getExclusions(deps.fs, deps.key, deps.personId, args.bookId),
  );
  let rewritten = 0;
  let budgetReached = false;
  for (const chapter of stale.slice(0, allowance === Infinity ? stale.length : allowance)) {
    const res = await generateChapter(deps, { bookId: args.bookId, chapterId: chapter.id, corpus });
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
  return { ok: true, staled, rewritten, ...(budgetReached ? { budgetReached: true } : {}) };
}

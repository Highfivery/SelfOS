import type { AiFailureReason } from '../schemas';
import { type AiDeps } from '../questionnaires';
import { queryUsage } from '../usage';
import { detectNewMaterial } from './storyFreshness';
import { generateStructuralProposals } from './storyStructureService';

/**
 * The book refresh pass (72 §5.4) — the living-book cadence.
 *
 * It used to mark chapters `stale` and then REWRITE them, ten a week, in the background. That is how a
 * 45-chapter book reached 34 of 34 stale with no path to finishing: every pass spent its allowance
 * rewriting prose nobody had asked it to touch, while the chapters that had never been written waited.
 *
 * Now it only ever DETECTS and RECORDS. The free signature diff names which sources changed and what they
 * say, and files that against the chapter as a proposal the author accepts or declines (§3.6). Nothing is
 * rewritten here — a rewrite is always an explicit act, and it runs through the craft loop when it happens.
 *
 * The structural pass still runs on this cadence (new material may warrant a whole new chapter, not just a
 * fold-in), bounded by its own weekly cap on BOTH the automatic and manual paths so an analysis call can't
 * run away. The caller supplies `auto` (the throttled launch/focus cadence vs a manual "Refresh now") and
 * `crisis` (the cadence never spends during an active crisis, §8 — detection is free and still runs).
 */

export const STORY_WEEKLY_AUTO_CAP = 10;
/** Structural analysis passes are cheaper + less frequent than rewrites — a tighter cap, applied to auto AND
 *  manual (a structural proposal is a background suggestion, not a "write my chapter now" force action). */
export const STORY_STRUCTURE_WEEKLY_CAP = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface StoryRefreshResult {
  ok: boolean;
  /** Chapters that now have new material waiting on the author. */
  staled: number;
  /** Always 0 — kept so existing callers/UI compile; the refresh no longer rewrites anything (72 §5.4). */
  rewritten: number;
  /** New structural proposals filed this pass (waiting for one-tap approval). */
  proposalsAdded?: number;
  /** A budget stop ended the pass early. */
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
 * Run the refresh pass. Detection is FREE and always runs, in both cadences and during a crisis — knowing
 * what could go in costs nothing and pushes nothing. Only the structural pass spends, and it is skipped
 * during a crisis and bounded by its weekly cap on both cadences.
 */
export async function refreshBook(
  deps: AiDeps,
  args: { bookId: string; auto: boolean; crisis?: boolean },
): Promise<StoryRefreshResult> {
  const staled = await detectNewMaterial(deps.fs, deps.key, deps.personId, args.bookId, deps.now);
  // The cadence never spends during an active crisis (§8). Detection above is free, so it still ran.
  if (args.auto && args.crisis) return { ok: true, staled, rewritten: 0 };

  if ((await countPasses(deps, 'story.structure')) >= STORY_STRUCTURE_WEEKLY_CAP) {
    return { ok: true, staled, rewritten: 0 };
  }

  const gen = await generateStructuralProposals(deps, { bookId: args.bookId });
  if (!gen.ok) {
    // A structural failure is non-fatal — the detection above still stands on its own.
    return {
      ok: true,
      staled,
      rewritten: 0,
      ...(gen.reason === 'BUDGET' ? { budgetReached: true } : {}),
    };
  }
  return {
    ok: true,
    staled,
    rewritten: 0,
    ...(gen.added > 0 ? { proposalsAdded: gen.added } : {}),
  };
}

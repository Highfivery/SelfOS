import type { Goal } from '@shared/schemas';
import { effectiveGoalStatus } from '@shared/schemas';

/**
 * Pick the single stale goal to gently check in on (40-proactive-coaching §3.2) — at most one open
 * goal-followup at a time. "Stale" is the spec-39 derived state (past due / long untouched); among the
 * stale ones we surface the LEAST-recently-touched (the one most worth a nudge). Returns null when none
 * are stale. Pure + deterministic so the nudge + the Home card agree and it's unit-testable.
 */
export function stalestGoal(goals: Goal[], now: Date): Goal | null {
  const stale = goals.filter((g) => effectiveGoalStatus(g, now) === 'stale');
  if (stale.length === 0) return null;
  return stale.reduce((oldest, g) => {
    const a = g.lastTouchedAt ?? g.updatedAt;
    const b = oldest.lastTouchedAt ?? oldest.updatedAt;
    return a < b ? g : oldest;
  });
}

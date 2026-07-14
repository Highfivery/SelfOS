import { isGoalStale, type Goal, type GoalStatus } from '../schemas';

/**
 * The Goals card's derived summary (60-home-dashboard §3.1.3) — active/done/stale counts, a completion %,
 * and the `top` active goals that most want attention (stale first, then soonest-due, then most recently
 * touched). Pure; the renderer feeds already-loaded goals + `now` so the display state is testable.
 */
export interface GoalsSummary {
  activeCount: number; // open + inProgress
  doneCount: number;
  staleCount: number; // active goals that currently read stale
  progressPct: number; // done / (active + done), 0..100 (0 when there are none)
  top: Goal[]; // the few active goals to surface on the card
}

const ACTIVE: ReadonlySet<GoalStatus> = new Set(['open', 'inProgress']);

export function goalsSummary(goals: Goal[], now: Date, topN = 2): GoalsSummary {
  const active = goals.filter((g) => ACTIVE.has(g.status));
  const doneCount = goals.filter((g) => g.status === 'done').length;
  const staleCount = active.filter((g) => isGoalStale(g, now)).length;
  const total = active.length + doneCount;
  const progressPct = total === 0 ? 0 : Math.round((doneCount / total) * 100);

  const top = [...active]
    .sort((a, b) => {
      // Stale ones lead (they need a decision), then the soonest deadline, then most recently engaged.
      const staleRank = Number(isGoalStale(a, now)) - Number(isGoalStale(b, now)); // stale(1) sorts before?
      if (staleRank !== 0) return -staleRank; // stale first
      const da = a.due ? Date.parse(a.due) : Number.POSITIVE_INFINITY;
      const db = b.due ? Date.parse(b.due) : Number.POSITIVE_INFINITY;
      if (da !== db) return da - db;
      return (b.lastTouchedAt ?? b.updatedAt).localeCompare(a.lastTouchedAt ?? a.updatedAt);
    })
    .slice(0, topN);

  return { activeCount: active.length, doneCount, staleCount, progressPct, top };
}

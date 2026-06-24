import type { Insight } from '../schemas';

/**
 * The automatic-reconciliation cadence gate (39-living-memory §3.3 / §11 Q1). Memory should stay coherent
 * WITHOUT the user remembering to tap Refresh: the full coherence AI pass fires when enough has changed —
 * ≥5 new insights since the last reconcile, OR a >14-day gap since the last one — throttled to at most one
 * automatic pass per 24h. Pure + unit-testable; the renderer drives the cadence (launch/focus, like spec 36's
 * update check), the bridge evaluates this gate, and the manual Refresh always forces (ignores all of it).
 */
export const AUTO_RECONCILE_NEW_THRESHOLD = 5;
export const AUTO_RECONCILE_GAP_DAYS = 14;
export const AUTO_RECONCILE_THROTTLE_HOURS = 24;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AutoReconcileInputs {
  /** The subject's APPROVED insights (drafts don't reconcile). Only their timestamps are read. */
  insights: Pick<Insight, 'createdAt' | 'lastReconciledAt'>[];
  /** When this device last RAN an automatic pass for this person (the throttle marker; device-local). */
  lastCheckedAt: string | undefined;
  now: Date;
}

/** Parse an ISO time to ms, or null if absent/unparseable. */
function ms(iso: string | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/**
 * Whether an automatic reconciliation is warranted right now. False when: throttled (an auto pass ran for this
 * person within 24h), there's too little to reconcile (<2 insights), or neither trigger holds (no 5-new and no
 * 14-day gap). The opt-out setting + budget/AI gates are checked by the caller — this is purely the cadence.
 */
export function shouldAutoReconcile(input: AutoReconcileInputs): boolean {
  const now = input.now.getTime();

  // Throttle: at most one automatic pass per window.
  const checked = ms(input.lastCheckedAt);
  if (checked !== null && now - checked < AUTO_RECONCILE_THROTTLE_HOURS * 60 * 60 * 1000) {
    return false;
  }

  // Need at least two insights for a merge/recalibration to be meaningful.
  if (input.insights.length < 2) return false;

  // The most recent reconcile across the set (undefined ⇒ never reconciled).
  const lastReconciled = input.insights
    .map((i) => ms(i.lastReconciledAt))
    .filter((t): t is number => t !== null)
    .reduce<number | null>((max, t) => (max === null || t > max ? t : max), null);

  // Trigger 1: enough NEW insights since the last reconcile (all count if never reconciled).
  const newSince = input.insights.filter((i) => {
    const created = ms(i.createdAt);
    if (created === null) return false;
    return lastReconciled === null || created > lastReconciled;
  }).length;
  if (newSince >= AUTO_RECONCILE_NEW_THRESHOLD) return true;

  // Trigger 2: a long-enough gap since the last reconcile (only once it's run at least once).
  if (lastReconciled !== null && now - lastReconciled > AUTO_RECONCILE_GAP_DAYS * DAY_MS) {
    return true;
  }

  return false;
}

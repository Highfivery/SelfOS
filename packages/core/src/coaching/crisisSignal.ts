import type { Insight } from '../schemas';

/**
 * Cross-insight crisis awareness (40-proactive-coaching §3.5). A DETERMINISTIC (no-AI) aggregation of recent
 * distress signals — recurring crisis flags across the person's own insights, plus the dream nightmare nudge
 * (12 §8.2). When distress RECURS across a bounded recent window, the renderer surfaces a supportive,
 * resources-first affordance (the Home WellbeingCard banner / CrisisFooter). It is NEVER a metric, score, or
 * alarm, NEVER a dismissible notification (35 §8), and NEVER disabled by the proactivity setting (it's safety).
 *
 * Per-person: the caller passes only the active person's OWN insights (the per-person isolation rule).
 */

/** ≥ this many crisis-flagged insights inside the window counts as "recurring" (40 §11 Q7). */
export const CRISIS_RECUR_COUNT = 2;
/** The recent window for recurrence, in days (40 §11 Q7). */
export const CRISIS_WINDOW_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CrisisSignalInput {
  /** The active person's OWN insights (any source). Only approved, crisis-flagged ones in-window are counted. */
  insights: Insight[];
  /** The dream nightmare nudge (12 §8.2) — already true at ≥3 nightmares in 14 days OR a distress signal. */
  nightmareNudge: boolean;
  now: Date;
}

export interface CrisisSignal {
  /** Whether to show the supportive surface — distress has recurred recently. */
  recurring: boolean;
  /** How many crisis-flagged insights fell inside the window (for nothing but the pure function's own logic). */
  count: number;
  /** Whether the dream nightmare nudge contributed. */
  nightmare: boolean;
  /** The earliest qualifying flag's date in-window (ISO), if any — a gentle "since", never displayed as a metric. */
  since?: string;
}

/**
 * Aggregate the recent crisis signal. Recurring = (≥ {@link CRISIS_RECUR_COUNT} crisis-flagged own insights
 * within the last {@link CRISIS_WINDOW_DAYS} days) OR the dream nightmare nudge. Pure + deterministic so the
 * surface is testable and never depends on a model. Unapproved drafts don't count (the user hasn't seen them).
 */
export function aggregateCrisisSignal(input: CrisisSignalInput): CrisisSignal {
  const cutoff = input.now.getTime() - CRISIS_WINDOW_DAYS * DAY_MS;
  const flagged = input.insights
    .filter((i) => i.approved && i.crisisFlag === true)
    .map((i) => i.provenance.at)
    .filter((at) => {
      const t = new Date(at).getTime();
      return Number.isFinite(t) && t >= cutoff;
    })
    .sort((a, b) => a.localeCompare(b));

  const count = flagged.length;
  const nightmare = input.nightmareNudge === true;
  const recurring = count >= CRISIS_RECUR_COUNT || nightmare;
  return {
    recurring,
    count,
    nightmare,
    ...(flagged[0] ? { since: flagged[0] } : {}),
  };
}

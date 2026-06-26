import type { Completion } from './schemas';

/** Only celebrate completions from the recent past, so shipping the feature never fêtes ancient history. */
export const CELEBRATION_WINDOW_DAYS = 3;

/**
 * Pick the single completion to celebrate now (53 §3.5), or `null`. PURE. Celebrates **once** per completion:
 * a completion whose signature is already in `celebrated` is skipped; only completions within the recent
 * window are eligible (so the first Home load after this ships doesn't celebrate an old session). The newest
 * eligible one wins. The renderer shows a transient toast and records the returned `key` (device-local,
 * per-person) so a re-visit doesn't re-celebrate.
 *
 * The caller is responsible for suppressing celebration entirely during crisis / proactivity-off / brand-new
 * (§3.5/§8) — this helper only chooses WHICH completion, never WHETHER the surface is allowed.
 */
export function pendingCelebration(
  completions: Completion[],
  celebrated: Set<string>,
  now: Date,
): Completion | null {
  const cutoff = now.getTime() - CELEBRATION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const eligible = completions.filter((c) => {
    if (celebrated.has(`celebrate:${c.key}`)) return false;
    const at = Date.parse(c.at);
    if (Number.isNaN(at)) return false;
    return at >= cutoff && at <= now.getTime();
  });
  if (eligible.length === 0) return null;
  return eligible.reduce((newest, c) => (Date.parse(c.at) > Date.parse(newest.at) ? c : newest));
}

/**
 * Pick the single stale goal to gently check in on (40-proactive-coaching §3.2) — at most one open
 * goal-followup at a time. "Stale" is the spec-39 derived state (past due / long untouched); among the
 * stale ones we surface the LEAST-recently-touched.
 *
 * This is a SINGLE SOURCE OF TRUTH in `@selfos/core/recommendations` (`stalestOpenGoal`), re-exported here
 * under the established `stalestGoal` name so the goal NOTIFICATION (35), the "For you" recommendation (53),
 * and its inline action all resolve the SAME goal — they can never diverge (53 §5.4).
 */
export { stalestOpenGoal as stalestGoal } from '@selfos/core/recommendations';

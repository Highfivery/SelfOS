import { isAnswerable } from '../questionnaires/answerService';
import type { AssignmentStatus, AutoCheckinCadence, AutoCheckinIntent } from '../schemas';

export type { AutoCheckinIntent };

/**
 * The Auto check-ins cadence + queue planner (63-auto-checkins §3.7). PURE + unit-testable — the renderer
 * drives the cadence (launch/focus, the 39/36 template), the bridge evaluates these gates, the orchestrator
 * (`service.ts`) does the AI work. Everything here is DERIVED from a stream's assignments (no mutable
 * scheduler state is stored): the queue depth, whether a stream is due, and the adaptive back-off tier.
 */

/** Keep each stream topped up to this many unanswered (§3.7). */
export const TARGET_DEPTH = 3;
/** Hard pause: never let a stream exceed this many unanswered auto check-ins. */
export const HARD_CAP = 5;
/** Most a single stream generates in one run. */
export const MAX_PER_RUN = 2;
/** Most an author generates across ALL their streams in one run (the runaway-spend backstop). */
export const MAX_PER_AUTHOR_PER_RUN = 4;
/** The engine runs at most once per this window per author (device-local throttle, §3.4). */
export const AUTO_CHECKIN_THROTTLE_HOURS = 24;
/** Auto check-ins expire after this many days — an unanswered-past-expiry one counts as "ignored" (§3.7). */
export const AUTO_CHECKIN_EXPIRY_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Base interval per cadence (days) before any back-off stretch. */
const BASE_INTERVAL_DAYS: Record<AutoCheckinCadence, number> = {
  daily: 1,
  'few-days': 3,
  weekly: 7,
};

/** The minimal per-assignment shape the planner reads (built by the orchestrator from the stream's sends). */
export interface AutoAssignmentView {
  createdAt: string;
  status: AssignmentStatus;
  expiresAt?: string;
  intent?: AutoCheckinIntent;
}

export interface StreamState {
  targetId: string;
  cadence: AutoCheckinCadence;
  /** The stream's OWN auto-generated assignments (this author → this recipient, this target). */
  assignments: AutoAssignmentView[];
}

export interface StreamPlan {
  targetId: string;
  /** How many check-ins to generate for this stream this run (≥ 1). */
  slots: number;
}

function ms(iso: string | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** The person answered this check-in. */
function isEngaged(status: AssignmentStatus): boolean {
  return status === 'submitted' || status === 'analyzed';
}

/** "Disengaged" = declined/expired/revoked, OR still-answerable but past its expiry (silently ignored). */
function isDisengaged(a: AutoAssignmentView, now: Date): boolean {
  if (a.status === 'declined' || a.status === 'expired' || a.status === 'revoked') return true;
  const exp = ms(a.expiresAt);
  return isAnswerable(a.status) && exp !== null && now.getTime() > exp;
}

/** In the current queue: answerable and not yet past expiry (neither engaged nor ignored — just pending). */
export function isPending(a: AutoAssignmentView, now: Date): boolean {
  return isAnswerable(a.status) && !isDisengaged(a, now);
}

/** The unanswered queue depth (pending) for the top-up + pause cap. */
export function queueDepth(assignments: AutoAssignmentView[], now: Date): number {
  return assignments.filter((a) => isPending(a, now)).length;
}

/** Whether the stream already has a pending intimacy check-in (so a batch needn't stack another, §3.5). */
export function hasPendingIntimacy(assignments: AutoAssignmentView[], now: Date): boolean {
  return assignments.some((a) => a.intent === 'intimacy' && isPending(a, now));
}

/**
 * Adaptive back-off tier (0 = base, 3 = soft-paused). Consecutive DISENGAGED among the most recent RESOLVED
 * auto check-ins — pending (in-queue) ones are skipped (not yet judged), and the most recent ENGAGED
 * (answered) resolution resets to 0. Capped at 3. Deterministic (§3.7).
 */
export function backoffTier(assignments: AutoAssignmentView[], now: Date): number {
  const newestFirst = [...assignments].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
  );
  let streak = 0;
  for (const a of newestFirst) {
    if (isPending(a, now)) continue; // still in the queue — not yet ignored
    if (isEngaged(a.status)) break; // last resolution was an answer → reset
    if (isDisengaged(a, now)) {
      streak += 1;
      continue;
    }
    break; // any other terminal state — stop counting
  }
  return Math.min(streak, 3);
}

/** Effective run interval (days) for a stream given cadence + back-off tier; Infinity = soft-paused. */
export function effectiveIntervalDays(cadence: AutoCheckinCadence, tier: number): number {
  const base = BASE_INTERVAL_DAYS[cadence];
  const ladder = [base, Math.max(base, 3), Math.max(base, 7), Infinity];
  return ladder[Math.min(tier, ladder.length - 1)] ?? base;
}

/** Whether a stream's interval has elapsed since its newest auto check-in (never run ⇒ due). */
export function isStreamDue(stream: StreamState, now: Date): boolean {
  const newest = stream.assignments
    .map((a) => ms(a.createdAt))
    .filter((t): t is number => t !== null)
    .reduce<number | null>((max, t) => (max === null || t > max ? t : max), null);
  if (newest === null) return true;
  const interval = effectiveIntervalDays(stream.cadence, backoffTier(stream.assignments, now));
  if (!Number.isFinite(interval)) return false; // soft-paused
  return now.getTime() - newest >= interval * DAY_MS;
}

export interface ShouldRunInput {
  enabled: boolean;
  hasEnabledTargets: boolean;
  lastCheckedAt: string | undefined;
  now: Date;
}

/**
 * The engine cadence gate (§3.4) — the `shouldAutoReconcile` sibling. False when the master toggle is off,
 * there are no enabled targets, or the device already ran within the throttle window. The crisis / AI /
 * budget gates are the orchestrator's job (this is purely the cadence).
 */
export function shouldRunAutoCheckins(input: ShouldRunInput): boolean {
  if (!input.enabled || !input.hasEnabledTargets) return false;
  const checked = ms(input.lastCheckedAt);
  if (
    checked !== null &&
    input.now.getTime() - checked < AUTO_CHECKIN_THROTTLE_HOURS * 60 * 60 * 1000
  ) {
    return false;
  }
  return true;
}

/**
 * Decide how many check-ins to generate per stream this run. A stream is skipped when it is at/over the hard
 * cap or not yet due; otherwise it tops up toward TARGET_DEPTH, bounded by MAX_PER_RUN and the remaining
 * per-author budget (MAX_PER_AUTHOR_PER_RUN across all streams). Pure — the intent allocation + generation
 * happen in the orchestrator.
 */
export function planStreams(input: { streams: StreamState[]; now: Date }): StreamPlan[] {
  const plans: StreamPlan[] = [];
  let authorBudget = MAX_PER_AUTHOR_PER_RUN;
  for (const stream of input.streams) {
    if (authorBudget <= 0) break;
    const depth = queueDepth(stream.assignments, input.now);
    if (depth >= HARD_CAP) continue;
    if (!isStreamDue(stream, input.now)) continue;
    const topUp = Math.min(Math.max(TARGET_DEPTH - depth, 0), MAX_PER_RUN, authorBudget);
    if (topUp <= 0) continue;
    plans.push({ targetId: stream.targetId, slots: topUp });
    authorBudget -= topUp;
  }
  return plans;
}

/**
 * Allocate a stream's slots to intents: reserve ONE intimacy slot when eligible (§3.5), then fill the rest
 * with a VARIETY of topical intents (deepen → explore → expand, cycling) so a batch never stacks the same
 * intent. The gap-finder supplies the actual topical content; the intent is the descriptive label + rationale.
 */
export function allocateIntents(
  slots: number,
  opts: { reserveIntimacy: boolean },
): AutoCheckinIntent[] {
  const out: AutoCheckinIntent[] = [];
  let remaining = slots;
  if (opts.reserveIntimacy && remaining > 0) {
    out.push('intimacy');
    remaining -= 1;
  }
  const variety: AutoCheckinIntent[] = ['deepen', 'explore', 'expand'];
  let i = 0;
  while (remaining > 0) {
    out.push(variety[i % variety.length] ?? 'deepen');
    i += 1;
    remaining -= 1;
  }
  return out;
}

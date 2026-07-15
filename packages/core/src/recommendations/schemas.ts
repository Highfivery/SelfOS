import { z } from 'zod';
import type { Goal } from '../schemas';

/**
 * 53-home-encouragement — the recommendation/encouragement engine view types (Slice A). NOT persisted: a
 * recommendation is DERIVED on each Home load from data the renderer already holds (the 17 model), so there
 * is no vault schema, no new IPC, no per-load AI spend. Pure + Zod-first so the engine is unit-testable and
 * portable to both hosts (`@selfos/core` stays node/Buffer-free).
 */

/** The feature domain a recommendation belongs to (drives its icon + variety-dedup). */
export const RecommendationDomainSchema = z.enum([
  'session',
  'guided',
  'intimacy',
  'test',
  'challenge',
  'wellbeing',
  'dream',
  'memory',
  'questionnaire',
  'together',
]);
export type RecommendationDomain = z.infer<typeof RecommendationDomainSchema>;

/** A concrete, ranked recommendation the renderer renders as a "For you" card. */
export const RecommendationSchema = z.object({
  id: z.string().min(1), // stable provider id — drives the action renderer + variety-dedup
  domain: RecommendationDomainSchema,
  label: z.string().min(1), // the card's short title ("Pick up where you left off")
  reason: z.string().min(1), // deterministic, person-specific ("Your 'finish the project' goal has been quiet")
  route: z.string().min(1), // the in-app route the primary action navigates to
  score: z.number(), // the engine's relevance score (filled by ranking)
  // The dismissal signature (stored as `rec:<dismissKey>` in the device-local discovery seam). It carries the
  // SIGNAL identity (e.g. the goal id + its last-touched stamp), so a dismissed recommendation re-surfaces
  // only when its underlying signal CHANGES — never re-nags on the same signal, never dies forever (§3.2/§7).
  dismissKey: z.string().min(1),
});
export type Recommendation = z.infer<typeof RecommendationSchema>;

/**
 * The candidate a provider returns (the engine stamps `domain` + final `score`). `dismissKey` is optional —
 * a provider sets a SIGNAL-aware key (so the dismissal re-surfaces when the signal changes); when omitted the
 * engine defaults it to the provider `id` (a durable "not this generic invitation" dismissal).
 */
export type RecommendationCandidate = Omit<Recommendation, 'domain' | 'dismissKey'> & {
  dismissKey?: string;
};

/** Encouragement intensity — reuses the spec-40 per-person `coaching.proactivity` dial (no new setting). */
export type ProactivityLevel = 'off' | 'gentle' | 'active';

/**
 * What a provider needs to decide relevance — the active person's derived state. PURE inputs only (no AI, no
 * I/O): the renderer assembles this from stores it already loaded. Slice-B features extend it additively
 * (optional fields default safely), so a new provider reads its own field without a logic change here.
 */
export interface PersonRecommendationState {
  /** `can(...)` snapshot — gated providers are filtered before relevance (§5.2). */
  capabilities: Set<string>;
  /** The per-person 18+ ack (16 §8.3) — `adultGate` providers are filtered until this is true. */
  adultAcknowledged: boolean;
  /** The per-person encouragement dial (40 §3.6). `off` ⇒ no "For you" section at all (§3.7). */
  proactivity: ProactivityLevel;
  now: Date;
  /**
   * Recurring distress (40 `aggregateCrisisSignal`) — when true the engine suppresses ALL pushes so Home
   * leads with support, not nudges (§8). NOT governed by the proactivity dial (it's safety).
   */
  crisis: boolean;
  /** A brand-new person sees the getting-started path, not "For you" (§7) — suppress pushes. */
  isNew: boolean;
  /** AI is ready (key resolved + enabled) — gates the AI-bearing candidates (synthesis/guided/questionnaire). */
  configured: boolean;

  // --- signals the built-in providers rank over ---
  /** The active person's ACTIVE (open/inProgress) goals — providers derive staleness (39 `effectiveGoalStatus`). */
  openGoals: Goal[];
  /** Open/on-hold sessions to resume (09 status). */
  openSessions: number;
  /** A cached spec-40 synthesis observation exists (surface it, no spend). */
  hasSynthesisCache: boolean;
  /** When the cached observation was computed — the synthesis dismissal signature (a new one re-surfaces). */
  synthesisComputedAt?: string;
  /** Enough recent material to run a synthesis on explicit tap (40 §3.4). */
  canSynthesize: boolean;
  /** The onboarding portrait is stale OR freshness suggestions are pending (29/18 §15). */
  portraitStale: boolean;
  /** A stable signature of the pending freshness suggestions — a NEW one re-surfaces a dismissal. */
  freshnessSignature?: string;
  /** A pending DEPTH invitation (29 §3.2), with the invited area's title + a stable id for the reason/dismissal. */
  depthInvitation: { id?: string; area?: string } | null;
  /** Cached guided suggestions available (16) — surface the top pick. */
  guidedSuggestionCount: number;
  /** When the cached guided suggestions were generated — the guided dismissal signature. */
  guidedGeneratedAt?: string;
  /** A near-empty person who could be invited to explore a guided session (41 §3.1). */
  lightActivity: boolean;
  /** A questionnaire worth sending exists / the gap-finder is worth a tap (08). */
  questionnaireGapHint: boolean;
  /** Memory has drifted — queued merge proposals (39 reconcile). */
  memoryStale: boolean;
  /** A stable signature of the queued merge proposals — NEW drift re-surfaces a dismissal. */
  memorySignature?: string;
  /** How many auto-generated check-ins are waiting in the person's inbox (63) — drives the `auto-checkin`
   *  For-you card. Additive-optional (absent ⇒ 0 ⇒ no card). */
  autoCheckinWaiting?: number;

  // --- Slice-B signals (50/51/48; additive-optional — absent ⇒ the provider contributes nothing) ---
  /** The active person's taken self-assessments (50) — instrument + `group` + when. Drives `take-a-test`
   *  (no personality/relationships test taken yet → invite a first one) and `intimacy-exercise` (an
   *  intimacy-group test taken = the person has engaged intimacy, so a guided exercise is "for them"). */
  testResults?: { instrument: string; group: string; takenAt: string }[];
  /** A mood/anxiety check-in is overdue on the gentle ~14-day window (51 §3.4) — a soft invitation, NEVER a
   *  schedule and NEVER escalating; absent/false ⇒ no nudge. The provider it feeds is not 18+-gated. */
  wellbeingCheckinDue?: boolean;
  /** When the most recent mood/anxiety check-in was taken — the wellbeing-checkin dismissal signature, so a
   *  NEW overdue (after a fresh check-in, then ≥14 days) re-surfaces while the same overdue won't re-nag. */
  lastWellbeingCheckinAt?: string;
  /** There is an ACTIVE challenge (52) — suppresses the "take on a challenge" suggestion (one at a time). */
  activeChallenge?: boolean;
  /** An active challenge's check-in is due (52 §3.5) — surface the gentle "how did it go?" nudge. */
  challengeCheckInDue?: boolean;
  /** A stable signature of the due challenge (its id + checkInAt) — the dismissal re-surfaces on a NEW one. */
  challengeCheckInSignature?: string;
  /** `shouldSuggestChallenge` holds (no active challenge, proactivity on, throttle clear) — surface the
   *  explicit-tap "get a challenge idea" card (52 §3.7). Requires `configured` (the suggester needs AI). */
  challengeSuggestable?: boolean;
  /** A cached challenge suggestion's `computedAt` — drives the suggest dismissal signature (a NEW idea re-surfaces). */
  challengeSuggestionComputedAt?: string;

  // --- Together (58 §3.12; additive-optional — absent ⇒ the provider contributes nothing) ---
  /** The one Together Home nudge (a pending invite ∨ your-turn session ∨ a >14-day-quiet pair), derived over
   *  the viewer's session summaries (`computeTogetherHomeNudge`). Requires the `together.own` gate + a live
   *  partner edge (the bridge only returns summaries with one). The explicit-register copy never appears here. */
  togetherNudge?: {
    kind: 'invite' | 'turn' | 'quiet';
    sessionId?: string;
    pairKey: string;
    partnerName: string;
    stamp: string;
  } | null;
  /** A Pulse check-in is due for a live partner (spec 61 §3.4) — never checked in, or last > 7 days ago.
   *  Drives the inline Home check-in callout (`pulse-checkin`). Requires the `together.own` gate + a live
   *  partner edge. `lastCheckInAt` drives the dismissal signature so a NEW overdue re-surfaces. */
  pulseCheckinDue?: {
    partnerPersonId: string;
    partnerName: string;
    lastCheckInAt?: string;
  } | null;
}

/**
 * A feature registers one of these per recommendable action (the `contextProviders` precedent, §5.1/§5.5).
 * `relevance` is PURE — it derives from `state` only; no AI, no I/O, no spend.
 */
export interface RecommendationProvider {
  id: string;
  domain: RecommendationDomain;
  /** Required capability to even consider this — filtered before relevance (no dead CTA). */
  capabilityGate?: string;
  /** True if this needs the 18+ ack — filtered until acknowledged (no premature 18+ exposure). */
  adultGate?: boolean;
  /**
   * Return a candidate (`reason` + `route` + a base `score` ≥ 0) if relevant to this person now, else `null`.
   * Higher score = more relevant; recency/staleness is factored in here.
   */
  relevance: (state: PersonRecommendationState) => RecommendationCandidate | null;
}

/** How many "For you" cards each proactivity level shows (§3.4 — `off` renders the section not at all). */
export const COUNT_BY_PROACTIVITY: Record<ProactivityLevel, number> = {
  off: 0,
  gentle: 2,
  active: 3,
};

/** A reflection of what has positively happened (§3.3). By type it can carry NO gap/streak/miss/overdue. */
export interface MomentumReflection {
  /** The single warm line, or undefined on a quiet week (just the greeting). */
  line?: string;
  /** Sessions/check-ins/dreams in the rolling window (≥0). Positive reflection only. */
  showedUp?: number;
  /** Distinct life-areas / domains engaged (≥0). A growth reflection, never a completion target. */
  areas?: number;
  /** Open goals touched recently (≥0). Never "overdue". */
  goalsMoving?: number;
}

/** The momentum inputs the renderer derives from rolling-window store data (§5.3). */
export interface MomentumInput {
  /** Sessions + dreams + check-ins logged in the rolling window. */
  showedUpThisWeek: number;
  /** Distinct life-areas / feature domains the person has engaged. */
  areasExplored: number;
  /** Open/in-progress goals touched recently (39). */
  goalsMovingForward: number;
}

/** A meaningful completion to celebrate once (§3.5). */
export interface Completion {
  /** Stable signature recorded in the device-local per-person dismissal store (`celebrate:<key>`). */
  key: string;
  title: string;
  body?: string;
  /** ISO timestamp the completion happened — used to ignore ancient history. */
  at: string;
}

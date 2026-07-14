/**
 * 60-home-dashboard-redesign — pure view types for the Hybrid Home's cross-feature derivations (Slice 1).
 *
 * NOTHING here is persisted. Like `@selfos/core/recommendations`'s `PersonRecommendationState`, each shape is
 * a MINIMAL plain input the renderer assembles from stores it already loaded — so this module stays
 * cycle-free (no domain-schema imports) and every derivation is pure + unit-testable + host-agnostic
 * (`@selfos/core` is node/Buffer-free). The renderer maps its store data into these inputs.
 */

// ---------------------------------------------------------------------------
// Quick-action dock (§3.1.2)
// ---------------------------------------------------------------------------

export type QuickActionId = 'start-session' | 'log-dream' | 'ask-someone' | 'check-in';

/** One one-tap starter in the dock. Capability-gated so a dead action never renders. */
export interface QuickAction {
  id: QuickActionId;
  label: string;
  hint: string;
  /** Where the action navigates — a DIRECT route to the action itself, not its parent page. */
  route: string;
  /** Optional router navigation state so a route can open its composer/flow directly (e.g. `{ compose: true }`). */
  state?: Record<string, unknown>;
  /** The capability the active person must hold for this action to appear. */
  capability: string;
}

// ---------------------------------------------------------------------------
// Rhythm streak (§3.1.1 / §3.7) — positive-only by construction
// ---------------------------------------------------------------------------

export interface StreakInput {
  now: Date;
  /** ISO timestamps of ANY meaningful activity (session/dream/check-in/questionnaire-answer/together/challenge). */
  activity: string[];
  /** Recurring distress (40) — suppress the streak entirely; a struggling person is never streak-shamed (§8). */
  crisis?: boolean;
}

/**
 * A gentle "rhythm" — consecutive local days (ending today or yesterday) with ≥1 activity. **Positive-only**:
 * it can only ever report a run that IS happening; it never returns a gap, a "broken streak", or a missed-day
 * count. A quiet day simply ends the run (`days:0`) and the UI shows nothing — never a scold (§8).
 */
export interface StreakInfo {
  /** Consecutive active days ending today/yesterday; `0` when the run is broken OR suppressed. */
  days: number;
  /** ISO local date (YYYY-MM-DD) the current run started; absent when `days === 0`. */
  since?: string;
  /** True during a crisis signal — the caller hides the streak entirely (§8). */
  suppressed: boolean;
}

// ---------------------------------------------------------------------------
// Life-rings (§3.1.6) — a whole-life glance, "a reflection, not a score to chase"
// ---------------------------------------------------------------------------

export type LifeRingKey = 'wellbeing' | 'connection' | 'reflection' | 'growth';

export interface LifeRing {
  key: LifeRingKey;
  label: string;
  /** 0..1 fill for the ring arc. */
  value: number;
  /** `Math.round(value * 100)` — the % the owner wanted shown alongside the level word. */
  pct: number;
  /** The headline word (Quiet → Warming → Steady → Active → Thriving). Always present (never color-only, §9). */
  levelLabel: string;
  /** During a crisis signal the ring is softened: the caller shows only `levelLabel`, no `pct`/bar (§8). */
  softened: boolean;
}

/** The minimal signals each ring derives from — the renderer pre-computes these from already-loaded stores. */
export interface LifeRingsInput {
  /** Recurring distress (40) — soften every ring to a supportive, score-free presentation (§8). */
  crisis?: boolean;
  signals: {
    /** Mean session/check-in mood valence, −1..1, over the recent window. Undefined ⇒ wellbeing ring absent. */
    moodValenceMean?: number;
    /** Recent deliberate mood check-ins (adds confidence to the wellbeing value). */
    checkInCount?: number;
    /** The person has any relationships. False/undefined ⇒ connection ring absent. */
    hasRelationships?: boolean;
    /** Active partner edges (Together). */
    activePartners?: number;
    /** Recent Together message/turn events. */
    togetherEventsRecent?: number;
    /** Sessions in the recent window. */
    sessionsRecent?: number;
    /** Dreams in the recent window. */
    dreamsRecent?: number;
    /** Distinct life-areas engaged (memory categories). */
    areasExplored?: number;
    /** Open goals moving forward recently. */
    goalsMoving?: number;
  };
}

// ---------------------------------------------------------------------------
// Cross-feature activity feed (§3.1.6)
// ---------------------------------------------------------------------------

export type ActivityDomain =
  | 'session'
  | 'dream'
  | 'insight'
  | 'inbox'
  | 'questionnaire'
  | 'together'
  | 'challenge'
  | 'goal'
  | 'wellbeing';

/** One entry in the "recent across everything" stream. */
export interface ActivityEvent {
  /** Stable, unique across the merged feed (domain-prefixed) — drives dedup + React keys. */
  id: string;
  domain: ActivityDomain;
  title: string;
  detail?: string;
  /** ISO timestamp the event happened; the feed is sorted newest-first by this. */
  at: string;
  /** An in-app route the entry navigates to; absent ⇒ a non-navigating (on-page-handled) entry. */
  route?: string;
  /** True when the entry invites an action (needs review / your turn / due) — visually emphasized. */
  actionable: boolean;
}

/** The already-loaded store data the feed merges. Every array is optional (absent ⇒ contributes nothing). */
export interface ActivityFeedInput {
  now: Date;
  /** Only include events within this many days (default 14). */
  windowDays?: number;
  /** Cap the merged feed to this many entries (default 8). */
  limit?: number;
  sessions?: { id: string; title: string; status: string; updatedAt: string }[];
  dreams?: { id: string; title?: string; createdAt: string }[];
  /** Unapproved insights = "needs review"; approved recent ones are the person's captured memory (not fed). */
  insights?: { id: string; summary: string; approved: boolean; createdAt: string }[];
  inbox?: {
    assignmentId: string;
    title: string;
    senderName: string;
    createdAt: string;
    answerable: boolean;
    fromSelf: boolean;
  }[];
  sentOverview?: {
    questionnaireId: string;
    recipientName?: string;
    newResponses: number;
    answeredAt?: string;
    lastSentAt: string;
  }[];
  together?: {
    id: string;
    partnerName?: string;
    yourTurn: boolean;
    unreadCount: number;
    status: string;
    lastMessageAt?: string;
    createdAt: string;
  }[];
  challenges?: {
    id: string;
    action: string;
    status: string;
    checkInAt?: string;
    agreedAt?: string;
    createdAt: string;
  }[];
  goals?: { id: string; text: string; status: string; updatedAt: string }[];
  /** Deliberate mood/anxiety check-in results (takenAt). */
  moodCheckIns?: { at: string }[];
}

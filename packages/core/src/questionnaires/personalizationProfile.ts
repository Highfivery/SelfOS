import { z } from 'zod';

import type { FileSystem } from '../host';
import { uuid } from '../id';
import { readEncryptedJson, writeEncryptedJson } from '../vault';
import {
  NOT_APPLICABLE_SKIP_REASON,
  PREFER_NOT_TO_SAY_SKIP_REASON,
  UNCLEAR_SKIP_REASON,
} from './answering';
import { isNearDuplicate } from './dedup';
import { TopicSchema } from './topicMap';

/**
 * The per-person **Personalization Profile** (spec 69 §4) — one encrypted doc at
 * `people/<personId>/questionnaires/personalizationProfile.enc` that every generation path reads and every
 * answer/skip/insight-change updates, so questionnaires learn and evolve.
 *
 * This module is the store + the pure `apply*` helpers. Phase 1 (this slice) populates the **feedback
 * ledger** (differentiated skips/declines) and the **change log** (numeric shifts). The `coverage` map and
 * `relational` signals are part of the persisted shape from v1 (forward-compat, tolerant-parsed) but are
 * populated in later phases (coverage → Phase 2, reciprocity → Phase 3) — no `schemaVersion` bump needed then.
 *
 * The schema is defined in this module (not the shared `schemas.ts`): the profile is a core-internal artifact
 * that does not cross the IPC seam (the Phase-5 transparency panel sends a projected view, not the raw doc),
 * so it needs no shared shape — and keeping it local avoids churning the central schema file.
 */

const SCHEMA_VERSION = 1;

/** Rolling caps so the doc stays economical (oldest dropped past the cap). */
export const FEEDBACK_CAP = 300;
export const CHANGE_CAP = 100;
export const RECIPROCITY_CAP = 100;
/**
 * Candidate caps (spec 70 §3.2/§13): the stored set is bounded (never drops a person's pinned candidate), the
 * FEED shows at most `FEED_CANDIDATE_CAP`, and a refresh proposes at most `CANDIDATES_PER_AREA` per life area so
 * one area can't crowd the feed.
 */
export const CANDIDATE_CAP = 16;
export const FEED_CANDIDATE_CAP = 10;
export const CANDIDATES_PER_AREA = 3;
/** Bound "Explore with your partner" wishes so the doc + the partner's prompt stay economical (spec 70 §3.5). */
export const PARTNER_WISH_CAP = 40;
/** How many wishes per partner reach the partner's generation prompt (bounded to keep the steer focused). */
export const PARTNER_WISH_GUIDANCE_CAP = 8;
/** A wish note longer than this is trimmed (a wish is a short topic, not an essay). */
export const PARTNER_WISH_MAX_LEN = 300;
/**
 * Declined ("Not this") candidates are retained ONLY as bounded de-dup memory (so the next refresh doesn't
 * re-propose the exact phrasing) — separate from the active feed cap, and aged out, so repeated "Not this" is
 * never a topic ban (spec 70 §13; the area-level "Leave alone" is the topic ban).
 */
export const SKIPPED_CANDIDATE_CAP = 24;

/**
 * "Prefer not to say" backs off long-term; a gentle re-approach is allowed only after this window, and only
 * from a fresh angle — never the same wording (spec 69 §13). Read by the engine at selection time (slice 1b).
 */
export const PREFER_NOT_COOLDOWN_DAYS = 180;

const ReopenSignalSchema = z.enum(['new-material', 'profile-edit', 'explicit-request', 'dormant']);

const CoverageTopicSchema = z.object({
  topicId: z.string(),
  lifeArea: z.string(),
  label: z.string(),
  explored: z.boolean(),
  depth: z.number().min(0).max(1),
  askedCount: z.number().int().min(0),
  saturated: z.boolean(),
  lastAskedAt: z.string().optional(),
  reopenedBy: ReopenSignalSchema.optional(),
});
export type CoverageTopic = z.infer<typeof CoverageTopicSchema>;

/**
 * How a piece of answer feedback steers future generation:
 * - `unclear`            — "Not clear — needs more context" → reword / re-approach the topic differently.
 * - `not-applicable`     — "Doesn’t apply to me" (not right about me) → stop mining that topic.
 * - `prefer-not-to-say`  — a boundary → back off long-term (`PREFER_NOT_COOLDOWN_DAYS`, rare fresh re-approach).
 * - `skipped`            — a reasonless / unclassified free-text skip → weak signal (don't re-ask, mild
 *                          de-prioritize), never a hard topic suppression.
 * - `answered-richly`    — strong engagement → this vein is productive, deepening here is justified.
 * - `bailed`             — opened then abandoned → low-engagement signal (de-prioritize length/complexity).
 */
export const FeedbackKindSchema = z.enum([
  'unclear',
  'not-applicable',
  'prefer-not-to-say',
  'skipped',
  'answered-richly',
  'bailed',
]);
export type FeedbackKind = z.infer<typeof FeedbackKindSchema>;

const FeedbackEntrySchema = z.object({
  topicId: z.string().optional(),
  questionPrompt: z.string().optional(),
  kind: FeedbackKindSchema,
  reason: z.string().optional(),
  assignmentId: z.string().optional(),
  at: z.string(),
});
export type FeedbackEntry = z.infer<typeof FeedbackEntrySchema>;

const ChangeEntrySchema = z.object({
  topicId: z.string().optional(),
  metricKey: z.string().optional(),
  /** A human-readable label for the changed thing (e.g. the question prompt) — used in the "what changed?" hint. */
  label: z.string().optional(),
  kind: z.enum(['numeric-shift', 'contradiction']),
  from: z.string(),
  to: z.string(),
  detectedAt: z.string(),
  explored: z.boolean(),
});
export type ChangeEntry = z.infer<typeof ChangeEntrySchema>;

const ReciprocityCandidateSchema = z.object({
  fromPartnerId: z.string(),
  topicId: z.string().optional(),
  note: z.string(),
  at: z.string(),
  explored: z.boolean(),
});
export type ReciprocityCandidate = z.infer<typeof ReciprocityCandidateSchema>;

/**
 * One "Explore with your partner" wish (spec 70 §3.5) — the person's OWN free-text about a topic to explore WITH
 * a connected partner. Stored in the REQUESTER's profile; it silently steers the PARTNER's generation (never
 * quoted, never attributed). An `intimacy` wish only steers intimacy questions when BOTH partners hold the 18+
 * ack (§8).
 */
const PartnerWishSchema = z.object({
  id: z.string(),
  partnerPersonId: z.string(),
  note: z.string(),
  intimacy: z.boolean().catch(false).default(false),
  at: z.string(),
});
export type PartnerWish = z.infer<typeof PartnerWishSchema>;

/** A candidate is either NEW ground or a GO-DEEPER follow-up on a thread already touched (spec 70 §3.2). */
export const NextCandidateKindSchema = z.enum(['new', 'go-deeper']);
export type NextCandidateKind = z.infer<typeof NextCandidateKindSchema>;

/**
 * How the person has curated a candidate (spec 70 §3.2):
 * - `asked`     — "Ask me this" → pinned; leads the next generation.
 * - `skipped`   — "Not this" → declines THIS candidate (a different one next refresh); NOT a topic ban.
 * - `go-deeper` — "Go deeper" → mark the underlying thread for a deeper follow-up.
 * - `none`      — un-curated.
 */
export const CandidateCurationSchema = z.enum(['asked', 'skipped', 'go-deeper', 'none']);
export type CandidateCuration = z.infer<typeof CandidateCurationSchema>;

/** A cached candidate question SelfOS is curious about asking this person next (spec 70 §3.2/§4.1). */
const NextCandidateSchema = z.object({
  id: z.string(),
  lifeArea: z.string(),
  topicId: z.string().optional(),
  prompt: z.string(),
  kind: NextCandidateKindSchema,
  curation: CandidateCurationSchema.catch('none').default('none'),
  /** Set once generation actually minted an assignment asking it → drops off the feed + stops steering. */
  mintedAssignmentId: z.string().optional(),
  at: z.string(),
});
export type NextCandidate = z.infer<typeof NextCandidateSchema>;

export const PersonalizationProfileSchema = z.object({
  schemaVersion: z.number().default(SCHEMA_VERSION),
  personId: z.string(),
  updatedAt: z.string(),
  coverage: z
    .object({
      topics: z.array(CoverageTopicSchema).catch([]).default([]),
      lastPlacementAt: z.string().optional(),
    })
    .default({ topics: [] }),
  feedback: z.array(FeedbackEntrySchema).catch([]).default([]),
  changes: z.array(ChangeEntrySchema).catch([]).default([]),
  // The forward-first candidate feed (spec 70 §3.2) — additive-optional, tolerant-parsed, no schemaVersion bump
  // (the spec 69 §4.1 precedent). Absent on a pre-spec-70 profile → an empty feed derived on the next refresh.
  candidates: z.array(NextCandidateSchema).catch([]).default([]),
  candidatesRefreshedAt: z.string().optional(),
  // The emergent topic map (spec 71 §5.3) — this person's evolving vocabulary of explored ground. Additive-
  // optional and tolerant-parsed (no `schemaVersion` bump, the spec 69 §4.1 precedent): absent ⇒ seeded from
  // the built-in categories on first use. Counts are NOT stored here — they derive from the ask ledger, so
  // they can never drift from what was actually asked.
  topics: z.array(TopicSchema).catch([]).optional(),
  relational: z
    .object({
      reciprocity: z.array(ReciprocityCandidateSchema).catch([]).default([]),
      // "Explore with your partner" wishes (spec 70 §3.5) — additive-optional, tolerant, no schemaVersion bump.
      partnerWishes: z.array(PartnerWishSchema).catch([]).default([]),
    })
    .optional(),
});
export type PersonalizationProfile = z.infer<typeof PersonalizationProfileSchema>;

const profilePath = (personId: string): string =>
  `people/${personId}/questionnaires/personalizationProfile.enc`;

/** A fresh, all-uncovered profile — the correct starting state when no file exists yet (spec 69 §7). */
export function emptyProfile(personId: string): PersonalizationProfile {
  return {
    schemaVersion: SCHEMA_VERSION,
    personId,
    updatedAt: new Date(0).toISOString(),
    coverage: { topics: [] },
    feedback: [],
    changes: [],
    candidates: [],
  };
}

/**
 * Read the person's profile, deriving a fresh empty one when absent. A corrupt/partial doc degrades to a safe
 * default (tolerant parse) rather than throwing out of a generation that depends on it (spec 69 §7).
 */
export async function readProfile(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<PersonalizationProfile> {
  const raw = await readEncryptedJson(fs, profilePath(personId), key);
  if (!raw) return emptyProfile(personId);
  const parsed = PersonalizationProfileSchema.safeParse(raw);
  return parsed.success ? parsed.data : emptyProfile(personId);
}

export async function writeProfile(
  fs: FileSystem,
  key: Uint8Array,
  profile: PersonalizationProfile,
): Promise<void> {
  await writeEncryptedJson(fs, profilePath(profile.personId), profile, key);
}

/** Map a decline's reason (a preset or free text) to its steering kind (spec 69 §5.9). */
export function classifyDeclineReason(reason: string | undefined): FeedbackKind {
  const r = (reason ?? '').trim();
  if (r === UNCLEAR_SKIP_REASON) return 'unclear';
  if (r === PREFER_NOT_TO_SAY_SKIP_REASON) return 'prefer-not-to-say';
  if (r === NOT_APPLICABLE_SKIP_REASON) return 'not-applicable';
  // A reasonless or free-text skip: a weak signal. Don't hard-suppress the topic.
  return 'skipped';
}

const norm = (s: string | undefined): string => (s ?? '').trim().toLowerCase();

function prependCapped<T>(list: readonly T[], entry: T, cap: number): T[] {
  return [entry, ...list].slice(0, cap);
}

/**
 * Record a per-question decline as a feedback entry, keyed by topic + reason. Collapses an identical prior
 * entry (same topic/kind/prompt) so re-skipping the same question refreshes rather than bloats. Pure —
 * returns a new profile.
 */
export function applyDecline(
  profile: PersonalizationProfile,
  input: {
    topicId?: string;
    questionPrompt?: string;
    reason?: string;
    assignmentId?: string;
  },
  now: Date,
): PersonalizationProfile {
  const kind = classifyDeclineReason(input.reason);
  const reason = input.reason?.trim();
  const entry: FeedbackEntry = {
    ...(input.topicId ? { topicId: input.topicId } : {}),
    ...(input.questionPrompt?.trim() ? { questionPrompt: input.questionPrompt.trim() } : {}),
    kind,
    ...(reason ? { reason } : {}),
    ...(input.assignmentId ? { assignmentId: input.assignmentId } : {}),
    at: now.toISOString(),
  };
  const kept = profile.feedback.filter(
    (f) =>
      !(
        f.kind === kind &&
        norm(f.topicId) === norm(input.topicId) &&
        norm(f.questionPrompt) === norm(input.questionPrompt)
      ),
  );
  return {
    ...profile,
    feedback: prependCapped(kept, entry, FEEDBACK_CAP),
    updatedAt: now.toISOString(),
  };
}

/**
 * Record an engagement signal for an answered question — `answered-richly` (a productive vein) or `bailed`
 * (opened, abandoned). Keyed by topic; collapses a prior identical signal. Pure.
 */
export function applyEngagement(
  profile: PersonalizationProfile,
  input: { topicId?: string; questionPrompt?: string; engagement: 'rich' | 'bailed' },
  now: Date,
): PersonalizationProfile {
  const kind: FeedbackKind = input.engagement === 'rich' ? 'answered-richly' : 'bailed';
  const entry: FeedbackEntry = {
    ...(input.topicId ? { topicId: input.topicId } : {}),
    ...(input.questionPrompt?.trim() ? { questionPrompt: input.questionPrompt.trim() } : {}),
    kind,
    at: now.toISOString(),
  };
  const kept = profile.feedback.filter(
    (f) =>
      !(
        f.kind === kind &&
        norm(f.topicId) === norm(input.topicId) &&
        norm(f.questionPrompt) === norm(input.questionPrompt)
      ),
  );
  return {
    ...profile,
    feedback: prependCapped(kept, entry, FEEDBACK_CAP),
    updatedAt: now.toISOString(),
  };
}

const changeKey = (c: {
  topicId?: string | undefined;
  metricKey?: string | undefined;
  kind: 'numeric-shift' | 'contradiction';
}): string => `${norm(c.topicId)}|${norm(c.metricKey)}|${c.kind}`;

/**
 * Record a detected change ("used to say X, now Y") as an unexplored change entry. Idempotent: re-detecting
 * the same shift (same from→to) is a no-op (preserves `explored`); a genuinely new shift (different `to`)
 * replaces the prior one and resets `explored` to false. Pure. (spec 69 §5.8)
 */
export function applyChange(
  profile: PersonalizationProfile,
  input: {
    topicId?: string;
    metricKey?: string;
    label?: string;
    kind: 'numeric-shift' | 'contradiction';
    from: string;
    to: string;
  },
  now: Date,
): PersonalizationProfile {
  const existing = profile.changes.find((c) => changeKey(c) === changeKey(input));
  if (
    existing &&
    norm(existing.to) === norm(input.to) &&
    norm(existing.from) === norm(input.from)
  ) {
    return profile; // already recorded — don't reset explored or bump updatedAt
  }
  const entry: ChangeEntry = {
    ...(input.topicId ? { topicId: input.topicId } : {}),
    ...(input.metricKey ? { metricKey: input.metricKey } : {}),
    ...(input.label?.trim() ? { label: input.label.trim() } : {}),
    kind: input.kind,
    from: input.from,
    to: input.to,
    detectedAt: now.toISOString(),
    explored: false,
  };
  const kept = profile.changes.filter((c) => changeKey(c) !== changeKey(input));
  return {
    ...profile,
    changes: prependCapped(kept, entry, CHANGE_CAP),
    updatedAt: now.toISOString(),
  };
}

/**
 * Mark matching change entries explored (after the engine has asked "what changed?" about them), so they are
 * not re-asked. Matches on the provided fields (topic/metric/kind); an empty match set marks nothing. Pure.
 */
export function markChangesExplored(
  profile: PersonalizationProfile,
  match: { topicId?: string; metricKey?: string; kind?: 'numeric-shift' | 'contradiction' },
  now: Date,
): PersonalizationProfile {
  let changed = false;
  const changes = profile.changes.map((c) => {
    const hit =
      (match.topicId === undefined || norm(c.topicId) === norm(match.topicId)) &&
      (match.metricKey === undefined || norm(c.metricKey) === norm(match.metricKey)) &&
      (match.kind === undefined || c.kind === match.kind);
    if (hit && !c.explored) {
      changed = true;
      return { ...c, explored: true };
    }
    return c;
  });
  if (!changed) return profile;
  return { ...profile, changes, updatedAt: now.toISOString() };
}

/**
 * Persist reciprocity candidates (spec 69 §5.4 follow-on) — a partner's shared desire/need to reflect back.
 * Upserts by (partner, note): a candidate already recorded is kept as-is (its original `at` ages out of the
 * fresh window so a stable desire stops being re-nudged); a genuinely NEW one is added unexplored. Pure.
 */
export function applyReciprocity(
  profile: PersonalizationProfile,
  candidates: readonly { fromPartnerId: string; note: string; topicId?: string }[],
  now: Date,
): PersonalizationProfile {
  const existing = profile.relational?.reciprocity ?? [];
  const seen = new Set(existing.map((r) => `${r.fromPartnerId}|${norm(r.note)}`));
  const added: ReciprocityCandidate[] = [];
  for (const c of candidates) {
    const note = c.note.trim();
    if (!note) continue;
    const k = `${c.fromPartnerId}|${norm(note)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    added.push({
      fromPartnerId: c.fromPartnerId,
      ...(c.topicId ? { topicId: c.topicId } : {}),
      note,
      at: now.toISOString(),
      explored: false,
    });
  }
  if (added.length === 0) return profile;
  return {
    ...profile,
    relational: {
      reciprocity: [...added, ...existing].slice(0, RECIPROCITY_CAP),
      partnerWishes: profile.relational?.partnerWishes ?? [],
    },
    updatedAt: now.toISOString(),
  };
}

// ── "Explore with your partner" wishes (spec 70 §3.5) ──────────────────────────────────────────────────────

/**
 * Add a partner wish to the person's OWN profile (spec 70 §3.5). Trims + bounds the note; de-dups an identical
 * (partner, note) so re-adding refreshes rather than bloats; caps the total. A blank note is a no-op. Pure.
 */
export function addPartnerWish(
  profile: PersonalizationProfile,
  input: { partnerPersonId: string; note: string; intimacy?: boolean },
  now: Date,
): PersonalizationProfile {
  const note = input.note.trim().slice(0, PARTNER_WISH_MAX_LEN);
  const partnerPersonId = input.partnerPersonId.trim();
  if (!note || !partnerPersonId) return profile;
  const existing = profile.relational?.partnerWishes ?? [];
  const kept = existing.filter(
    (w) => !(w.partnerPersonId === partnerPersonId && norm(w.note) === norm(note)),
  );
  const entry: PartnerWish = {
    id: uuid(),
    partnerPersonId,
    note,
    intimacy: input.intimacy === true,
    at: now.toISOString(),
  };
  return {
    ...profile,
    relational: {
      reciprocity: profile.relational?.reciprocity ?? [],
      partnerWishes: [entry, ...kept].slice(0, PARTNER_WISH_CAP),
    },
    updatedAt: now.toISOString(),
  };
}

/** Remove a partner wish by id from the person's OWN profile (spec 70 §3.5). No-op if absent. Pure. */
export function removePartnerWish(
  profile: PersonalizationProfile,
  wishId: string,
  now: Date,
): PersonalizationProfile {
  const existing = profile.relational?.partnerWishes ?? [];
  const kept = existing.filter((w) => w.id !== wishId);
  if (kept.length === existing.length) return profile;
  return {
    ...profile,
    relational: {
      reciprocity: profile.relational?.reciprocity ?? [],
      partnerWishes: kept,
    },
    updatedAt: now.toISOString(),
  };
}

// ── Candidate feed (spec 70 §3.2) — the forward-first "what SelfOS is curious about next" pool ──────────────

/** The panel/IPC curation action → the persisted curation state. */
const CURATION_FOR_ACTION: Record<'ask' | 'not-this' | 'go-deeper' | 'clear', CandidateCuration> = {
  ask: 'asked',
  'not-this': 'skipped',
  'go-deeper': 'go-deeper',
  clear: 'none',
};

/** A candidate is live in the feed / steers generation while it hasn't been asked and isn't "Not this". */
export const isActiveCandidate = (c: NextCandidate): boolean =>
  c.mintedAssignmentId === undefined && c.curation !== 'skipped';

/**
 * Apply a curation tap to one candidate (spec 70 §3.2). Cheap, no AI: writes the candidate's curation state so
 * the next generation honors it (`ask` pins/leads, `not-this` excludes, `go-deeper` biases the thread to depth,
 * `clear` un-curates). A no-op for an unknown / already-minted candidate. Pure — returns a new profile.
 */
export function applyCandidateCuration(
  profile: PersonalizationProfile,
  input: { candidateId: string; action: 'ask' | 'not-this' | 'go-deeper' | 'clear' },
  now: Date,
): PersonalizationProfile {
  const curation = CURATION_FOR_ACTION[input.action];
  let changed = false;
  const candidates = profile.candidates.map((c) => {
    if (c.id !== input.candidateId || c.mintedAssignmentId !== undefined) return c;
    if (c.curation === curation) return c;
    changed = true;
    return { ...c, curation };
  });
  if (!changed) return profile;
  return { ...profile, candidates, updatedAt: now.toISOString() };
}

/**
 * Clear the whole candidate feed (spec 70 §3.2) — mark every ACTIVE candidate "skipped" (like tapping ✕ on
 * each), so the feed empties and the next refresh proposes fresh ones. Already-minted candidates are left
 * untouched (they've been asked, not shown). Pure; a no-op (unchanged profile) when the feed is already empty.
 */
export function clearCandidateFeed(
  profile: PersonalizationProfile,
  now: Date,
): PersonalizationProfile {
  let changed = false;
  const candidates = profile.candidates.map((c) => {
    if (!isActiveCandidate(c)) return c;
    changed = true;
    return { ...c, curation: 'skipped' as CandidateCuration };
  });
  if (!changed) return profile;
  return { ...profile, candidates, updatedAt: now.toISOString() };
}

/**
 * Stamp every not-yet-minted candidate whose prompt was actually asked (near-duplicates one of `askedPrompts`)
 * with the assignment that asked it, so it drops off the feed + stops steering generation (spec 70 §3.2/§5.5).
 * Pure; idempotent (an already-stamped candidate is untouched). `''`-safe.
 */
export function markCandidateAsked(
  profile: PersonalizationProfile,
  input: { assignmentId: string; askedPrompts: readonly string[] },
  now: Date,
): PersonalizationProfile {
  const asked = input.askedPrompts.map((p) => p.trim()).filter(Boolean);
  if (asked.length === 0) return profile;
  let changed = false;
  const candidates = profile.candidates.map((c) => {
    if (c.mintedAssignmentId !== undefined) return c;
    if (!isNearDuplicate(c.prompt, asked)) return c;
    changed = true;
    return { ...c, mintedAssignmentId: input.assignmentId };
  });
  if (!changed) return profile;
  return { ...profile, candidates, updatedAt: now.toISOString() };
}

/**
 * Merge a fresh AI-proposed candidate set into the profile (spec 70 §5.3), preserving curation + minted state
 * and honoring the person's steering. Pure — returns a new profile.
 *
 * - Existing candidates that were **actually asked** (minted, or their prompt now near-duplicates an already-asked
 *   prompt) drop off the feed — the self-heal backstop for a mint path that didn't call `markCandidateAsked`.
 * - Surviving existing candidates (incl. the person's `asked`/`skipped`/`go-deeper` curation) carry forward.
 * - A proposed candidate is dropped when it near-duplicates an already-asked prompt, a surviving candidate, or a
 *   `skipped` one (the person declined that phrasing — never re-propose it identically, spec 70 §3.2).
 * - Per-area (`CANDIDATES_PER_AREA`) + total (`CANDIDATE_CAP`) caps bound the feed; curated candidates are kept
 *   preferentially so a cap never silently drops a person's pin.
 */
export function mergeCandidates(
  profile: PersonalizationProfile,
  proposed: readonly {
    lifeArea: string;
    prompt: string;
    kind: NextCandidateKind;
    topicId?: string;
  }[],
  askedPrompts: readonly string[],
  now: Date,
): PersonalizationProfile {
  const asked = askedPrompts.map((p) => p.trim()).filter(Boolean);
  const wasAsked = (prompt: string): boolean => asked.length > 0 && isNearDuplicate(prompt, asked);

  // Existing candidates that weren't actually asked survive. Split ACTIVE (in the feed / steering) from DECLINED
  // ("Not this"). Declined ones are kept ONLY as bounded de-dup memory — never counted toward the caps and never
  // blocking their area — so repeated "Not this" declines THAT phrasing, never the topic (spec 70 §3.2/§13).
  const activeSurvivors: NextCandidate[] = [];
  const declinedSurvivors: NextCandidate[] = [];
  for (const c of profile.candidates) {
    if (c.mintedAssignmentId !== undefined) continue; // already asked → gone from the feed
    if (wasAsked(c.prompt)) continue; // asked via some path we didn't stamp → drop it (self-heal)
    if (c.curation === 'skipped') declinedSurvivors.push(c);
    else activeSurvivors.push(c);
  }

  const nowIso = now.toISOString();
  // Per-area + de-dup accounting is over ACTIVE candidates only, so a declined area can always be re-filled.
  const perArea = new Map<string, number>();
  for (const c of activeSurvivors) perArea.set(c.lifeArea, (perArea.get(c.lifeArea) ?? 0) + 1);
  const seen = activeSurvivors.map((c) => c.prompt);
  const declined = declinedSurvivors.map((c) => c.prompt);

  const fresh: NextCandidate[] = [];
  for (const p of proposed) {
    const prompt = p.prompt.trim();
    if (!prompt) continue;
    if (wasAsked(prompt)) continue;
    if (isNearDuplicate(prompt, seen)) continue;
    if (declined.length > 0 && isNearDuplicate(prompt, declined)) continue;
    if ((perArea.get(p.lifeArea) ?? 0) >= CANDIDATES_PER_AREA) continue;
    perArea.set(p.lifeArea, (perArea.get(p.lifeArea) ?? 0) + 1);
    seen.push(prompt);
    fresh.push({
      id: uuid(),
      lifeArea: p.lifeArea,
      ...(p.topicId ? { topicId: p.topicId } : {}),
      prompt,
      kind: p.kind,
      curation: 'none',
      at: nowIso,
    });
  }

  // The active feed: pinned / go-deeper-curated candidates first (a cap never drops them while the curated set
  // stays under CANDIDATE_CAP — the common case), then newest.
  const active = [...activeSurvivors, ...fresh]
    .sort((a, b) => {
      const ca = a.curation !== 'none' ? 0 : 1;
      const cb = b.curation !== 'none' ? 0 : 1;
      if (ca !== cb) return ca - cb;
      return b.at.localeCompare(a.at);
    })
    .slice(0, CANDIDATE_CAP);
  // Declined candidates are bounded de-dup memory (newest first) that ages out — so a "Not this" declines the
  // phrasing now, and a fresh angle on that ground is allowed again once it falls out of the window.
  const declinedKept = [...declinedSurvivors]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, SKIPPED_CANDIDATE_CAP);

  return {
    ...profile,
    candidates: [...active, ...declinedKept],
    candidatesRefreshedAt: nowIso,
    updatedAt: nowIso,
  };
}

/**
 * A steer action from the transparency panel (spec 69 §3.4). Reuses the existing ledger + coverage rather
 * than a new persisted field:
 * - `leave-alone`  → record a `not-applicable` feedback entry for the topic (→ the avoid list, reversible)
 *                    and clear any prior `explore-more` reopen on its coverage topic.
 * - `explore-more` → set the coverage topic's `reopenedBy: 'explicit-request'` (un-saturated), so it LEADS
 *                    the coverage guidance regardless of depth, and clear any prior avoid/boundary entry for
 *                    it (the person is explicitly overriding a past "leave it alone"). The two are mutually
 *                    exclusive per topic, so each toggle undoes the other.
 * - `clear`        → neutral: remove any explore-more reopen AND any avoid/boundary entry for the topic (the
 *                    person toggled a steer back off).
 */
export function applySteer(
  profile: PersonalizationProfile,
  input: {
    topicId: string;
    lifeArea?: string;
    label?: string;
    action: 'explore-more' | 'leave-alone' | 'clear';
  },
  now: Date,
): PersonalizationProfile {
  const topicId = input.topicId.trim();
  if (!topicId) return profile;
  const label = input.label?.trim() || topicId;
  const nowIso = now.toISOString();

  const dropReopen = (topics: readonly CoverageTopic[]): CoverageTopic[] =>
    topics.map((t) => {
      if (t.topicId !== topicId || t.reopenedBy !== 'explicit-request') return t;
      const { reopenedBy: _reopenedBy, ...rest } = t;
      void _reopenedBy;
      return rest;
    });
  const dropSuppression = (feedback: readonly FeedbackEntry[]): FeedbackEntry[] =>
    feedback.filter(
      (f) =>
        !(
          (f.kind === 'not-applicable' || f.kind === 'prefer-not-to-say') &&
          norm(f.topicId) === norm(topicId)
        ),
    );

  if (input.action === 'clear') {
    const hadReopen = profile.coverage.topics.some(
      (t) => t.topicId === topicId && t.reopenedBy === 'explicit-request',
    );
    const feedback = dropSuppression(profile.feedback);
    const hadSuppression = feedback.length !== profile.feedback.length;
    if (!hadReopen && !hadSuppression) return profile; // nothing to clear — don't churn updatedAt
    return {
      ...profile,
      coverage: { ...profile.coverage, topics: dropReopen(profile.coverage.topics) },
      feedback,
      updatedAt: nowIso,
    };
  }

  if (input.action === 'leave-alone') {
    // Drop any prior explore-more reopen on the coverage topic (the toggle undoes it).
    const topics = dropReopen(profile.coverage.topics);
    // Record (or refresh) a not-applicable feedback entry keyed by topic → the avoid list.
    const entry: FeedbackEntry = {
      topicId,
      questionPrompt: label,
      kind: 'not-applicable',
      at: nowIso,
    };
    const keptFeedback = profile.feedback.filter(
      (f) => !(f.kind === 'not-applicable' && norm(f.topicId) === norm(topicId)),
    );
    return {
      ...profile,
      coverage: { ...profile.coverage, topics },
      feedback: prependCapped(keptFeedback, entry, FEEDBACK_CAP),
      updatedAt: nowIso,
    };
  }

  // explore-more: the person explicitly overrides any past "leave alone" and asks for this ground.
  const keptFeedback = dropSuppression(profile.feedback);
  const existing = profile.coverage.topics.find((t) => t.topicId === topicId);
  let topics: CoverageTopic[];
  if (existing) {
    topics = profile.coverage.topics.map((t) =>
      t.topicId === topicId ? { ...t, reopenedBy: 'explicit-request', saturated: false } : t,
    );
  } else {
    topics = [
      ...profile.coverage.topics,
      {
        topicId,
        lifeArea: input.lifeArea?.trim() || topicId,
        label,
        explored: false,
        depth: 0,
        askedCount: 0,
        saturated: false,
        reopenedBy: 'explicit-request',
      },
    ];
  }
  return {
    ...profile,
    coverage: { ...profile.coverage, topics },
    feedback: keptFeedback,
    updatedAt: nowIso,
  };
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Cap each guidance list so the prompt block stays bounded. */
const GUIDANCE_LIST_CAP = 30;
/**
 * How long a detected-but-unexplored change stays in the "what changed?" hint (spec 69 §5.8). A fresh window
 * bounds the nudge without needing to confirm the model actually asked — a genuinely new shift (different
 * value) resets `detectedAt`, so it re-surfaces.
 */
const CHANGE_FRESH_DAYS = 45;
/** How long a recent abandonment ("bailed") keeps steering toward shorter/simpler questionnaires (§5.2). */
const BAILED_FRESH_DAYS = 45;

function uniqLabels(labels: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of labels) {
    const t = l.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out.slice(0, GUIDANCE_LIST_CAP);
}

/**
 * Turn the feedback ledger into a prompt block that steers generation (spec 69 §5.9), differentiated by reason:
 * - `not-applicable`    → a hard avoid list (don't ask this or closely related things).
 * - `prefer-not-to-say` → a boundary; avoided only while within `PREFER_NOT_COOLDOWN_DAYS` (after that a fresh
 *                         re-approach is allowed, so it drops off the avoid list).
 * - `unclear`           → a reword list (if you cover this ground, ask it a different, more concrete way).
 * - `answered-richly`   → a productive vein: going DEEPER (a fresh angle) here is justified (spec 69 §5.2).
 * - `bailed`            → recent abandonment → a general "keep it short + simple" note (topic-agnostic).
 * `skipped` is not steered here (a weak signal). Pure; `''` when there is nothing to say.
 */
export function buildFeedbackGuidance(profile: PersonalizationProfile, now: Date): string {
  const cutoff = new Date(now.getTime() - PREFER_NOT_COOLDOWN_DAYS * MS_PER_DAY).toISOString();
  const avoid: string[] = [];
  const boundary: string[] = [];
  const reword: string[] = [];
  const productive: string[] = [];
  for (const f of profile.feedback) {
    const label = f.questionPrompt ?? f.topicId;
    if (!label) continue;
    if (f.kind === 'not-applicable') avoid.push(label);
    else if (f.kind === 'prefer-not-to-say') {
      if (f.at >= cutoff) boundary.push(label);
    } else if (f.kind === 'unclear') reword.push(label);
    else if (f.kind === 'answered-richly') productive.push(label);
  }
  const sections: string[] = [];
  const a = uniqLabels(avoid);
  const b = uniqLabels(boundary);
  const r = uniqLabels(reword);
  // A productive vein is only a justification to go DEEPER — don't drown out the strong-new-ground bias, so
  // avoid a topic they've explicitly marked off / bounded (it may co-occur if a prior question landed both ways).
  const p = uniqLabels(productive.filter((l) => !a.includes(l) && !b.includes(l)));
  if (a.length)
    sections.push(
      `They have indicated these DON'T APPLY to them — do NOT ask about these or closely related things:\n${a
        .map((l) => `- ${l}`)
        .join('\n')}`,
    );
  if (b.length)
    sections.push(
      `These touch a boundary they'd rather not discuss right now — leave them alone:\n${b
        .map((l) => `- ${l}`)
        .join('\n')}`,
    );
  if (r.length)
    sections.push(
      `These questions landed as UNCLEAR to them — if you cover this ground at all, ask it a DIFFERENT, more` +
        ` concrete and specific way (never the same wording):\n${r.map((l) => `- ${l}`).join('\n')}`,
    );
  // Question-quality self-selection (spec 69 §5.2 / Phase 5): the person engaged RICHLY here — this vein is
  // productive, so going DEEPER (a fresh, more specific angle) is a justified exception to the new-ground bias.
  // Never re-ask the same question (the de-dup reference forbids that separately).
  if (p.length)
    sections.push(
      `They engaged RICHLY with these — this ground is productive, so a DEEPER, fresh angle here is welcome` +
        ` (a justified exception to the new-ground bias); never re-ask the same question:\n${p
          .map((l) => `- ${l}`)
          .join('\n')}`,
    );
  // Question-quality self-selection — the "bailed" signal (spec 69 §5.2 / Phase 5): recent abandonment means
  // future questionnaires should be lighter. Topic-agnostic on purpose (it's about LENGTH/complexity, not what
  // to ask), so we emit one general note rather than naming the unfinished check-ins.
  const bailedCutoff = new Date(now.getTime() - BAILED_FRESH_DAYS * MS_PER_DAY).toISOString();
  const bailedRecently = profile.feedback.some((f) => f.kind === 'bailed' && f.at >= bailedCutoff);
  if (bailedRecently)
    sections.push(
      `They've recently left check-ins UNFINISHED — keep questions here SHORT and easy to answer; favor fewer,` +
        ` lighter questions over long or complex ones.`,
    );
  // Recent, unexplored changes (spec 69 §5.8): "used to say X, now Y" → invite exploration of the shift.
  const changeCutoff = new Date(now.getTime() - CHANGE_FRESH_DAYS * MS_PER_DAY).toISOString();
  const changes = profile.changes
    .filter((c) => !c.explored && c.detectedAt >= changeCutoff)
    .slice(0, GUIDANCE_LIST_CAP)
    .map((c) => `- "${c.label ?? c.topicId ?? c.metricKey ?? 'something'}": ${c.from} → ${c.to}`);
  if (changes.length)
    sections.push(
      `They have RECENTLY CHANGED their answer on these — gently and tactfully explore what shifted and WHY` +
        ` (this is high-value new ground, not a re-ask):\n${changes.join('\n')}`,
    );
  if (sections.length === 0) return '';
  return `WHAT THEY'VE TOLD YOU ABOUT PRIOR QUESTIONS (learn from this — it is how you get smarter over time):\n${sections.join(
    '\n\n',
  )}`;
}

/**
 * The candidate feed as a generation-prompt block (spec 70 §3.2/§5.5) — "what SelfOS is curious about asking
 * this person next", so generation draws from the same candidates the person sees + curates ("what you see is
 * what gets asked"). Pinned (`asked`) candidates lead within their section; `skipped` + already-minted ones are
 * excluded; a `go-deeper`-curated candidate is treated as a deeper-follow-up thread regardless of its `kind`.
 * `''` when there is nothing to steer with (no candidates yet). Pure.
 */
export function buildCandidateGuidance(profile: PersonalizationProfile): string {
  const active = profile.candidates.filter(isActiveCandidate);
  if (active.length === 0) return '';
  const isGoDeeper = (c: NextCandidate): boolean =>
    c.kind === 'go-deeper' || c.curation === 'go-deeper';
  // Pinned ("Ask me this") leads within each section; ★-marked so the model knows the top priority.
  const order = (list: NextCandidate[]): NextCandidate[] =>
    [...list].sort((a, b) => {
      const pa = a.curation === 'asked' ? 0 : 1;
      const pb = b.curation === 'asked' ? 0 : 1;
      return pa - pb;
    });
  const line = (c: NextCandidate): string =>
    `- ${c.curation === 'asked' ? '★ ' : ''}${c.prompt.trim()}`;
  const newGround = order(active.filter((c) => !isGoDeeper(c)))
    .slice(0, FEED_CANDIDATE_CAP)
    .map(line);
  const deeper = order(active.filter(isGoDeeper)).slice(0, FEED_CANDIDATE_CAP).map(line);
  const sections: string[] = [];
  if (newGround.length)
    sections.push(`New ground SelfOS wants to open up:\n${newGround.join('\n')}`);
  if (deeper.length)
    sections.push(
      `Threads worth going deeper on (a fresh, more specific angle):\n${deeper.join('\n')}`,
    );
  if (sections.length === 0) return '';
  return (
    `QUESTIONS SELFOS IS CURIOUS ABOUT ASKING THIS PERSON NEXT (spec 70 §3.2) — draw generation PRIMARILY from` +
    ` these; they were chosen for this person, and the ones marked ★ are top priority (they explicitly asked` +
    ` for them). Ask them in your own words, on their own terms; never quote this list back:\n${sections.join(
      '\n\n',
    )}`
  );
}

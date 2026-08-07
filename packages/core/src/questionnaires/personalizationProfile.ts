import { z } from 'zod';

import type { FileSystem } from '../host';
import { readEncryptedJson, writeEncryptedJson } from '../vault';
import {
  NOT_APPLICABLE_SKIP_REASON,
  PREFER_NOT_TO_SAY_SKIP_REASON,
  UNCLEAR_SKIP_REASON,
} from './answering';

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
  relational: z
    .object({ reciprocity: z.array(ReciprocityCandidateSchema).catch([]).default([]) })
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

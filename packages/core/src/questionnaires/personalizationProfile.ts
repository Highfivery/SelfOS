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
export const RECIPROCITY_CAP = 100;

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
    relational: { reciprocity: [...added, ...existing].slice(0, RECIPROCITY_CAP) },
    updatedAt: now.toISOString(),
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
 * `skipped` / `bailed` are not steered here (a weak signal). Pure; `''` when there is nothing to say.
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

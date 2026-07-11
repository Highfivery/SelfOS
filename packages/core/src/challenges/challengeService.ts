import type { FileSystem } from '../host';
import { uuid } from '../id';
import {
  ChallengeDomainSchema,
  ChallengeSchema,
  LIFE_AREAS,
  type Challenge,
  type ChallengeCheckInResult,
  type ChallengeDomain,
  type ChallengeOutcome,
  type ChallengeStatus,
  type Insight,
  type InsightFact,
} from '../schemas';
import { getInsight, saveInsight } from '../insights';
import { extractGoals } from '../goals';
import { readEncryptedJson, writeEncryptedJson } from '../vault';
import type { ChallengeMarker } from '../conversations/guidedSteps';

/**
 * Tracked challenges / experiments (52-challenge-sessions §5.1). A `Challenge` is its OWN entity (NOT a Goal),
 * stored encrypted per-subject at `people/<id>/challenges/<id>.enc`, captured from a `[[SELFOS:CHALLENGE:…]]`
 * marker the coach emits when the person agrees (free — rides the chat turn, §3.2). The reflection a check-in
 * records produces an `Insight` (source:'session', provenance.challengeId) feeding the person's OWN context
 * (§5.4) — a sexual/intimacy challenge's reflection facts are `restricted` (own-context-only, §8.4).
 *
 * Privacy: per-subject only — a challenge's `subjectPersonId` is its owner; nothing here reads another
 * person's challenges, and the bridge scopes every `challenges:*` channel to the active person (the trust
 * boundary). This module imports NO `conversations` (challenge-SESSION creation lives in
 * `conversations/challengeSession.ts`), so the `conversations → challenges` marker-capture edge stays acyclic.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const SCHEMA_VERSION = 1;

/** The default check-in delay (days) when the coach doesn't set one from the conversation (§11 Q5), and the
 *  sane clamp bounds for a model-supplied `checkInDays`. Kept here (not in the conversations prompt module) so
 *  the `challenges` core stays free of any runtime `conversations` import (the marker-capture edge is one-way). */
export const DEFAULT_CHECK_IN_DAYS = 7;
export const MIN_CHECK_IN_DAYS = 1;
export const MAX_CHECK_IN_DAYS = 30;

function challengesDir(personId: string): string {
  return `people/${personId}/challenges`;
}

function challengePath(personId: string, challengeId: string): string {
  return `${challengesDir(personId)}/${challengeId}.enc`;
}

/** Clamp a model-supplied life-area to the fixed taxonomy (never trust it raw), or undefined. */
export function normalizeLifeArea(area: string | undefined): string | undefined {
  if (!area) return undefined;
  return LIFE_AREAS.find((a) => a.toLowerCase() === area.trim().toLowerCase());
}

/** Clamp a model-supplied domain to the fixed family, or undefined. */
export function normalizeDomain(domain: string | undefined): ChallengeDomain | undefined {
  if (!domain) return undefined;
  const parsed = ChallengeDomainSchema.safeParse(domain.trim().toLowerCase());
  return parsed.success ? parsed.data : undefined;
}

/** Clamp a comfort/stretch level to 1..5 (default 3 — a middling nudge — when absent/invalid). */
export function clampComfort(comfort: number | undefined): number {
  if (typeof comfort !== 'number' || !Number.isFinite(comfort)) return 3;
  return Math.max(1, Math.min(5, Math.round(comfort)));
}

function clampCheckInDays(days: number | undefined): number {
  if (typeof days !== 'number' || !Number.isFinite(days)) return DEFAULT_CHECK_IN_DAYS;
  return Math.max(MIN_CHECK_IN_DAYS, Math.min(MAX_CHECK_IN_DAYS, Math.round(days)));
}

export async function saveChallenge(
  fs: FileSystem,
  key: Uint8Array,
  challenge: Challenge,
): Promise<void> {
  await writeEncryptedJson(
    fs,
    challengePath(challenge.subjectPersonId, challenge.id),
    challenge,
    key,
  );
}

export async function getChallenge(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  challengeId: string,
): Promise<Challenge | null> {
  const raw = await readEncryptedJson(fs, challengePath(personId, challengeId), key);
  return raw ? ChallengeSchema.parse(raw) : null;
}

/** List a subject's challenges, newest-first by `updatedAt`. Skips the `suggestion.enc` sidecar + non-challenge
 *  files; defense-in-depth subject check (the insight/goal precedent). */
export async function listChallenges(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<Challenge[]> {
  const out: Challenge[] = [];
  for (const name of await fs.list(challengesDir(personId))) {
    if (!name.endsWith('.enc') || name === 'suggestion.enc') continue;
    const raw = await readEncryptedJson(fs, `${challengesDir(personId)}/${name}`, key);
    if (!raw) continue;
    const parsed = ChallengeSchema.safeParse(raw);
    if (parsed.success && parsed.data.subjectPersonId === personId) out.push(parsed.data);
  }
  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  return out;
}

export async function deleteChallenge(
  fs: FileSystem,
  personId: string,
  challengeId: string,
): Promise<void> {
  await fs.remove(challengePath(personId, challengeId));
}

// ── Pure derivations (used by the renderer, recommendation provider, and notification source) ──────────────

/** A challenge is a sexual/intimacy one (→ 18+-gated surfaces + restricted reflection facts) when its domain
 *  is `intimacy` or its life-area is `Intimacy`. Used at capture; persisted as `challenge.adult`. */
function deriveAdult(domain: ChallengeDomain | undefined, lifeArea: string | undefined): boolean {
  return domain === 'intimacy' || lifeArea === 'Intimacy';
}

/** The single ACTIVE challenge to feature (most recent), or undefined. Pure. */
export function featuredActiveChallenge(challenges: Challenge[]): Challenge | undefined {
  return challenges.find((c) => c.status === 'active');
}

/** Whether an active challenge's check-in is due (its `checkInAt` has passed). Pure. */
export function isCheckInDue(challenge: Challenge, now: Date): boolean {
  if (challenge.status !== 'active' || !challenge.checkInAt) return false;
  const due = new Date(challenge.checkInAt).getTime();
  return Number.isFinite(due) && due <= now.getTime();
}

/** The single active challenge whose check-in is due (the one to gently nudge), or undefined. Pure. */
export function checkInDueChallenge(challenges: Challenge[], now: Date): Challenge | undefined {
  return challenges.find((c) => isCheckInDue(c, now));
}

// ── Capture (from a coach marker) ─────────────────────────────────────────────────────────────────────────

export interface CaptureFromMarkerInput {
  fs: FileSystem;
  key: Uint8Array;
  personId: string;
  conversationId: string;
  marker: ChallengeMarker;
  now: Date;
  /** For a JOINT (couples) challenge — the shared id linking the twin records for both partners (58 §5.6). */
  groupId?: string;
}

/**
 * Create (or refine) the tracked `Challenge` from a coach marker the person agreed to (§3.2). The one-active
 * rule (§4.3): if THIS conversation already produced an active challenge (a second marker in close succession),
 * UPDATE it rather than spawn a competing one. Fields are normalized server-side (never trusted raw): `lifeArea`
 * to LIFE_AREAS, `domain` to the family enum, `comfort` clamped 1..5, `checkInDays` clamped to a sane window.
 */
export async function captureFromMarker(input: CaptureFromMarkerInput): Promise<Challenge | null> {
  const { fs, key, personId, conversationId, marker, now, groupId } = input;
  const action = marker.action.trim();
  if (!action) return null;
  const at = now.toISOString();
  const lifeArea = normalizeLifeArea(marker.lifeArea);
  const domain = normalizeDomain(marker.domain);
  const comfort = clampComfort(marker.comfort);
  const checkInAt = new Date(
    now.getTime() + clampCheckInDays(marker.checkInDays) * DAY_MS,
  ).toISOString();
  const adult = deriveAdult(domain, lifeArea);

  // Refine an active challenge already agreed in THIS session rather than create a duplicate (§4.3).
  const existing = (await listChallenges(fs, key, personId)).find(
    (c) => c.conversationId === conversationId && c.status === 'active',
  );
  if (existing) {
    const updated: Challenge = {
      ...existing,
      action,
      comfort,
      ...(lifeArea ? { lifeArea } : {}),
      ...(domain ? { domain } : {}),
      ...(adult ? { adult: true } : {}),
      checkInAt,
      updatedAt: at,
    };
    await saveChallenge(fs, key, updated);
    return updated;
  }

  const challenge: Challenge = {
    id: uuid(),
    schemaVersion: SCHEMA_VERSION,
    subjectPersonId: personId,
    action,
    status: 'active',
    comfort,
    ...(lifeArea ? { lifeArea } : {}),
    ...(domain ? { domain } : {}),
    ...(adult ? { adult: true } : {}),
    ...(groupId ? { groupId } : {}),
    conversationId,
    provenance: { conversationId, at },
    agreedAt: at,
    checkInAt,
    createdAt: at,
    updatedAt: at,
  };
  await saveChallenge(fs, key, challenge);
  return challenge;
}

// ── Lifecycle + check-in ──────────────────────────────────────────────────────────────────────────────────

/** Set a challenge's status (the card's "I did it"/"Let it go"). Returns the updated challenge, or null. */
export async function setChallengeStatus(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  challengeId: string,
  status: ChallengeStatus,
  now: Date,
): Promise<Challenge | null> {
  const challenge = await getChallenge(fs, key, personId, challengeId);
  if (!challenge) return null;
  const updated: Challenge = { ...challenge, status, updatedAt: now.toISOString() };
  await saveChallenge(fs, key, updated);
  return updated;
}

/** "Not yet" — keep the challenge active and push its check-in out (§3.5), never a nag. Returns the challenge. */
export async function snoozeCheckIn(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  challengeId: string,
  now: Date,
  days: number = DEFAULT_CHECK_IN_DAYS,
): Promise<Challenge | null> {
  const challenge = await getChallenge(fs, key, personId, challengeId);
  if (!challenge) return null;
  const at = now.toISOString();
  const updated: Challenge = {
    ...challenge,
    status: 'active',
    checkInAt: new Date(now.getTime() + clampCheckInDays(days) * DAY_MS).toISOString(),
    updatedAt: at,
  };
  await saveChallenge(fs, key, updated);
  return updated;
}

const OUTCOME_SENTENCE: Record<ChallengeOutcome, string> = {
  did: 'They followed through.',
  partly: 'They gave it a partial go.',
  didnt: "They didn't manage it this time — and reflected on why.",
};

/**
 * The reflection → Insight bridge (§5.4), deterministic (no AI spend — a check-in never spends). Writes the
 * `reflection`/`outcome`, moves the challenge to `done`, and produces (or re-uses) an `Insight`
 * (source:'session', approved, provenance.challengeId) summarizing the outcome so the coach remembers the
 * experiment. A SEXUAL/intimacy challenge's reflection facts are `restricted` (§4.4/§8.4 — own-context-only,
 * never broadcast). A re-check-in reuses `insightId` (preserving `createdAt`), the 09/39 re-run precedent.
 */
export interface RecordCheckInInput {
  fs: FileSystem;
  key: Uint8Array;
  personId: string;
  challengeId: string;
  outcome: ChallengeOutcome;
  reflection?: string;
  now: Date;
}

export async function recordCheckIn(input: RecordCheckInInput): Promise<ChallengeCheckInResult> {
  const { fs, key, personId, challengeId, outcome, now } = input;
  const challenge = await getChallenge(fs, key, personId, challengeId);
  if (!challenge)
    return { ok: false, reason: 'NOT_FOUND', message: 'That challenge is no longer here.' };
  const at = now.toISOString();
  const reflection = input.reflection?.trim() || undefined;
  const restricted = challenge.adult === true;
  // An adult/intimacy reflection's facts are `restricted` and so feed ONLY the person's own intimacy-topic
  // context (insightStore relevance gate, fail-closed on a restricted fact with no life-area). Default the
  // life-area to 'Intimacy' so the reflection stays usable on-topic instead of being fail-closed everywhere.
  const lifeArea = challenge.lifeArea ?? (restricted ? 'Intimacy' : undefined);
  const insightId = challenge.insightId ?? uuid();
  const prior = challenge.insightId
    ? await getInsight(fs, key, personId, challenge.insightId)
    : null;

  const fact = (text: string): InsightFact => ({
    id: uuid(),
    text,
    shareable: false, // a challenge reflection is own-context-only; never broadcast
    ...(restricted ? { restricted: true } : {}),
    ...(lifeArea ? { lifeArea } : {}),
  });
  const facts: InsightFact[] = [
    fact(`Challenge: ${challenge.action}`),
    fact(`Outcome: ${OUTCOME_SENTENCE[outcome]}`),
    ...(reflection ? [fact(`Reflection: ${reflection}`)] : []),
  ];
  const summary = `Took on a challenge: "${challenge.action}". ${OUTCOME_SENTENCE[outcome]}${
    reflection ? ` They reflected: ${reflection}` : ''
  }`;

  const insight: Insight = {
    id: insightId,
    schemaVersion: 1,
    source: 'session',
    subjectPersonId: personId,
    summary,
    facts,
    confidence: 'medium',
    categories: lifeArea ? [lifeArea] : [],
    approved: true,
    provenance: {
      challengeId,
      ...(challenge.conversationId ? { conversationId: challenge.conversationId } : {}),
      at,
    },
    createdAt: prior?.createdAt ?? at,
    updatedAt: at,
  };
  await saveInsight(fs, key, insight);

  const updated: Challenge = {
    ...challenge,
    status: 'done',
    outcome,
    ...(reflection ? { reflection } : {}),
    insightId,
    updatedAt: at,
  };
  await saveChallenge(fs, key, updated);
  return { ok: true, challenge: updated, insightId };
}

/**
 * Offer-to-seed a Goal from a completed challenge (§11 Q6 — confirm-before-create). A habit/standing challenge
 * that worked naturally becomes an ongoing 39 Goal; the renderer asks first and only calls this on the
 * person's say-so. Reuses `goalService.extractGoals` (no AI), sets the `seededGoalId` back-link. Returns the
 * challenge with the link, or null if the challenge is gone.
 */
export async function seedGoalFromChallenge(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  challengeId: string,
  now: Date,
): Promise<Challenge | null> {
  const challenge = await getChallenge(fs, key, personId, challengeId);
  if (!challenge) return null;
  if (challenge.seededGoalId) return challenge; // already seeded — idempotent
  const at = now.toISOString();
  const goals = await extractGoals({
    fs,
    key,
    personId,
    goals: [challenge.action],
    provenance: { challengeId, at },
    ...(challenge.lifeArea ? { lifeArea: challenge.lifeArea } : {}),
    now,
  });
  const goal = goals[0];
  if (!goal) return challenge;
  const updated: Challenge = { ...challenge, seededGoalId: goal.id, updatedAt: at };
  await saveChallenge(fs, key, updated);
  return updated;
}

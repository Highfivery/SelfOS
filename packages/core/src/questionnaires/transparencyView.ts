import type { FileSystem } from '../host';
import { getPerson } from '../people/peopleService';
import { listRelationships, livePartnerIds } from '../people/relationshipService';

import { deriveIntimacyCoverageFor } from './coverageService';
import { deriveCoverageSkeleton } from './coverageModel';
import {
  addPartnerWish,
  applyCandidateCuration,
  applySteer,
  FEED_CANDIDATE_CAP,
  isActiveCandidate,
  readProfile,
  removePartnerWish,
  writeProfile,
  type CandidateCuration,
  type CoverageTopic,
  type NextCandidateKind,
  type PersonalizationProfile,
} from './personalizationProfile';

/**
 * The Adaptive-Exploration transparency read (spec 70 §3 / spec 69 §3.4/§6) — projects a person's OWN
 * Personalization Profile into a calm, own-scoped, FORWARD-FIRST view for the Explored panel: the candidate
 * feed SelfOS is curious about next, over an honest "how well I know you" overview that never reads "done".
 *
 * Own-scoped by construction: the projection reads only the active person's own coverage map + candidates +
 * feedback ledger. It NEVER surfaces reciprocity candidates or any partner-derived content (spec 69 §6/§8 —
 * "the read returns the viewer's own coverage/feedback view only"). Coverage rows carry no answer content,
 * only life-area labels + a coarse new / getting-to-know / knows-well status.
 */

/** Any measurable coverage counts as "getting to know you" (some); below it is "new" (nothing yet). */
const LIGHT_DEPTH = 0.15;
/**
 * Honest depth (spec 70 §3.3/§5.2): a HIGH bar for the top of the scale — "knows you well" is reserved for an
 * area genuinely explored from many angles (matching the recalibrated `COVERAGE_SYSTEM`'s 0.7 anchor), so the
 * overview never over-reads as "done".
 */
const KNOWS_WELL_DEPTH = 0.7;

/** The honest, never-"done" scale (spec 70 §3.3): New → Getting to know you → Knows you well. */
export type CoverageStatus = 'new' | 'getting-to-know' | 'knows-well';

/** One life-area row in the Explored panel. */
export interface CoverageAreaView {
  /** Stable id used to steer this area (the general skeleton topicId === the life-area name). */
  topicId: string;
  lifeArea: string;
  label: string;
  status: CoverageStatus;
  /** 0..1 — the deepest coverage in this area (for a subtle meter; shown as text too, never color-only). */
  depth: number;
  /** Whether this area can be steered right now — true for a general area, and for Intimacy only once the 18+
   *  ack is done (spec 70 §3.4/§8). */
  steerable: boolean;
  /** True when the person has explicitly asked to explore this area more (the "explore more" steer). */
  steered: boolean;
  /** Present + true for the Intimacy row — an 18+ area (the panel shows the 18+ badge + the unlock affordance
   *  when not yet acknowledged, spec 70 §3.4). */
  adultGated?: boolean;
}

/** One topic the person has marked off (a decline / a "leave alone" steer). */
export interface MarkedOffView {
  /** Present ⇒ the mark is reversible via an "explore it again" steer. */
  topicId?: string;
  label: string;
  kind: 'not-applicable' | 'prefer-not-to-say';
  at: string;
}

/** One candidate in the forward-first feed (spec 70 §3.2) — what SelfOS is curious about asking next. */
export interface CandidateFeedItem {
  id: string;
  lifeArea: string;
  prompt: string;
  kind: NextCandidateKind;
  curation: CandidateCuration;
}

export interface QuestionnaireCoverageView {
  /** The forward-first candidate feed (spec 70 §3.2) — leads the panel. Own data only. */
  candidates: CandidateFeedItem[];
  /** When the candidate feed was last refreshed (drives the "refreshes daily" / pre-first-refresh states). */
  candidatesRefreshedAt?: string;
  /** Set by the manual "Look for more" (spec 70 §5.4) when its AI pass degraded (no key / over budget /
   *  unparseable) — the last-good feed is returned unchanged, and the panel surfaces a calm note (honest
   *  failure). Never set on an ordinary read/curate/steer. */
  refreshDegraded?: boolean;
  areas: CoverageAreaView[];
  markedOff: MarkedOffView[];
  /** One card per connected partner (a live `partner` edge) with this person's OWN wishes (spec 70 §3.5).
   *  Empty when the person has no partner edge. Never surfaces the partner's own coverage/answers. */
  partners: PartnerWishGroupView[];
  /** Whether the person has done the shared 18+ acknowledgement (spec 70 §3.4) — gates the Intimacy row's
   *  steering + candidates. The panel shows an inline "Confirm you're 18+" unlock on the Intimacy row when false. */
  adultAcknowledged: boolean;
  /** Whether an AI coverage-placement pass has run (else the read is a fresh, all-uncovered skeleton). */
  hasPlacement: boolean;
  lastPlacementAt?: string;
}

/** A steer action from the panel (spec 69 §3.4). Own-scoped in the bridge. */
export interface CoverageSteerInput {
  topicId: string;
  lifeArea?: string;
  label?: string;
  action: 'explore-more' | 'leave-alone' | 'clear';
}

/** A candidate curation tap from the panel (spec 70 §3.2). Own-scoped in the bridge. */
export interface CandidateCurateInput {
  candidateId: string;
  action: 'ask' | 'not-this' | 'go-deeper' | 'clear';
}

/** One "Explore with your partner" wish, as shown on the panel (spec 70 §3.5). The person's OWN input. */
export interface PartnerWishView {
  id: string;
  note: string;
  intimacy: boolean;
}

/** One connected-partner card on the Explored panel (spec 70 §3.5): the partner + this person's own wishes. */
export interface PartnerWishGroupView {
  partnerId: string;
  partnerName: string;
  wishes: PartnerWishView[];
}

/** Add / remove a partner wish from the panel (spec 70 §3.5). Own-scoped + live-edge-gated in the bridge. */
export interface AddPartnerWishInput {
  partnerPersonId: string;
  note: string;
  intimacy?: boolean;
}

const statusOf = (depth: number): CoverageStatus =>
  depth >= KNOWS_WELL_DEPTH ? 'knows-well' : depth >= LIGHT_DEPTH ? 'getting-to-know' : 'new';

/**
 * Project the person's OWN active candidate feed (spec 70 §3.2): candidates they haven't been asked and haven't
 * declined, pinned ("Ask me this") first, then go-deeper threads, then new ground — bounded to the feed cap.
 * Own data only (a candidate is derived from the person's own answers/coverage). Pure.
 *
 * Intimacy candidates are **18+-gated** (spec 70 §3.4 / §8): an `Intimacy`-area candidate is withheld from the
 * feed unless the person has done the shared 18+ acknowledgement — so explicit candidates never surface
 * un-acked. Defaults to NOT-acked (fail-safe: the gate is on unless the caller confirms the ack).
 */
export function projectCandidateFeed(
  profile: PersonalizationProfile,
  adultAcknowledged = false,
): CandidateFeedItem[] {
  const active = profile.candidates.filter(
    (c) => isActiveCandidate(c) && (adultAcknowledged || c.lifeArea !== 'Intimacy'),
  );
  const rank = (c: (typeof active)[number]): number => {
    if (c.curation === 'asked') return 0; // pinned leads
    if (c.kind === 'go-deeper' || c.curation === 'go-deeper') return 1;
    return 2; // new ground
  };
  return active
    .slice()
    .sort((a, b) => rank(a) - rank(b) || b.at.localeCompare(a.at))
    .slice(0, FEED_CANDIDATE_CAP)
    .map((c) => ({
      id: c.id,
      lifeArea: c.lifeArea,
      prompt: c.prompt,
      kind: c.kind,
      curation: c.curation,
    }));
}

const norm = (s: string | undefined): string => (s ?? '').trim().toLowerCase();
/** How long a `prefer-not-to-say` boundary stays shown as "marked off" (mirrors the cooldown the engine uses). */
const PREFER_NOT_COOLDOWN_DAYS = 180;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MARKED_OFF_CAP = 24;

/**
 * Merge the profile's persisted coverage topics onto a fresh skeleton (spec 69 §5.7): general life areas take
 * the AI-placement depth/explored from the profile; Intimacy stays send-history-fresh from the skeleton; the
 * steer flag (`reopenedBy`) is overlaid; emergent sub-topics / steer-created profile-only topics are appended.
 * Always returns every life area, so the panel is never blank (even before any placement pass). Pure.
 */
export function mergeProfileCoverage(
  skeleton: readonly CoverageTopic[],
  profileTopics: readonly CoverageTopic[],
): CoverageTopic[] {
  const byId = new Map(profileTopics.map((t) => [t.topicId, t]));
  const skeletonIds = new Set(skeleton.map((t) => t.topicId));
  const merged: CoverageTopic[] = skeleton.map((s) => {
    const p = byId.get(s.topicId);
    if (!p) return s;
    const isIntimacy = s.lifeArea === 'Intimacy';
    return {
      ...s,
      // General areas take the AI-placement depth; Intimacy stays deterministic (send-history) from the skeleton.
      ...(isIntimacy ? {} : { depth: p.depth, explored: p.explored }),
      ...(p.reopenedBy ? { reopenedBy: p.reopenedBy } : {}),
    };
  });
  const appended = profileTopics.filter((p) => !skeletonIds.has(p.topicId));
  return [...merged, ...appended];
}

/**
 * Project resolved coverage topics + the profile's feedback ledger into the own-scoped panel view. One coarse
 * row per life area (max depth across its topics); Intimacy is aggregated into a single read-only row (no
 * per-category enumeration — sensitive). Pure.
 */
export function projectCoverageView(
  topics: readonly CoverageTopic[],
  profile: PersonalizationProfile,
  now: Date,
  adultAcknowledged = false,
): QuestionnaireCoverageView {
  // Group by life area, preserving first-seen order (general areas from the skeleton, then Intimacy).
  const order: string[] = [];
  const groups = new Map<string, CoverageTopic[]>();
  for (const t of topics) {
    if (!groups.has(t.lifeArea)) {
      groups.set(t.lifeArea, []);
      order.push(t.lifeArea);
    }
    groups.get(t.lifeArea)!.push(t);
  }
  const areas: CoverageAreaView[] = order.map((lifeArea) => {
    const group = groups.get(lifeArea)!;
    const depth = group.reduce((m, t) => (t.depth > m ? t.depth : m), 0);
    const isIntimacy = lifeArea === 'Intimacy';
    // Intimacy is first-class + steerable (spec 70 §3.4) — but only once the 18+ ack is done (§8). A general
    // area is always steerable.
    const steerable = !isIntimacy || adultAcknowledged;
    const steered = group.some((t) => t.reopenedBy === 'explicit-request');
    // The steer target: a general area's stable topicId IS its life-area name; Intimacy aggregates per-category
    // topics, so it steers at the AREA level under a stable `'Intimacy'` id (never a single category).
    const areaTopic = group.find((t) => t.topicId === lifeArea) ?? group[0]!;
    return {
      topicId: isIntimacy ? 'Intimacy' : areaTopic.topicId,
      lifeArea,
      label: lifeArea,
      status: statusOf(depth),
      depth,
      steerable,
      steered,
      ...(isIntimacy ? { adultGated: true } : {}),
    };
  });

  const cutoff = new Date(now.getTime() - PREFER_NOT_COOLDOWN_DAYS * MS_PER_DAY).toISOString();
  const seen = new Set<string>();
  const markedOff: MarkedOffView[] = [];
  for (const f of profile.feedback) {
    let kind: 'not-applicable' | 'prefer-not-to-say';
    if (f.kind === 'not-applicable') kind = 'not-applicable';
    else if (f.kind === 'prefer-not-to-say' && f.at >= cutoff) kind = 'prefer-not-to-say';
    else continue;
    const label = (f.questionPrompt ?? f.topicId ?? '').trim();
    if (!label) continue;
    const dedupKey = `${kind}|${norm(label)}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    markedOff.push({
      ...(f.topicId ? { topicId: f.topicId } : {}),
      label,
      kind,
      at: f.at,
    });
    if (markedOff.length >= MARKED_OFF_CAP) break;
  }

  return {
    candidates: projectCandidateFeed(profile, adultAcknowledged),
    ...(profile.candidatesRefreshedAt
      ? { candidatesRefreshedAt: profile.candidatesRefreshedAt }
      : {}),
    areas,
    markedOff,
    partners: [], // filled by `readCoverageView` (needs the relationship graph + people); pure projection has none
    adultAcknowledged,
    hasPlacement: Boolean(profile.coverage.lastPlacementAt),
    ...(profile.coverage.lastPlacementAt
      ? { lastPlacementAt: profile.coverage.lastPlacementAt }
      : {}),
  };
}

/**
 * Read the active person's own coverage view (spec 69 §3.4). Always derives the full life-area skeleton so the
 * panel shows every area even before a placement pass, then overlays the persisted profile. Reads own data only.
 */
export async function readCoverageView(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  now: Date,
  adultAcknowledged = false,
): Promise<QuestionnaireCoverageView> {
  const [profile, intimacy] = await Promise.all([
    readProfile(fs, key, personId),
    deriveIntimacyCoverageFor(fs, key, personId, now),
  ]);
  const skeleton = deriveCoverageSkeleton(intimacy);
  const topics = mergeProfileCoverage(skeleton, profile.coverage.topics);
  const projected = projectCoverageView(topics, profile, now, adultAcknowledged);
  const partners = await gatherPartnerWishGroups(fs, key, personId, profile);
  return { ...projected, partners };
}

/**
 * The "Explore with your partner" cards (spec 70 §3.5) — one per CONNECTED partner (a live `partner` edge),
 * carrying this person's OWN wishes for them. Own-scoped: reads only the requester's own wishes + the partner's
 * display name (which the requester can already see). Never the partner's coverage/answers. Absent partner edge
 * ⇒ no card. Pure-ish (the relationship graph + a name lookup per partner).
 */
async function gatherPartnerWishGroups(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  profile: PersonalizationProfile,
): Promise<PartnerWishGroupView[]> {
  const rels = await listRelationships(fs, key);
  // The live partner edges this person is on (preserving first-seen order).
  const partnerIds = livePartnerIds(rels, personId);
  if (partnerIds.length === 0) return [];
  const wishes = profile.relational?.partnerWishes ?? [];
  const groups: PartnerWishGroupView[] = [];
  for (const partnerId of partnerIds) {
    const person = await getPerson(fs, key, partnerId);
    if (!person) continue; // a dangling edge to a deleted person → no card
    groups.push({
      partnerId,
      partnerName: person.displayName,
      wishes: wishes
        .filter((w) => w.partnerPersonId === partnerId)
        .map((w) => ({ id: w.id, note: w.note, intimacy: w.intimacy })),
    });
  }
  return groups;
}

/**
 * Add a partner wish to the active person's OWN profile and return the refreshed view (spec 70 §3.5). Own-scoped;
 * the caller (bridge) has already re-checked the live partner edge. Pure-ish (read → apply → write → read).
 */
export async function addPartnerWishAndRead(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  input: AddPartnerWishInput,
  now: Date,
  adultAcknowledged = false,
): Promise<QuestionnaireCoverageView> {
  const profile = await readProfile(fs, key, personId);
  const next = addPartnerWish(profile, input, now);
  if (next !== profile) await writeProfile(fs, key, next);
  return readCoverageView(fs, key, personId, now, adultAcknowledged);
}

/** Remove a partner wish by id from the active person's OWN profile and return the refreshed view (spec 70 §3.5). */
export async function removePartnerWishAndRead(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  wishId: string,
  now: Date,
  adultAcknowledged = false,
): Promise<QuestionnaireCoverageView> {
  const profile = await readProfile(fs, key, personId);
  const next = removePartnerWish(profile, wishId, now);
  if (next !== profile) await writeProfile(fs, key, next);
  return readCoverageView(fs, key, personId, now, adultAcknowledged);
}

/**
 * Apply a steer (explore more / leave alone) to the active person's own profile and return the refreshed view.
 * Own-scoped: only ever writes the active person's own Personalization Profile (spec 69 §6).
 */
export async function steerTopic(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  input: CoverageSteerInput,
  now: Date,
  adultAcknowledged = false,
): Promise<QuestionnaireCoverageView> {
  const profile = await readProfile(fs, key, personId);
  const next = applySteer(profile, input, now);
  if (next !== profile) await writeProfile(fs, key, next); // skip the vault write on a no-op steer
  return readCoverageView(fs, key, personId, now, adultAcknowledged);
}

/**
 * Apply a candidate curation tap (Ask me this / Not this / Go deeper / clear) to the active person's own feed
 * and return the refreshed view (spec 70 §3.2). Cheap, no AI. Own-scoped: only ever writes the caller's own
 * Personalization Profile.
 */
export async function curateCandidate(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  input: CandidateCurateInput,
  now: Date,
  adultAcknowledged = false,
): Promise<QuestionnaireCoverageView> {
  const profile = await readProfile(fs, key, personId);
  const next = applyCandidateCuration(profile, input, now);
  if (next !== profile) await writeProfile(fs, key, next); // skip the vault write on a no-op tap
  return readCoverageView(fs, key, personId, now, adultAcknowledged);
}

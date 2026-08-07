import type { FileSystem } from '../host';

import { deriveIntimacyCoverageFor } from './coverageService';
import { deriveCoverageSkeleton, NEW_GROUND_DEPTH } from './coverageModel';
import {
  applySteer,
  readProfile,
  writeProfile,
  type CoverageTopic,
  type PersonalizationProfile,
} from './personalizationProfile';

/**
 * The Questionnaire-Intelligence transparency read (spec 69 §3.4/§6) — projects a person's OWN Personalization
 * Profile into a calm, own-scoped "what SelfOS has explored with you" view for the Explored panel.
 *
 * Own-scoped by construction: the projection reads only the active person's own coverage map + their own
 * feedback ledger. It NEVER surfaces reciprocity candidates or any partner-derived content (spec 69 §6/§8 —
 * "the read returns the viewer's own coverage/feedback view only"). Coverage rows carry no answer content,
 * only life-area labels + a coarse explored/lightly-touched/not-yet status.
 */

/** Any coverage below this counts as "lightly touched" (a fact or two); below it is "not yet". */
const LIGHT_DEPTH = 0.15;

export type CoverageStatus = 'explored' | 'lightly-touched' | 'not-yet';

/** One life-area row in the Explored panel. */
export interface CoverageAreaView {
  /** Stable id used to steer this area (the general skeleton topicId === the life-area name). */
  topicId: string;
  lifeArea: string;
  label: string;
  status: CoverageStatus;
  /** 0..1 — the deepest coverage in this area (for a subtle meter; shown as text too, never color-only). */
  depth: number;
  /** General areas can be steered here; Intimacy is read-only (it has its own gated coverage engine). */
  steerable: boolean;
  /** True when the person has explicitly asked to explore this area more (the "explore more" steer). */
  steered: boolean;
}

/** One topic the person has marked off (a decline / a "leave alone" steer). */
export interface MarkedOffView {
  /** Present ⇒ the mark is reversible via an "explore it again" steer. */
  topicId?: string;
  label: string;
  kind: 'not-applicable' | 'prefer-not-to-say';
  at: string;
}

export interface QuestionnaireCoverageView {
  areas: CoverageAreaView[];
  markedOff: MarkedOffView[];
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

const statusOf = (depth: number): CoverageStatus =>
  depth >= NEW_GROUND_DEPTH ? 'explored' : depth >= LIGHT_DEPTH ? 'lightly-touched' : 'not-yet';

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
    const steerable = lifeArea !== 'Intimacy';
    const steered = group.some((t) => t.reopenedBy === 'explicit-request');
    // The steer target is the general life-area topic (topicId === lifeArea in the skeleton).
    const areaTopic = group.find((t) => t.topicId === lifeArea) ?? group[0]!;
    return {
      topicId: areaTopic.topicId,
      lifeArea,
      label: lifeArea,
      status: statusOf(depth),
      depth,
      steerable,
      steered,
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
    areas,
    markedOff,
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
): Promise<QuestionnaireCoverageView> {
  const [profile, intimacy] = await Promise.all([
    readProfile(fs, key, personId),
    deriveIntimacyCoverageFor(fs, key, personId, now),
  ]);
  const skeleton = deriveCoverageSkeleton(intimacy);
  const topics = mergeProfileCoverage(skeleton, profile.coverage.topics);
  return projectCoverageView(topics, profile, now);
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
): Promise<QuestionnaireCoverageView> {
  const profile = await readProfile(fs, key, personId);
  const next = applySteer(profile, input, now);
  await writeProfile(fs, key, next);
  return readCoverageView(fs, key, personId, now);
}

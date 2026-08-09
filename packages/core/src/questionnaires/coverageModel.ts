import type { IntimacyCoverage } from '../intimacy/coverage';
import { INTIMACY_CATEGORY_LABELS } from '../intimacy/topics';
import { LIFE_AREAS } from '../schemas';

import type { CoverageTopic, PersonalizationProfile } from './personalizationProfile';

/**
 * The coverage/novelty model (spec 69 §5.2/§5.7) — a per-person map of which life areas have been explored vs.
 * are new ground, so generation leads with genuinely NEW territory (a strong-new bias) instead of re-mining.
 * Pure + deterministic here; the AI placement pass (`coverageService.ts`, Phase 2b) supplies the per-area
 * assessments this module overlays.
 *
 * The **Intimacy** branch is NOT AI-scored — it reuses the existing `intimacy/coverage.ts` engine (send-history
 * driven, one topic per category). The other life areas get one coarse topic each; the AI pass may mint
 * sub-topics only where an area has genuinely multi-strand coverage (spec 69 §13).
 */

/** Life areas the AI placement pass covers — everything except the catch-all `Other` and the deterministically
 *  handled `Intimacy` (which reuses the intimacy category engine). */
export const GENERAL_LIFE_AREAS = LIFE_AREAS.filter(
  (a) => a !== 'Other' && a !== 'Intimacy',
) as readonly string[];

/** A general area whose depth is below this counts as unexplored → generation leads here. */
export const NEW_GROUND_DEPTH = 0.4;
/**
 * Coarse-first (spec 69 §13): only sub-divide an area that is ALREADY reasonably explored — sub-topics exist to
 * tell an explored area's strands apart (which strand is still new), which is meaningless for a barely-touched
 * area. Live tuning (§26.3) showed the model otherwise sub-divides 0.3-depth areas with near-empty strands.
 */
export const SUBTOPIC_MIN_PARENT_DEPTH = NEW_GROUND_DEPTH;
/** Any measurable coverage counts as "explored". */
const EXPLORED_DEPTH = 0.15;
/** Approximate intimacy-category depth from its send count (mirrors the intimacy SATURATION of 3). */
const INTIMACY_SATURATION = 3;
/** Cap each guidance list so the prompt block stays bounded. */
const GUIDANCE_CAP = 12;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
const slug = (s: string): string =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

/** The AI placement pass's assessment of one general life area (Phase 2b). */
export interface CoverageAssessment {
  lifeArea: string;
  /** 0 (no data) … 1 (thoroughly explored). */
  depth: number;
  /** Emergent sub-topics — only where an area is genuinely multi-strand (spec 69 §13). */
  subTopics?: { label: string; depth: number }[];
}

/**
 * The base coverage map: one unexplored topic per general life area + the Intimacy categories folded in from
 * the existing engine (explored/saturated from real send history). The correct starting state for a person
 * with no data is everything uncovered.
 */
export function deriveCoverageSkeleton(intimacyCoverage?: IntimacyCoverage): CoverageTopic[] {
  const topics: CoverageTopic[] = GENERAL_LIFE_AREAS.map((area) => ({
    topicId: area,
    lifeArea: area,
    label: area,
    explored: false,
    depth: 0,
    askedCount: 0,
    saturated: false,
  }));
  if (intimacyCoverage) {
    for (const c of intimacyCoverage.byCategory) {
      const explored = c.rated || c.askedCount > 0;
      topics.push({
        topicId: `Intimacy:${c.category}`,
        lifeArea: 'Intimacy',
        label: INTIMACY_CATEGORY_LABELS[c.category],
        explored,
        depth: clamp01((c.askedCount + (c.rated ? 1 : 0)) / INTIMACY_SATURATION),
        askedCount: c.askedCount,
        saturated: c.saturated,
        ...(c.lastAskedAt ? { lastAskedAt: c.lastAskedAt } : {}),
        ...(c.reopenedBy ? { reopenedBy: c.reopenedBy } : {}),
      });
    }
  } else {
    topics.push({
      topicId: 'Intimacy',
      lifeArea: 'Intimacy',
      label: 'Intimacy',
      explored: false,
      depth: 0,
      askedCount: 0,
      saturated: false,
    });
  }
  return topics;
}

/**
 * Overlay the AI placement pass's per-area assessments onto a skeleton: set each general area's depth/explored,
 * mint any emergent sub-topics, and leave the deterministic Intimacy branch untouched. Pure.
 */
export function applyCoverageAssessments(
  skeleton: readonly CoverageTopic[],
  assessments: readonly CoverageAssessment[],
): CoverageTopic[] {
  const byArea = new Map(assessments.map((a) => [a.lifeArea, a]));
  const out: CoverageTopic[] = [];
  for (const t of skeleton) {
    if (t.lifeArea === 'Intimacy') {
      out.push(t); // send-history driven — never overwritten by the model
      continue;
    }
    const a = byArea.get(t.lifeArea);
    if (!a) {
      out.push(t);
      continue;
    }
    const depth = clamp01(a.depth);
    out.push({ ...t, depth, explored: depth >= EXPLORED_DEPTH });
    // Coarse-first: only sub-divide an already-explored area (§13 / §26.3 live tuning) — a barely-touched
    // area's "strands" are just noise; lead on the whole area instead.
    if (depth < SUBTOPIC_MIN_PARENT_DEPTH) continue;
    for (const sub of a.subTopics ?? []) {
      const label = sub.label.trim();
      const key = slug(label);
      if (!label || !key) continue;
      const d = clamp01(sub.depth);
      out.push({
        topicId: `${t.lifeArea}:${key}`,
        lifeArea: t.lifeArea,
        label,
        explored: d >= EXPLORED_DEPTH,
        depth: d,
        askedCount: 0,
        saturated: false,
      });
    }
  }
  return out;
}

/**
 * The coverage guidance block for a generation prompt (spec 69 §5.2): lead with NEW/underexplored ground,
 * and mark already-explored areas as deepen-only-when-justified. `''` when the map is empty (pre-placement).
 */
export function buildCoverageGuidance(profile: PersonalizationProfile): string {
  const topics = profile.coverage.topics;
  if (topics.length === 0) return '';
  // The person explicitly asked to explore these (the transparency-panel "explore more" steer, spec 69 §3.4):
  // they LEAD the new-ground list regardless of depth/explored, and are excluded from "already explored".
  const requested = topics.filter((t) => t.reopenedBy === 'explicit-request' && !t.saturated);
  const requestedIds = new Set(requested.map((t) => t.topicId));
  const fresh = [
    ...requested.map((t) => `- ${t.label}`),
    ...topics
      .filter(
        (t) =>
          !t.saturated &&
          !requestedIds.has(t.topicId) &&
          (!t.explored || t.depth < NEW_GROUND_DEPTH),
      )
      .sort((a, b) => a.depth - b.depth)
      .map((t) => `- ${t.label}`),
  ].slice(0, GUIDANCE_CAP);
  const covered = topics
    .filter(
      (t) =>
        t.explored && t.depth >= NEW_GROUND_DEPTH && !t.saturated && !requestedIds.has(t.topicId),
    )
    .sort((a, b) => b.depth - a.depth)
    .slice(0, GUIDANCE_CAP)
    .map((t) => `- ${t.label}`);
  const sections: string[] = [];
  if (fresh.length)
    sections.push(
      `NEW / UNEXPLORED GROUND — lead here, put MOST questions on genuinely new territory for this person:\n${fresh.join(
        '\n',
      )}`,
    );
  if (covered.length)
    sections.push(
      `Already explored — go deeper ONLY when there's a real reason (a detected change, a genuine gap, or an` +
        ` explicit request); otherwise leave these and cover new ground instead:\n${covered.join('\n')}`,
    );
  if (sections.length === 0) return '';
  return `WHERE THIS PERSON HAS AND HASN'T BEEN EXPLORED (steer strongly to NEW ground — spec 69 §5.2):\n${sections.join(
    '\n\n',
  )}`;
}

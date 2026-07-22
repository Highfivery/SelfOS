/**
 * Per-recipient INTIMACY TOPIC COVERAGE (08 §27.2).
 *
 * The bug this exists to kill (#314): `explicitFraming` told the model to "go DEEPER" on every act the person
 * rated in onboarding, on EVERY intimacy check-in, with no saturation limit and no memory of what had already
 * been worked — so the same handful of rated acts (oral, anal, …) was re-mined indefinitely. De-dup cannot
 * catch that: each "go deeper" question is genuinely new WORDING about the same act, so it passes both the
 * fuzzy filter and the semantic pass. The missing signal was never de-dup — it was *which intimacy ground has
 * already been covered*.
 *
 * This module supplies that signal: a map over the 14 `INTIMACY_CATEGORIES` (49) classifying each as
 * `uncovered` (go here first), `open` (deepening still has somewhere to go), or `saturated` (worked enough —
 * off-limits until something new comes up, §27.4).
 *
 * PURE — no I/O, no AI, no crypto. The caller gathers the inputs host-side (author-blind, §17.4) and passes
 * them in, mirroring how `buildDedupReference` is fed. Deliberately does NOT import `questionnaires/dedup`
 * for its text helpers: `questionnaires/aiPrompts` imports this package, so that would form an
 * `intimacy → questionnaires → intimacy` cycle (the trap that forced `autoCheckins` to live top-level).
 */

import type { CoveredAct } from '../intake/intakeService';
import {
  INTIMACY_CATEGORIES,
  INTIMACY_CATEGORY_LABELS,
  categoryForKey,
  type IntimacyCategory,
} from './topics';

/** How many prior intimacy check-ins may work a category before it is considered worked through (§27.2). */
export const SATURATION_ASKS = 3;

/** A saturated category may be revisited once from a fresh angle after this long untouched (§27.4). */
export const DORMANT_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Why a saturated category became askable again (§27.4). */
export type ReopenSignal = 'new-material' | 'profile-edit' | 'explicit-request' | 'dormant';

/**
 * Distinctive keywords per category, matched (word-boundary, normalized) against already-asked prompt/title
 * text to decide which ground a prior intimacy check-in worked.
 *
 * Hand-curated rather than derived from the activity labels on purpose: auto-derivation collapses on words
 * shared across categories, and an explicit list is inspectable. Two honest properties (both proven by
 * `coverage.test.ts`, both fail-SAFE for #314):
 *
 * - **A category may be MULTI-credited.** Some acts genuinely span categories — "anal fingering" is both
 *   `anal` and manual `fingering`; a taboo "roleplay" is both `taboo-fantasy` and `roleplay`. A prompt about
 *   one therefore counts toward both. The consequence is that a category can be marked worked-through slightly
 *   EARLY. That steers generation AWAY from it — the safe direction for #314 (less repetition), never toward
 *   re-mining. The test asserts each inventory label credits AT LEAST its own category.
 * - **A missing keyword only ever UNDER-counts** — a category stays `open` (the pre-fix status quo), never
 *   wrongly silenced.
 */
const CATEGORY_KEYWORDS: Readonly<Record<IntimacyCategory, readonly string[]>> = {
  sensual: [
    'massage',
    'kissing',
    'making out',
    'body worship',
    'blindfold',
    'temperature play',
    'soft touch',
    'mutual masturbation',
  ],
  oral: [
    'oral',
    'blowjob',
    'blow job',
    'deepthroat',
    'deep throat',
    'face-sitting',
    'face sitting',
    'rimming',
    'cunnilingus',
    'fellatio',
    'going down',
  ],
  'manual-toys': [
    'fingering',
    'hand job',
    'handjob',
    'vibrator',
    'dildo',
    'strap-on',
    'strapon',
    'butt plug',
    'cock ring',
    'sex toy',
  ],
  penetration: [
    'vaginal',
    'penetration',
    'intercourse',
    'position',
    'positions',
    'quickie',
    'quickies',
  ],
  anal: ['anal', 'pegging', 'double penetration'],
  roleplay: [
    'roleplay',
    'role-play',
    'role play',
    'costume',
    'dress-up',
    'lingerie',
    'stranger fantasy',
    'captive',
  ],
  'dirty-talk': [
    'dirty talk',
    'talk dirty',
    'sexting',
    'phone sex',
    'begging',
    'verbal command',
    'voice sex',
  ],
  'power-exchange': [
    'dominant',
    'submissive',
    'domination',
    'submission',
    'switching',
    'degradation',
    'humiliation',
    'obedience',
    'collaring',
    'brat play',
    'praise kink',
  ],
  bondage: ['bondage', 'cuffs', 'rope', 'shibari', 'restraint', 'restrained', 'gags', 'suspension'],
  impact: [
    'spanking',
    'spank',
    'hair-pulling',
    'hair pulling',
    'biting',
    'flogging',
    'paddling',
    'caning',
    'wax play',
    'nipple clamp',
    'scratching',
  ],
  exhibition: [
    'exhibitionism',
    'voyeurism',
    'being watched',
    'public sex',
    'semi-public',
    'camming',
  ],
  group: [
    'threesome',
    'threesomes',
    'orgy',
    'orgies',
    'group sex',
    'gangbang',
    'foursome',
    'swinging',
    'cuckold',
    'hotwife',
    'hotwifing',
  ],
  edge: [
    'breath play',
    'choking',
    'knife play',
    'needle play',
    'electro',
    'fisting',
    'heavy impact',
    'edge play',
  ],
  'taboo-fantasy': [
    'cnc',
    'consensual non-consent',
    'ravishment',
    'primal play',
    'age-gap',
    'age gap',
    'pet play',
    'forced roleplay',
  ],
};

/** Lowercase, strip punctuation, collapse whitespace — the local twin of `dedup.normalizePrompt` (see the
 *  module note on why this isn't imported). Keeps digits so "69" survives. */
function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whether `haystack` (already normalized) contains `needle` as a whole word/phrase, not a substring — so
 *  "anal" does not match "analyse" and "cnc" does not match "cnch". */
function containsPhrase(haystack: string, needle: string): boolean {
  const n = normalizeText(needle);
  if (n === '') return false;
  return new RegExp(`(?:^| )${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: |$)`).test(haystack);
}

/** Every category whose distinctive keywords appear in the given text. */
export function categoriesMentionedIn(text: string): IntimacyCategory[] {
  const norm = normalizeText(text);
  if (norm === '') return [];
  return INTIMACY_CATEGORIES.filter((c) =>
    (CATEGORY_KEYWORDS[c] ?? []).some((k) => containsPhrase(norm, k)),
  );
}

/** One prior intimacy question/title already sent to this recipient. */
export interface AskedIntimacyText {
  text: string;
  /** ISO timestamp of the send, when known — drives `lastAskedAt` and the dormancy re-open. */
  at?: string;
}

export interface IntimacyCoverageInput {
  /** The acts rated in onboarding (carrying their STABLE key — see `CoveredAct`). */
  coveredActs: readonly CoveredAct[];
  /** Prompts + titles of the intimacy questionnaires already sent to this recipient. */
  askedIntimacy: readonly AskedIntimacyText[];
  /** Newest signal (insight / dream / session / questionnaire answer) touching intimacy, if any (§27.4). */
  newMaterialAt?: string | undefined;
  /** Newest onboarding / profile / intimacy-inventory edit by the recipient (§27.4). */
  profileEditedAt?: string | undefined;
  /** The author's current exploration focus — an explicit request for ground (§27.4). */
  explicitFocus?: string | undefined;
  now: Date;
}

export interface IntimacyCategoryCoverage {
  category: IntimacyCategory;
  label: string;
  /** The person rated at least one act in this category during onboarding. */
  rated: boolean;
  /** How many prior intimacy check-ins worked this category. */
  askedCount: number;
  /** ISO timestamp of the most recent ask, when known. */
  lastAskedAt?: string;
  /** Worked through: `askedCount >= SATURATION_ASKS` and not re-opened. */
  saturated: boolean;
  /** Set when the category WOULD be saturated but a §27.4 signal re-opened it. */
  reopenedBy?: ReopenSignal;
}

export interface IntimacyCoverage {
  byCategory: readonly IntimacyCategoryCoverage[];
  /** Never rated, never asked — the ground to go to first (§27.3). */
  uncovered: readonly IntimacyCategory[];
  /** Rated or lightly asked — deepening still has somewhere to go. */
  open: readonly IntimacyCategory[];
  /** Worked through — off-limits until re-opened (§27.3/§27.4). */
  saturated: readonly IntimacyCategory[];
  /** The rated acts it is still fair to deepen (those in a non-saturated category). This is what replaces the
   *  unbounded "go DEEPER on everything they rated" list that caused #314. */
  deepenableActs: readonly CoveredAct[];
}

/**
 * Is `a` a later timestamp than `b`? Unknown/unparseable `b` counts as "older", so a signal wins against it.
 *
 * CAVEAT for future callers: that means a category whose asks carry NO `at` is re-opened by ANY new material,
 * so it can never saturate. Benign today — `Assignment.createdAt` is required, so both real callers always
 * supply `at` — but a caller that omits it would silently disable saturation for that ground.
 */
function newerThan(a: string | undefined, b: string | undefined): boolean {
  if (!a) return false;
  if (!b) return true;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta)) return false;
  if (Number.isNaN(tb)) return true;
  return ta > tb;
}

/**
 * Build the coverage map. Pure + total — malformed timestamps degrade to "unknown" (never throw), and an empty
 * input yields every category `uncovered`, which is the correct starting state for a new person.
 */
export function buildIntimacyCoverage(input: IntimacyCoverageInput): IntimacyCoverage {
  const ratedCategories = new Set<IntimacyCategory>();
  for (const act of input.coveredActs) {
    const cat = categoryForKey(act.key);
    if (cat) ratedCategories.add(cat);
  }

  const askedCount = new Map<IntimacyCategory, number>();
  const lastAsked = new Map<IntimacyCategory, string>();
  for (const asked of input.askedIntimacy) {
    for (const cat of categoriesMentionedIn(asked.text)) {
      askedCount.set(cat, (askedCount.get(cat) ?? 0) + 1);
      if (asked.at && newerThan(asked.at, lastAsked.get(cat))) lastAsked.set(cat, asked.at);
    }
  }

  const focusCategories = new Set(
    input.explicitFocus ? categoriesMentionedIn(input.explicitFocus) : [],
  );

  const byCategory: IntimacyCategoryCoverage[] = INTIMACY_CATEGORIES.map((category) => {
    const count = askedCount.get(category) ?? 0;
    const last = lastAsked.get(category);
    const rated = ratedCategories.has(category);

    // §27.4 — any one of the four new-material signals re-opens a worked-through category.
    let reopenedBy: ReopenSignal | undefined;
    if (count >= SATURATION_ASKS) {
      if (focusCategories.has(category)) reopenedBy = 'explicit-request';
      else if (newerThan(input.newMaterialAt, last)) reopenedBy = 'new-material';
      else if (newerThan(input.profileEditedAt, last)) reopenedBy = 'profile-edit';
      else if (last !== undefined) {
        const t = Date.parse(last);
        if (!Number.isNaN(t) && input.now.getTime() - t >= DORMANT_DAYS * DAY_MS) {
          reopenedBy = 'dormant';
        }
      }
    }

    return {
      category,
      label: INTIMACY_CATEGORY_LABELS[category],
      rated,
      askedCount: count,
      ...(last !== undefined ? { lastAskedAt: last } : {}),
      saturated: count >= SATURATION_ASKS && reopenedBy === undefined,
      ...(reopenedBy !== undefined ? { reopenedBy } : {}),
    };
  });

  const saturated = byCategory.filter((c) => c.saturated).map((c) => c.category);
  const uncovered = byCategory
    .filter((c) => !c.saturated && !c.rated && c.askedCount === 0)
    .map((c) => c.category);
  const open = byCategory
    .filter((c) => !c.saturated && (c.rated || c.askedCount > 0))
    .map((c) => c.category);

  const saturatedSet = new Set(saturated);
  const deepenableActs = input.coveredActs.filter((act) => {
    const cat = categoryForKey(act.key);
    return cat === undefined || !saturatedSet.has(cat);
  });

  return { byCategory, uncovered, open, saturated, deepenableActs };
}

/**
 * Order categories for a tier's register (08 §27.3).
 *
 * `INTIMACY_CATEGORIES` is ordered by ASCENDING baseline intensity (49), so taking it as-is would hand an
 * `unfiltered` set the four gentlest areas (sensual, oral, manual-toys, penetration) while the tier directive
 * demands "go well BEYOND vanilla into the extreme" — two directives in conflict, and exactly the tension
 * behind the 2026-07-14 tame-unfiltered-output report. So `unfiltered` walks the inventory from the most
 * intense end; `explicit` (the deliberate step back) keeps the gentler-first order.
 */
export function orderCategoriesForTier(
  categories: readonly IntimacyCategory[],
  tier?: 'explicit' | 'unfiltered',
): IntimacyCategory[] {
  const intensity = (c: IntimacyCategory): number => INTIMACY_CATEGORIES.indexOf(c);
  const ordered = [...categories];
  return tier === 'unfiltered'
    ? ordered.sort((a, b) => intensity(b) - intensity(a))
    : ordered.sort((a, b) => intensity(a) - intensity(b));
}

/**
 * The category an intimacy check-in should open next: uncovered ground first (ordered for the tier), then the
 * least-worked open category. `undefined` only when every category is saturated, which the caller treats as
 * "fall through to the tier's creative ladder", never as re-mining.
 */
export function nextIntimacyCategory(
  coverage: IntimacyCoverage,
  tier?: 'explicit' | 'unfiltered',
): IntimacyCategory | undefined {
  const first = orderCategoriesForTier(coverage.uncovered, tier)[0];
  if (first !== undefined) return first;
  const openByLeastWorked = coverage.byCategory
    .filter((c) => !c.saturated)
    .sort((a, b) => a.askedCount - b.askedCount);
  return openByLeastWorked[0]?.category;
}

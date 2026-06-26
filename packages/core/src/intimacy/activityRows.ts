/**
 * Anatomy-driven **intake activity-matrix rows** with **stable keys** (46-intimacy-matrix-accuracy §4.2/§5),
 * over the **categorized, tiered inventory** (49-intimacy-activities-inventory).
 *
 * The shared inventory ([`topics.ts`](./topics.ts) — `INTIMACY_ACTIVITIES_FULL`) is the single source of
 * truth for questionnaire generation ([`08`](../../../docs/specs/08-questionnaires.md)) AND the onboarding
 * intimacy activity matrix ([`18`](../../../docs/specs/18-personal-onboarding.md) §14.5) — so it is **never
 * mutated** per-person. Instead the onboarding RENDER layer resolves a person-specific row list here, in
 * **display order** (category order, tier within a category, sensual→extreme — `orderedActivities()`): only
 * the **oral** rows are relabelled/split by anatomy (own anatomy → the receiving label; partner anatomy → the
 * giving label(s)); every other act stays universal with its inventory label. The two relationship dynamics
 * (`Degradation / humiliation`, `Praise / worship`, 27 §4.3) are **folded into the inventory** as
 * `power-exchange` entries (49 §11), so they're rated like any other row + carried into the kink test's
 * subscale ([`50`](50-self-assessments.md)).
 *
 * **Anatomy is asked directly (46), never inferred.** Two explicit 18+/`restricted` questions drive the
 * labels: `ownAnatomy` (single) and `partnerAnatomy` (multi). Neutral labels are used **only** for a genuine
 * non-answer ("rather not say" / unset / "don't mind") — never triggered merely by a non-binary gender or an
 * "Everyone" orientation. `drawnTo` stays standalone coaching context; it no longer touches the act labels.
 *
 * **Stable keys ≠ display labels.** Each row carries a `{ key, label }` (the §4.2 `MatrixRow` shape): the
 * matrix value is keyed by the anatomy-independent `key` (`oral-receiving`, `oral-giving-penis`, the inventory
 * entry key per universal act, …), so editing anatomy/gender/orientation re-labels a row without orphaning its
 * rating. Synthesis re-resolves with the same anatomy context; {@link legacyKeyFor}/
 * {@link migrateActivityMatrixValue} re-attach pre-46/pre-49 answers keyed by old label strings (or old
 * slugs) to their stable keys (any unmapped key is preserved verbatim).
 */

import type { MatrixRow } from '../schemas';
import { INTIMACY_ACTIVITIES_FULL, orderedActivities } from './topics';

/** The 5-point feeling scale for the intake activity matrix (27 §4.2). Index 0 is the boundary ("Hard no"). */
export const ACTIVITY_POINT_LABELS: readonly string[] = [
  'Hard no',
  'Not interested',
  'Curious',
  'Like it',
  'Love it',
];

/** Which point labels render with the distinct boundary/limit tone (a hard no is a boundary, not a feeling). */
export const ACTIVITY_LIMIT_LABELS: readonly string[] = ['Hard no'];

/** Options for the `ownAnatomy` single-select (46 §4.1) — casual, non-clinical, never assuming gender. */
export const OWN_ANATOMY_OPTIONS: readonly string[] = [
  'Cock (penis)',
  'Pussy (vulva)',
  'Both or intersex',
  'Rather not say',
];

/** Options for the `partnerAnatomy` multi-select (46 §4.1) — what the person is into on a partner. */
export const PARTNER_ANATOMY_OPTIONS: readonly string[] = [
  'Cock (penis)',
  'Pussy (vulva)',
  "Don't mind",
];

// Which anatomy answer means "penis" vs "vulva" (the value drives only the oral labels).
const ANATOMY_PENIS = 'Cock (penis)';
const ANATOMY_VULVA = 'Pussy (vulva)';

// The inventory's two oral rows are the only anatomy-tailored entries (matched by their stable inventory keys).
const KEY_ORAL_GIVING = 'oral-giving';
const KEY_ORAL_RECEIVING = 'oral-receiving';

// Stable, anatomy-independent keys for the resolved oral rows. The KEY never changes when the label re-resolves.
const KEY_ORAL_GIVING_PENIS = 'oral-giving-penis';
const KEY_ORAL_GIVING_VULVA = 'oral-giving-vulva';
const KEY_ORAL_GIVING_NEUTRAL = KEY_ORAL_GIVING;

/** Deterministic, stable slug for a label → its anatomy-independent row key. Stable as long as the SHARED
 * inventory labels don't change (which spec 08 §16.5a guarantees). Kept in sync with `topics.ts`'s `slug`. */
export function slugifyActivity(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface ActivityRowContext {
  /** The person's own anatomy (intimacy `ownAnatomy` single). Drives the receiving-oral label. */
  ownAnatomy?: string | undefined;
  /** The partner anatomy the person is into (intimacy `partnerAnatomy` multi). Drives the giving-oral row(s). */
  partnerAnatomy?: string[] | undefined;
}

interface OralRows {
  /** The single receiving-oral row (always shown), labelled by own anatomy. */
  receiving: MatrixRow;
  /** The giving-oral row(s) — 1 per partner anatomy the person is into (a single neutral row when none). */
  giving: MatrixRow[];
}

/** Resolve the oral rows from own anatomy (receiving) + partner anatomy (giving). Neutral labels only for a
 * genuine non-answer — never guessed from gender/orientation. Keys are always stable. */
function resolveOral(ctx: ActivityRowContext): OralRows {
  const receivingLabel =
    ctx.ownAnatomy === ANATOMY_PENIS
      ? 'Receiving oral (blowjob)'
      : ctx.ownAnatomy === ANATOMY_VULVA
        ? 'Receiving oral (going down on you)'
        : // 'Both or intersex', 'Rather not say', unset, or anything unrecognized → neutral (never guess).
          'Receiving oral';
  const receiving: MatrixRow = { key: KEY_ORAL_RECEIVING, label: receivingLabel };

  const partner = ctx.partnerAnatomy ?? [];
  const giving: MatrixRow[] = [];
  // Order: penis then vulva (matches the inventory's single 'Giving oral' slot expanding deterministically).
  if (partner.includes(ANATOMY_PENIS)) {
    giving.push({ key: KEY_ORAL_GIVING_PENIS, label: 'Giving a blowjob' });
  }
  if (partner.includes(ANATOMY_VULVA)) {
    giving.push({ key: KEY_ORAL_GIVING_VULVA, label: 'Going down on her (oral)' });
  }
  // No specific partner anatomy ("don't mind" / unset / unrecognized) → one neutral giving row.
  if (giving.length === 0) {
    giving.push({ key: KEY_ORAL_GIVING_NEUTRAL, label: 'Giving oral' });
  }
  return { receiving, giving };
}

/**
 * The intake activity-matrix rows tailored to the person: the categorized inventory (in display order —
 * category, then tier) with only its two oral rows relabelled/split by anatomy. Each row is a stable
 * `{ key, label }` (46 §4.2) — the key is anatomy-independent, the label re-resolves. Pass `{}` for the
 * neutral default. Rows arrive grouped sensual→extreme so {@link import('./grouping').groupMatrixRowsByCategory}
 * can render category headers (49 §3.1).
 */
export function resolveIntakeActivityRows(ctx: ActivityRowContext = {}): MatrixRow[] {
  const oral = resolveOral(ctx);
  const rows: MatrixRow[] = [];
  for (const act of orderedActivities()) {
    if (act.key === KEY_ORAL_GIVING) rows.push(...oral.giving);
    else if (act.key === KEY_ORAL_RECEIVING) rows.push(oral.receiving);
    else rows.push({ key: act.key, label: act.label });
  }
  return rows;
}

/** The set of every stable key the current resolver can emit — used to recognise an already-migrated key. */
const STABLE_KEYS: ReadonlySet<string> = new Set<string>([
  KEY_ORAL_RECEIVING,
  KEY_ORAL_GIVING_PENIS,
  KEY_ORAL_GIVING_VULVA,
  KEY_ORAL_GIVING_NEUTRAL,
  ...INTIMACY_ACTIVITIES_FULL.map((act) => act.key),
]);

/**
 * Explicit map of every **pre-49** flat-inventory label (and its old slug) whose stable key changed in the
 * 49 expansion → the **closest** new entry's stable key (49 §4.3). Old labels still present in the expanded
 * inventory (same label) are covered by the inventory-derived map below and need no entry here. Where one old
 * row split into several new rows, the rating re-attaches to the closest entry (documented per-mapping); the
 * rest start unrated. `'Squirting'` is intentionally absent — it has no close new entry, so a prior rating is
 * preserved verbatim as an orphan (no data loss).
 */
const PRE_49_LEGACY_KEYS: Readonly<Record<string, string>> = {
  // Dedup (user, 2026-06-26): 'Sensory deprivation (blindfold-only)' merged into 'Blindfolds'.
  'Sensory deprivation (blindfold-only)': 'blindfolds',
  'sensory-deprivation-blindfold-only': 'blindfolds',
  // 'Butt plugs / anal toys' → 'Anal toys / butt plugs'.
  'Butt plugs / anal toys': 'anal-toys-butt-plugs',
  'butt-plugs-anal-toys': 'anal-toys-butt-plugs',
  // 'Vibrators / dildos' split → vibrators (closest).
  'Vibrators / dildos': 'vibrators',
  'vibrators-dildos': 'vibrators',
  // 'Bondage' → 'Light bondage (cuffs / ties)' (closest).
  Bondage: 'light-bondage-cuffs-ties',
  bondage: 'light-bondage-cuffs-ties',
  // 'Choking (giving/receiving)' → 'Breath play / choking (…)'.
  'Choking (giving)': 'breath-play-choking-giving',
  'choking-giving': 'breath-play-choking-giving',
  'Choking (receiving)': 'breath-play-choking-receiving',
  'choking-receiving': 'breath-play-choking-receiving',
  // 'BDSM / dom-sub play' (general) → 'Switching' (does both — the closest single entry).
  'BDSM / dom-sub play': 'switching',
  'bdsm-dom-sub-play': 'switching',
  // 'Role-play' → 'General role-play'.
  'Role-play': 'general-role-play',
  'role-play': 'general-role-play',
  // 'Dirty talk' (general) → 'Light dirty talk' (closest of the split).
  'Dirty talk': 'light-dirty-talk',
  'dirty-talk': 'light-dirty-talk',
};

/**
 * Maps every label string a PRE-46/PRE-49 resolver could emit → its stable key, so a rating stored under an
 * old label (or old slug) re-attaches to the right row (46 §4.3, 49 §4.3). Covers the neutral oral labels,
 * the anatomy oral variants, every current inventory label → its (possibly new) stable key, and the explicit
 * pre-49 splits/renames above. Any key NOT here (already-stable, or genuinely unknown) is left untouched by
 * {@link migrateActivityMatrixValue}.
 */
export const LEGACY_ACTIVITY_KEY_MAP: Readonly<Record<string, string>> = {
  // Oral — neutral + anatomy variants + pre-49 inventory base labels.
  'Giving oral': KEY_ORAL_GIVING_NEUTRAL,
  'Receiving oral': KEY_ORAL_RECEIVING,
  'Giving a blowjob': KEY_ORAL_GIVING_PENIS,
  'Going down on her (oral)': KEY_ORAL_GIVING_VULVA,
  'Receiving oral (blowjob)': KEY_ORAL_RECEIVING,
  'Receiving oral (going down on you)': KEY_ORAL_RECEIVING,
  'Oral (giving)': KEY_ORAL_GIVING_NEUTRAL,
  'Oral (receiving)': KEY_ORAL_RECEIVING,
  // Every current inventory label → its stable key (an answer keyed by the current label re-attaches).
  ...Object.fromEntries(INTIMACY_ACTIVITIES_FULL.map((act) => [act.label, act.key])),
  // The explicit pre-49 splits/renames (old label + old slug → closest new key). Spread LAST so a pre-49
  // old label always wins over an accidental same-string current label (there is none today, but order-safe).
  ...PRE_49_LEGACY_KEYS,
};

/** The stable key for a pre-46/pre-49 label-keyed rating, or `undefined` if unknown (keep verbatim). */
export function legacyKeyFor(label: string): string | undefined {
  return LEGACY_ACTIVITY_KEY_MAP[label];
}

/**
 * Re-key a stored `activities` matrix value (46 §4.3, 49 §4.3): map any pre-46/pre-49 label key → its stable
 * key; keep an already-stable key as-is; keep an unmapped key verbatim (preserved, never dropped). Idempotent
 * — re-running never double-maps. A genuine stable rating always wins over a legacy one that maps to the same
 * key (first-wins).
 */
export function migrateActivityMatrixValue(value: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  // Pass 1: copy keys that are already stable OR genuinely unknown (orphans) — these are authoritative.
  for (const [k, point] of Object.entries(value)) {
    if (STABLE_KEYS.has(k) || legacyKeyFor(k) === undefined) out[k] = point;
  }
  // Pass 2: map legacy label keys to their stable key, only if that key isn't already set (first-wins).
  for (const [k, point] of Object.entries(value)) {
    const stable = legacyKeyFor(k);
    if (stable !== undefined && !STABLE_KEYS.has(k) && out[stable] === undefined)
      out[stable] = point;
  }
  return out;
}

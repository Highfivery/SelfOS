/**
 * Anatomy-driven **intake activity-matrix rows** with **stable keys** (46-intimacy-matrix-accuracy §4.2/§5).
 *
 * The shared `INTIMACY_ACTIVITIES` inventory ([`topics.ts`](./topics.ts)) is the single source of truth for
 * questionnaire generation ([`08`](../../../docs/specs/08-questionnaires.md)) AND the onboarding intimacy
 * activity matrix ([`18`](../../../docs/specs/18-personal-onboarding.md) §14.5) — so it is **never mutated**
 * per-person. Instead the onboarding RENDER layer resolves a person-specific row list here: only the **oral**
 * rows are relabelled/split by anatomy (own anatomy → the receiving label; partner anatomy → the giving
 * label(s)); every other act stays universal with its inventory label. The two relationship dynamics
 * (`Degradation / humiliation`, `Praise / worship`, 27 §4.3) are appended — intake-only, never added to the
 * shared inventory.
 *
 * **Anatomy is asked directly (46), never inferred.** The old resolver guessed own anatomy from `gender` and
 * partner anatomy from `drawnTo` (orientation) — wrong for anyone whose gender ≠ anatomy (a trans woman with
 * a penis got generic fallbacks) and a who-you-date-vs-what-they-have conflation (GitHub #62). Now two
 * explicit 18+/`restricted` questions drive the labels: `ownAnatomy` (single) and `partnerAnatomy` (multi).
 * Neutral labels are used **only** for a genuine non-answer ("rather not say" / unset / "don't mind") — never
 * triggered merely by a non-binary gender or an "Everyone" orientation. `drawnTo` stays standalone coaching
 * context; it no longer touches the act labels.
 *
 * **Stable keys ≠ display labels.** Each row carries a `{ key, label }` (the §4.2 `MatrixRow` shape): the
 * matrix value is keyed by the anatomy-independent `key` (`oral-receiving`, `oral-giving-penis`, a slug per
 * universal act, …), so editing anatomy/gender/orientation re-labels a row without orphaning its rating.
 * Synthesis re-resolves with the same anatomy context; {@link legacyKeyFor}/{@link migrateActivityMatrixValue}
 * re-attach pre-46 answers keyed by old label strings to their stable keys (any unmapped key is preserved).
 */

import type { MatrixRow } from '../schemas';
import { INTIMACY_ACTIVITIES } from './topics';

/** The two relationship-dynamic rows folded into the intake activity matrix (27 §4.3) — intake-only, NOT in
 * the shared `INTIMACY_ACTIVITIES` inventory the questionnaire engine reads. */
export const INTIMACY_MATRIX_DYNAMICS: readonly string[] = [
  'Degradation / humiliation',
  'Praise / worship',
];

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

// The inventory's two oral rows are the only anatomy-tailored entries; everything else stays universal.
const ORAL_GIVING = 'Oral (giving)';
const ORAL_RECEIVING = 'Oral (receiving)';

// Stable, anatomy-independent keys for the oral rows. The KEY never changes when the label re-resolves.
const KEY_ORAL_RECEIVING = 'oral-receiving';
const KEY_ORAL_GIVING_PENIS = 'oral-giving-penis';
const KEY_ORAL_GIVING_VULVA = 'oral-giving-vulva';
const KEY_ORAL_GIVING_NEUTRAL = 'oral-giving';

/** Deterministic, stable slug for a universal activity / dynamic label → its anatomy-independent row key.
 * Stable as long as the SHARED inventory labels don't change (which spec 08 §16.5a guarantees). */
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
  // Order: penis then vulva (matches the inventory's single 'Oral (giving)' slot expanding deterministically).
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
 * The intake activity-matrix rows tailored to the person: the shared inventory with only its two oral rows
 * relabelled/split by anatomy, then the two relationship-dynamics rows. Each row is a stable `{ key, label }`
 * (46 §4.2) — the key is anatomy-independent, the label re-resolves. Pass `{}` for the neutral default.
 */
export function resolveIntakeActivityRows(ctx: ActivityRowContext = {}): MatrixRow[] {
  const oral = resolveOral(ctx);
  const rows: MatrixRow[] = [];
  for (const act of INTIMACY_ACTIVITIES) {
    if (act === ORAL_GIVING) rows.push(...oral.giving);
    else if (act === ORAL_RECEIVING) rows.push(oral.receiving);
    else rows.push({ key: slugifyActivity(act), label: act });
  }
  for (const dyn of INTIMACY_MATRIX_DYNAMICS) rows.push({ key: slugifyActivity(dyn), label: dyn });
  return rows;
}

/** The set of every stable key the current resolver can emit — used to recognise an already-migrated key. */
const STABLE_KEYS: ReadonlySet<string> = new Set<string>([
  KEY_ORAL_RECEIVING,
  KEY_ORAL_GIVING_PENIS,
  KEY_ORAL_GIVING_VULVA,
  KEY_ORAL_GIVING_NEUTRAL,
  ...INTIMACY_ACTIVITIES.filter((a) => a !== ORAL_GIVING && a !== ORAL_RECEIVING).map(
    slugifyActivity,
  ),
  ...INTIMACY_MATRIX_DYNAMICS.map(slugifyActivity),
]);

/**
 * Maps every label string the PRE-46 resolver could emit → its stable key, so a rating stored under an old
 * label re-attaches to the right row (46 §4.3). Covers the neutral oral labels, the anatomy oral variants,
 * the inventory base oral labels, every universal activity label, and the two dynamics. Any key NOT here
 * (already-stable, or genuinely unknown) is left untouched by {@link migrateActivityMatrixValue}.
 */
export const LEGACY_ACTIVITY_KEY_MAP: Readonly<Record<string, string>> = {
  // Oral — neutral + anatomy variants + inventory base labels.
  'Giving oral': KEY_ORAL_GIVING_NEUTRAL,
  'Receiving oral': KEY_ORAL_RECEIVING,
  'Giving a blowjob': KEY_ORAL_GIVING_PENIS,
  'Going down on her (oral)': KEY_ORAL_GIVING_VULVA,
  'Receiving oral (blowjob)': KEY_ORAL_RECEIVING,
  'Receiving oral (going down on you)': KEY_ORAL_RECEIVING,
  [ORAL_GIVING]: KEY_ORAL_GIVING_NEUTRAL,
  [ORAL_RECEIVING]: KEY_ORAL_RECEIVING,
  // Every universal activity label → its slug.
  ...Object.fromEntries(
    INTIMACY_ACTIVITIES.filter((a) => a !== ORAL_GIVING && a !== ORAL_RECEIVING).map((a) => [
      a,
      slugifyActivity(a),
    ]),
  ),
  // The two relationship dynamics.
  ...Object.fromEntries(INTIMACY_MATRIX_DYNAMICS.map((d) => [d, slugifyActivity(d)])),
};

/** The stable key for a pre-46 label-keyed rating, or `undefined` if the label is unknown (keep verbatim). */
export function legacyKeyFor(label: string): string | undefined {
  return LEGACY_ACTIVITY_KEY_MAP[label];
}

/**
 * Re-key a stored `activities` matrix value (46 §4.3): map any pre-46 label key → its stable key; keep an
 * already-stable key as-is; keep an unmapped key verbatim (preserved, never dropped). Idempotent — re-running
 * never double-maps. A genuine stable rating always wins over a legacy one that maps to the same key.
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

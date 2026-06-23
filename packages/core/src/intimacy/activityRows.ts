/**
 * Gender/orientation-aware **intake activity-matrix rows** (27-intimacy-redesign §4.2/§5).
 *
 * The shared `INTIMACY_ACTIVITIES` inventory ([`topics.ts`](./topics.ts)) is the single source of truth for
 * questionnaire generation ([`08`](../../../docs/specs/08-questionnaires.md)) AND the onboarding intimacy
 * activity matrix ([`18`](../../../docs/specs/18-personal-onboarding.md) §14.5) — so it is **never mutated**
 * per-person. Instead the onboarding RENDER layer resolves a person-specific row list here: only the **oral**
 * rows are relabelled/hidden by anatomy (own anatomy for receiving, partner anatomy for giving); every other
 * act stays universal with its inventory label. The two relationship dynamics (`Degradation / humiliation`,
 * `Praise / worship`, 27 §4.3) are appended — intake-only, never added to the shared inventory.
 *
 * **Never erase on uncertainty.** If either own anatomy (gender) or partner anatomy (`drawnTo`) is at all
 * ambiguous — non-binary / trans / "everyone" / unset — the FULL list renders with neutral oral labels. We
 * only tailor when both are unambiguous (a binary gender + drawnTo limited to Men/Women).
 *
 * The returned rows are display labels AND the matrix answer keys. Synthesis re-resolves with the same
 * `(gender, drawnTo)`, so the keys line up; a label change is the value change (kept simple — the existing
 * matrix keys every answer by its row string everywhere, so a value/label split would ripple into every
 * matrix consumer for no real gain on a one-pass intake).
 */

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

// The inventory's two oral rows are the only anatomy-tailored entries; everything else stays universal.
const ORAL_GIVING = 'Oral (giving)';
const ORAL_RECEIVING = 'Oral (receiving)';

// drawnTo tokens that carry anatomy ambiguity → fall back to neutral (never assume). 'Men'/'Women' are the
// only unambiguous-enough tokens we tailor on; 'Trans women'/'Trans men'/'Non-binary people'/'Everyone'/'Other'
// (and an empty selection) all force the neutral full list.
const UNCERTAIN_DRAWN_TO: ReadonlySet<string> = new Set([
  'Everyone',
  'Non-binary people',
  'Trans women',
  'Trans men',
  'Other',
]);

export interface ActivityRowContext {
  /** The person's gender identity (basics §14.4). Only 'Man'/'Woman' tailor the oral labels. */
  gender?: string | undefined;
  /** Who the person is drawn to (intimacy 'drawnTo' multi). Only Men/Women tailor the giving-oral rows. */
  drawnTo?: string[] | undefined;
}

interface OralRows {
  /** The single receiving-oral row (always shown), labelled by own anatomy. */
  receiving: string;
  /** The giving-oral row(s) — 1 per partner anatomy the person is drawn to (0 only when neutral has 1). */
  giving: string[];
}

/** Resolve the oral rows from own anatomy (receiving) + partner anatomy (giving), with the safe neutral
 * fallback the moment either is ambiguous. */
function resolveOral(ctx: ActivityRowContext): OralRows {
  const ownPenis = ctx.gender === 'Man';
  const ownVulva = ctx.gender === 'Woman';
  const genderCertain = ownPenis || ownVulva;

  const drawnTo = ctx.drawnTo ?? [];
  const drawnPenis = drawnTo.includes('Men');
  const drawnVulva = drawnTo.includes('Women');
  const drawnCertain =
    drawnTo.length > 0 &&
    !drawnTo.some((d) => UNCERTAIN_DRAWN_TO.has(d)) &&
    (drawnPenis || drawnVulva);

  // Any ambiguity in EITHER own anatomy or partner anatomy → neutral full labels (never hide on uncertainty).
  if (!genderCertain || !drawnCertain) {
    return { receiving: 'Receiving oral', giving: ['Giving oral'] };
  }

  const receiving = ownPenis ? 'Receiving oral (blowjob)' : 'Receiving oral (going down on you)';
  const giving: string[] = [];
  // A straight man (drawnTo = Women) gets only the cunnilingus-giving row, NEVER "give a blowjob"; a bi
  // person drawn to both gets both. Order follows drawnTo's penis-then-vulva precedence.
  if (drawnPenis) giving.push('Giving a blowjob');
  if (drawnVulva) giving.push('Going down on her (oral)');
  return { receiving, giving };
}

/**
 * The intake activity-matrix rows tailored to the person: the shared inventory with only its two oral rows
 * relabelled/split by anatomy, then the two relationship-dynamics rows. Pass `{}` for the neutral default.
 */
export function resolveIntakeActivityRows(ctx: ActivityRowContext = {}): string[] {
  const oral = resolveOral(ctx);
  const rows: string[] = [];
  for (const act of INTIMACY_ACTIVITIES) {
    if (act === ORAL_GIVING) rows.push(...oral.giving);
    else if (act === ORAL_RECEIVING) rows.push(oral.receiving);
    else rows.push(act);
  }
  rows.push(...INTIMACY_MATRIX_DYNAMICS);
  return rows;
}

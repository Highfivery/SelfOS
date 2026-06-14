import type { SensitivityTier } from '@shared/schemas';

/**
 * The questionnaire starter taxonomy + the sensitivity-gating rules (08-questionnaires §15.1/§15.2).
 * Kept as one pure, unit-testable module — the single source of truth the builder's type `<select>` and
 * Sensitivity picker derive from. Custom types are added by the user and persist in the vault.
 */
export const QUESTIONNAIRE_TYPES: { value: string; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'role-feedback', label: 'How am I doing in this role?' },
  { value: 'blind-spots', label: 'Honest outside view / blind spots' },
  { value: 'appreciation', label: 'Appreciation, strengths & weaknesses' },
  { value: 'perspective', label: 'Perspective on a recent event' },
  { value: 'fill-gaps', label: 'Fill the gaps' },
  { value: 'scenario', label: 'Scenario-based' },
  { value: 'intimacy', label: 'Intimacy' },
  { value: 'science', label: 'Science-informed' },
];

/** The neutral catch-all type; the default for a new questionnaire (§15.1). */
export const DEFAULT_TYPE = 'general';

/** The intimacy sensitivity tiers (§4.2) — an intimacy questionnaire is at least 18+ general. */
export const INTIMACY_TIERS: { value: SensitivityTier; label: string }[] = [
  { value: 'intimacyGeneral', label: 'Intimacy — General' },
  { value: 'explicit', label: 'Intimacy — Explicit' },
  { value: 'unfiltered', label: 'Intimacy — Unfiltered' },
];

export const STANDARD_OPTION = { value: 'standard' as const, label: 'Standard' };

interface SensitivityConfig {
  options: { value: SensitivityTier; label: string }[];
  default: SensitivityTier;
}

/**
 * Which questionnaire types surface the **Sensitivity** picker, and what it offers (§15.2). `intimacy`
 * is always sensitive (tiers only, no Standard, default `intimacyGeneral`); `scenario` may be sensitive
 * (Standard default + escalatable tiers). Every other type is implicitly `standard`: the picker is hidden
 * and the value is forced to `standard` on save. The `SensitivityTier` enum is unchanged — this only
 * governs *when* the control shows and what default it carries.
 */
export const SENSITIVITY_TYPES: Record<string, SensitivityConfig> = {
  intimacy: { options: INTIMACY_TIERS, default: 'intimacyGeneral' },
  scenario: { options: [STANDARD_OPTION, ...INTIMACY_TIERS], default: 'standard' },
};

/** The picker config for a type, or `null` when sensitivity doesn't apply (picker hidden). */
export function sensitivityConfigFor(type: string): SensitivityConfig | null {
  return SENSITIVITY_TYPES[type] ?? null;
}

/**
 * The sensitivity value that is shown, fed to AI generation, and saved — clamped so a stale tier on a
 * non-sensitivity type (or an invalid tier for the current type) can never leak through (§15.6). A valid
 * tier passes through; anything else drops to the type's default (or `standard` if it can't carry one).
 */
export function effectiveSensitivity(type: string, current: SensitivityTier): SensitivityTier {
  const cfg = SENSITIVITY_TYPES[type];
  if (!cfg) return 'standard';
  return cfg.options.some((o) => o.value === current) ? current : cfg.default;
}

/**
 * Seed the sensitivity when the type changes: keep the current tier if it's still valid for the new type,
 * otherwise drop to that type's default (or `standard`). This is the same clamp as `effectiveSensitivity`
 * — type-change seeding and save/display clamping are one operation today; the two names just mark intent
 * at the call sites. Kept as a delegate so a future divergence is made deliberately, in one place.
 */
export const seedSensitivityForType = effectiveSensitivity;

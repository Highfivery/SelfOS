// @selfos/core/intake — per-question sharing categories + default scopes (43-relationship-scoped-onboarding-
// sharing §4/§5). Pure (no crypto/host) so the renderer can import it to seed the per-question picker, and
// `submitSectionForm`/`synthesizePortrait` can default unset questions. Maps each intake section/question to a
// `SharingCategory` (42 §4.3) → the preset relationship types it shares with by default.

import { INTAKE_CATALOG, getIntakeSection } from './intakeCatalog';
import { SHARING_PRESETS, type SharingCategory } from '../people/sharingPresets';
import type { RelationshipType } from '../schemas';

/**
 * The default sharing category for each form section (43 §4). Drives the share-by-default presets. The two
 * restricted sections (`weighs` = trauma, `intimacy`) map to their restricted categories but still default to
 * **Private** at the question level (see `defaultScopeForQuestion`) — the category is what's offered when a
 * person explicitly opts a sensitive answer into sharing (partner-only, 42 §4.3 / 43 §8).
 */
export const SECTION_SHARING_CATEGORY: Readonly<Record<string, SharingCategory>> = {
  basics: 'basics',
  'life-now': 'basics',
  values: 'values',
  want: 'goals',
  health: 'health',
  relationships: 'relationships',
  'work-money': 'work',
  'joy-play': 'joy',
  family: 'family',
  story: 'story',
  weighs: 'trauma',
  intimacy: 'intimacy',
};

/** The fallback category for a section without an explicit mapping — the conservative `basics` preset. */
const DEFAULT_CATEGORY: SharingCategory = 'basics';

/**
 * The sharing category for a question — a per-question `category` override on the catalog mapping (43 §4),
 * else the section's category (`SECTION_SHARING_CATEGORY`), else `basics`. Pure + total.
 */
export function questionCategory(sectionId: string, questionId: string): SharingCategory {
  const def = getIntakeSection(sectionId);
  const override = def?.questions?.find((m) => m.q.id === questionId)?.category;
  return override ?? SECTION_SHARING_CATEGORY[sectionId] ?? DEFAULT_CATEGORY;
}

/**
 * Whether a question defaults to **Private** (no sharing) regardless of its category — a `restricted` question
 * (intimacy/trauma, per-question or whole-section). Restricted answers never share by default; the person must
 * explicitly opt them in (43 §3.1/§8). A non-restricted question shares per its category preset.
 */
export function questionDefaultsPrivate(sectionId: string, questionId: string): boolean {
  const def = getIntakeSection(sectionId);
  if (!def) return false;
  if (def.restricted) return true; // a wholly-restricted section (weighs / intimacy)
  return def.questions?.find((m) => m.q.id === questionId)?.restricted === true;
}

/**
 * The default sharing scope for a question (43 §3.4): **Private** (`[]`) for a restricted question/section
 * (sensitive — opt-in only), else the relationship types of its category preset (42 §4.3). The person sees
 * this default in the picker chip before submitting, so it's never a hidden share (43 §7).
 */
export function defaultScopeForQuestion(sectionId: string, questionId: string): RelationshipType[] {
  if (questionDefaultsPrivate(sectionId, questionId)) return [];
  return [...SHARING_PRESETS[questionCategory(sectionId, questionId)]];
}

/** Every form-section id in the catalog (so the renderer/tests can iterate the categorized sections). */
export function formSectionIds(): string[] {
  return INTAKE_CATALOG.filter((d) => d.mode === 'form' && d.questions).map((d) => d.id);
}

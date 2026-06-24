import type { RelationshipType } from '../schemas';

/**
 * Category-aware default sharing presets (42-relationship-scoped-sharing §4.3). The single source of truth
 * consumed by onboarding (43) to default a question's relationship-type scope sensibly, then overridable
 * per question. The principle (resolved 2026-06-23): partner = everything; close family/friends = all but
 * intimacy & trauma; coworker = basics/work/values; ex/other = nothing. The sensitive categories
 * (intimacy, trauma) default to **partner only** — never friends/family/coworkers — and even that applies
 * only once the person opts those answers into sharing in 43 (§8).
 */
export type SharingCategory =
  | 'basics'
  | 'values'
  | 'goals'
  | 'work'
  | 'joy'
  | 'health'
  | 'relationships'
  | 'family'
  | 'story'
  | 'intimacy'
  | 'trauma';

export const SHARING_PRESETS: Record<SharingCategory, RelationshipType[]> = {
  basics: ['partner', 'parent', 'child', 'sibling', 'friend', 'coworker'],
  values: ['partner', 'parent', 'child', 'sibling', 'friend', 'coworker'],
  goals: ['partner', 'parent', 'child', 'sibling', 'friend'],
  work: ['partner', 'parent', 'child', 'sibling', 'friend', 'coworker'],
  joy: ['partner', 'parent', 'child', 'sibling', 'friend'],
  health: ['partner'], // private-leaning; partner by default
  relationships: ['partner', 'friend'],
  family: ['partner', 'parent', 'child', 'sibling'],
  story: ['partner', 'friend'],
  intimacy: ['partner'], // restricted: partner ONLY by default
  trauma: ['partner'], // restricted: partner ONLY by default
};

/** The default relationship-type scope for a category — a fresh copy so callers can mutate it safely. */
export function presetFor(category: SharingCategory): RelationshipType[] {
  return [...SHARING_PRESETS[category]];
}

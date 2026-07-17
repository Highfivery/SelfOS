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

/**
 * Close (blood + step) family — treated like parent/child/sibling for non-sensitive defaults (family-like
 * defaults, resolved 2026-07-17). Gender-neutral structural types; never included in intimacy/trauma.
 */
const CLOSE_FAMILY: RelationshipType[] = [
  'parent',
  'child',
  'stepParent',
  'stepChild',
  'guardian',
  'ward',
  'grandparent',
  'grandchild',
  'greatGrandparent',
  'greatGrandchild',
  'sibling',
  'stepSibling',
  'halfSibling',
  'auntUncle',
  'nieceNephew',
  'cousin',
];

/** Family by marriage — family-facing info, but leaner than blood family (no goals/joy/work by default). */
const IN_LAWS: RelationshipType[] = ['parentInLaw', 'childInLaw', 'siblingInLaw'];

/** Extended social ties — lean private: only the lightest categories (basics/values) by default. */
const EXTENDED_SOCIAL: RelationshipType[] = [
  'roommate',
  'neighbor',
  'acquaintance',
  'mentor',
  'mentee',
];

export const SHARING_PRESETS: Record<SharingCategory, RelationshipType[]> = {
  basics: ['partner', ...CLOSE_FAMILY, ...IN_LAWS, 'friend', 'coworker', ...EXTENDED_SOCIAL],
  values: ['partner', ...CLOSE_FAMILY, ...IN_LAWS, 'friend', 'coworker', ...EXTENDED_SOCIAL],
  goals: ['partner', ...CLOSE_FAMILY, 'friend', 'mentor'],
  work: ['partner', ...CLOSE_FAMILY, 'friend', 'coworker', 'mentor'],
  joy: ['partner', ...CLOSE_FAMILY, 'friend'],
  health: ['partner'], // private-leaning; partner by default
  relationships: ['partner', 'friend'],
  family: ['partner', ...CLOSE_FAMILY, ...IN_LAWS],
  story: ['partner', 'friend'],
  intimacy: ['partner'], // restricted: partner ONLY by default
  trauma: ['partner'], // restricted: partner ONLY by default
};

/** The default relationship-type scope for a category — a fresh copy so callers can mutate it safely. */
export function presetFor(category: SharingCategory): RelationshipType[] {
  return [...SHARING_PRESETS[category]];
}

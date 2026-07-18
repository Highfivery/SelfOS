import type { RelationshipType } from './schemas';

/**
 * Shared relationship-sharing copy + helpers (42-relationship-scoped-sharing §3.2/§3.4). Crypto-free and
 * re-exported from the `@selfos/core` root, so the renderer (the `RelationshipScopePicker` + the
 * onboarding/Memory surfaces in specs 43/44) and the host (the confidentiality preamble in context
 * assembly) draw the honest "shared ≠ shown" message from ONE source.
 */

/** Human labels for each relationship type, in a stable display order (the picker's checkbox list). */
export const RELATIONSHIP_TYPE_LABELS: Record<RelationshipType, string> = {
  partner: 'Partner',
  ex: 'Ex',
  parent: 'Parent',
  child: 'Child',
  stepParent: 'Step-parent',
  stepChild: 'Step-child',
  guardian: 'Guardian',
  ward: 'Ward',
  grandparent: 'Grandparent',
  grandchild: 'Grandchild',
  greatGrandparent: 'Great-grandparent',
  greatGrandchild: 'Great-grandchild',
  sibling: 'Sibling',
  stepSibling: 'Step-sibling',
  halfSibling: 'Half-sibling',
  auntUncle: 'Aunt / Uncle',
  nieceNephew: 'Niece / Nephew',
  cousin: 'Cousin',
  parentInLaw: 'Parent-in-law',
  childInLaw: 'Child-in-law',
  siblingInLaw: 'Sibling-in-law',
  friend: 'Friend',
  roommate: 'Roommate',
  neighbor: 'Neighbor',
  acquaintance: 'Acquaintance',
  coworker: 'Coworker',
  mentor: 'Mentor',
  mentee: 'Mentee',
  other: 'Other',
};

/**
 * The inverse of a relationship type — how the OTHER end of an edge relates back (42 §5.1). Symmetric types
 * map to themselves; parent↔child invert (04 §4.2). The single source of truth, imported by both the core
 * resolver (`relationshipScope`) and the renderer's `availableRelationshipTypes` (this module is crypto-free,
 * so the renderer can import it without pulling the host-only `@selfos/core/people` barrel).
 */
export const INVERSE_RELATIONSHIP_TYPE: Record<RelationshipType, RelationshipType> = {
  // Symmetric types map to themselves; generational/asymmetric types invert (a grandfather's inverse is the
  // gender-neutral `grandchild`, which is exactly why the types are gender-neutral — the inverse stays clean).
  partner: 'partner',
  ex: 'ex',
  parent: 'child',
  child: 'parent',
  stepParent: 'stepChild',
  stepChild: 'stepParent',
  guardian: 'ward',
  ward: 'guardian',
  grandparent: 'grandchild',
  grandchild: 'grandparent',
  greatGrandparent: 'greatGrandchild',
  greatGrandchild: 'greatGrandparent',
  sibling: 'sibling',
  stepSibling: 'stepSibling',
  halfSibling: 'halfSibling',
  auntUncle: 'nieceNephew',
  nieceNephew: 'auntUncle',
  cousin: 'cousin',
  parentInLaw: 'childInLaw',
  childInLaw: 'parentInLaw',
  siblingInLaw: 'siblingInLaw',
  friend: 'friend',
  roommate: 'roommate',
  neighbor: 'neighbor',
  acquaintance: 'acquaintance',
  coworker: 'coworker',
  mentor: 'mentee',
  mentee: 'mentor',
  other: 'other',
};

/** The relationship types in picker order (partner first — the motivating couples/intimacy case). */
export const RELATIONSHIP_TYPE_ORDER: RelationshipType[] = [
  'partner',
  'ex',
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
  'parentInLaw',
  'childInLaw',
  'siblingInLaw',
  'friend',
  'roommate',
  'neighbor',
  'acquaintance',
  'coworker',
  'mentor',
  'mentee',
  'other',
];

/**
 * A short human summary of a sharing scope (42 §3.2): `Private` when empty, else the type labels joined —
 * `"Partner"`, `"Partner, Family"`. De-duped + ordered. Used by the picker chip + the transparency surfaces.
 */
export function describeScope(types: readonly RelationshipType[]): string {
  if (types.length === 0) return 'Private';
  const present = RELATIONSHIP_TYPE_ORDER.filter((type) => types.includes(type));
  // A scope covering every relationship type reads concisely as "everyone you relate to" — clearer than
  // listing all eight labels, and it keeps the sharing chip compact (matches the SharingPanel broadcast copy).
  if (present.length === RELATIONSHIP_TYPE_ORDER.length) return 'everyone you relate to';
  return present.map((type) => RELATIONSHIP_TYPE_LABELS[type]).join(', ');
}

/** The inline explainer rendered beside a scope control (42 §3.2). Honest "informs their AI, never shown". */
export const SHARING_INLINE_EXPLAINER =
  'Sharing lets the people you choose have this inform their AI coaching — to help personalize their ' +
  'experience (e.g. couples or intimacy coaching). They never see your answers directly, and their coach ' +
  "won't repeat them back.";

/** The expanded-popover explainer line in the picker (42 §3.1). */
export const SHARING_SCOPE_EXPLAINER =
  'People you relate to this way can have this inform their AI coaching — they never see it directly.';

/**
 * The confidentiality rule prepended before any cross-shared content in a context (42 §3.4). It makes
 * "shared ≠ shown" structurally true: the recipient's coach may USE the shared lines to shape its support
 * but must NEVER quote, attribute, or reveal them. Appended in the SAFETY-adjacent region (the context
 * block follows SAFETY in the system prompt), so it leads and is never overridable by persona/topic.
 */
export function confidentialityPreamble(viewerName: string): string {
  const name = viewerName.trim() || 'this person';
  return (
    `The lines below were shared by people related to ${name} to help you support ${name}. Treat them as ` +
    `private background: let them shape how you help, but never quote them, name who shared them, or ` +
    `reveal that you know them. If ${name} asks what someone else said or shared, say you don't share ` +
    `other people's private information.`
  );
}

/** Re-export the close-family relationship set so the Memory share-preset chip (65 §3.4) reuses ONE source. */
export { CLOSE_FAMILY } from './people/sharingPresets';

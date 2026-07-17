import { LIFE_AREAS, type ContextTopic, type Dream, type RelationshipType } from '../schemas';
import { lifeAreasFromText } from '../insights/lifeAreaKeywords';

/** A People-graph-linked person's relationship to the dreamer → the life-areas their presence implies. So a
 * dream about a partner/ex surfaces `Intimacy`, a parent/sibling/child surfaces `Family`, a coworker surfaces
 * `Work & purpose`. The topic only WIDENS which facts surface, so a coarse mapping is safe. */
const RELATIONSHIP_LIFE_AREAS: Record<RelationshipType, string[]> = {
  partner: ['Intimacy', 'Relationships'],
  ex: ['Intimacy', 'Relationships'],
  parent: ['Family'],
  child: ['Family'],
  stepParent: ['Family'],
  stepChild: ['Family'],
  guardian: ['Family'],
  ward: ['Family'],
  grandparent: ['Family'],
  grandchild: ['Family'],
  greatGrandparent: ['Family'],
  greatGrandchild: ['Family'],
  sibling: ['Family'],
  stepSibling: ['Family'],
  halfSibling: ['Family'],
  auntUncle: ['Family'],
  nieceNephew: ['Family'],
  cousin: ['Family'],
  parentInLaw: ['Family'],
  childInLaw: ['Family'],
  siblingInLaw: ['Family'],
  friend: ['Relationships'],
  roommate: ['Relationships'],
  neighbor: ['Relationships'],
  acquaintance: ['Relationships'],
  coworker: ['Work & purpose', 'Relationships'],
  mentor: ['Work & purpose', 'Relationships'],
  mentee: ['Work & purpose', 'Relationships'],
  other: ['Relationships'],
};

/**
 * Derive the relevance `topic` for a dream's analysis (28 §13.1 — the deferred 28b follow-up). Pure +
 * deterministic, NO AI cost: the dream's tags + narrative are scanned for life-area keywords (so a dream that
 * mentions sex/money/work surfaces `Intimacy`/`Money`/`Work & purpose`, etc.), a `nightmare` (or heavy
 * negative waking mood) always adds `Emotions & patterns`, and **people present** widen by their relationship
 * to the dreamer: `relationshipTypes` are the resolved types of the People-graph-linked figures who appeared
 * (a partner → `Intimacy`, a parent → `Family`, …; resolved async at the call site so this stays pure), and
 * any person present also adds the generic `Relationships` signal. The topic only WIDENS which PINNED portrait
 * facts surface (the summary always feeds, 28b), so a coarse signal is safe; no mappable signal ⇒ `undefined`
 * (the always-on core + priority fill). Emitted in canonical `LIFE_AREAS` order.
 */
export function dreamTopic(
  dream: Dream,
  relationshipTypes: RelationshipType[] = [],
): ContextTopic | undefined {
  const areas = new Set<string>(lifeAreasFromText([...dream.tags, dream.narrative].join(' ')));
  if (dream.nightmare || (typeof dream.mood === 'number' && dream.mood <= -0.5)) {
    areas.add('Emotions & patterns');
  }
  for (const type of relationshipTypes)
    for (const area of RELATIONSHIP_LIFE_AREAS[type]) areas.add(area);
  if (dream.people.length > 0) areas.add('Relationships');
  if (areas.size === 0) return undefined;
  return { lifeAreas: LIFE_AREAS.filter((area) => areas.has(area)) };
}

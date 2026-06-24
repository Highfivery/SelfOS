import {
  factSharedWithViewer,
  type InsightFact,
  type Relationship,
  type RelationshipType,
} from '../schemas';
import { INVERSE_RELATIONSHIP_TYPE as INVERSE } from '../sharing';

/**
 * Relationship-type-scoped sharing resolver (42-relationship-scoped-sharing §5.1). Pure, tested, and
 * importable by both `people` and (indirectly, via caller-resolved types) `insights` — so the sharing
 * boundary is computed in one place against the LIVE relationship graph, never per-person snapshots.
 * The inverse-type map is shared from `../sharing` (the single source of truth, also used by the renderer).
 */

/**
 * The relationship type(s) describing how the VIEWER relates to the SUBJECT — i.e. "the viewer is the
 * subject's ___" — because the subject scopes sharing as "share with my partner / parent / …". Resolved
 * from the live graph: an edge stored subject→viewer carries that role directly (`edge.type`); an edge
 * stored viewer→subject describes the subject's role to the viewer, so its inverse is taken (parent↔child).
 * A pair may have more than one edge, so all matching types are returned (de-duped). Empty when unrelated.
 *
 * `edge.type` is read as "the `toPersonId` is the `fromPersonId`'s `type`" (matching the People editor + the
 * `buildContext` display label) — so a subject→viewer edge's type IS the viewer's role to the subject.
 */
export function relationshipTypesFromSubjectToViewer(
  subjectId: string,
  viewerId: string,
  relationships: Relationship[],
): RelationshipType[] {
  const types = new Set<RelationshipType>();
  for (const edge of relationships) {
    if (edge.fromPersonId === subjectId && edge.toPersonId === viewerId) {
      types.add(edge.type);
    } else if (edge.fromPersonId === viewerId && edge.toPersonId === subjectId) {
      types.add(INVERSE[edge.type]);
    }
  }
  return [...types];
}

/**
 * The single gate combining the resolver with `factSharedWithViewer` (42 §5.1): may a fact owned by
 * `subjectId` flow into `viewerId`'s coaching context, given the live graph? Resolves the subject→viewer
 * type(s) and checks legacy broadcast / per-person / type-scoping — AND not-restricted / not-flagged.
 */
export function scopeGrants(
  fact: Pick<
    InsightFact,
    'shareable' | 'shareableWith' | 'shareableTypes' | 'restricted' | 'flaggedInaccurate'
  >,
  subjectId: string,
  viewerId: string,
  relationships: Relationship[],
): boolean {
  return factSharedWithViewer(
    fact,
    viewerId,
    relationshipTypesFromSubjectToViewer(subjectId, viewerId, relationships),
  );
}

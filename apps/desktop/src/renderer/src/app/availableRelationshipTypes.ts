import type { Relationship, RelationshipType } from '@shared/schemas';
// The inverse map lives in the crypto-free `@selfos/core/sharing` (the single source of truth), so the
// renderer imports it without pulling the host-only `@selfos/core/people` barrel (42 §5.1).
import { INVERSE_RELATIONSHIP_TYPE as INVERSE } from '@selfos/core/sharing';

/**
 * The relationship types present FROM the active person TO anyone in their graph — the types the sharing
 * picker should offer (42 §3.1 / 43 §5 / 44 §3.4). Undefined (the picker's full-set default) when they have
 * no relationships yet. Shared by the onboarding form, the Memory dashboard, and the transparency surface.
 */
export function availableRelationshipTypesFor(
  personId: string | null,
  relationships: Relationship[],
): RelationshipType[] | undefined {
  if (!personId) return undefined;
  const types = new Set<RelationshipType>();
  for (const edge of relationships) {
    if (edge.fromPersonId === personId) types.add(edge.type);
    else if (edge.toPersonId === personId) types.add(INVERSE[edge.type]);
  }
  return types.size > 0 ? [...types] : undefined;
}

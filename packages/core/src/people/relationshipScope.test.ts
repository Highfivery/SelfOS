import { describe, expect, it } from 'vitest';
import type { InsightFact, Relationship, RelationshipType } from '../schemas';
import { relationshipTypesFromSubjectToViewer, scopeGrants } from './relationshipScope';

let seq = 0;
function edge(from: string, to: string, type: RelationshipType): Relationship {
  seq += 1;
  return {
    id: `r${seq}`,
    schemaVersion: 2,
    fromPersonId: from,
    toPersonId: to,
    type,
    createdAt: '2026-06-23T00:00:00.000Z',
    updatedAt: '2026-06-23T00:00:00.000Z',
  };
}

function fact(over: Partial<InsightFact> = {}): InsightFact {
  return { id: 'f1', text: 'a fact', shareable: false, ...over };
}

describe('relationshipTypesFromSubjectToViewer (42 §5.1)', () => {
  it('direct edge subject→viewer returns the edge type (the viewer is the subject’s ___)', () => {
    const rels = [edge('A', 'B', 'partner')];
    expect(relationshipTypesFromSubjectToViewer('A', 'B', rels)).toEqual(['partner']);
  });

  it('inverse-derived: a viewer→subject edge yields the inverse type (parent↔child)', () => {
    // Edge "B is A's parent" (from A, to B, type parent) — so from B's perspective A is B's child.
    const rels = [edge('A', 'B', 'parent')];
    expect(relationshipTypesFromSubjectToViewer('A', 'B', rels)).toEqual(['parent']);
    // Resolve from the OTHER direction: how does B relate to A? B is A's parent → A is B's child.
    expect(relationshipTypesFromSubjectToViewer('B', 'A', rels)).toEqual(['child']);
  });

  it('symmetric types invert to themselves', () => {
    const rels = [edge('A', 'B', 'sibling')];
    expect(relationshipTypesFromSubjectToViewer('B', 'A', rels)).toEqual(['sibling']);
  });

  it('multi-edge: a pair with several edges returns all (de-duped) matching types', () => {
    const rels = [edge('A', 'B', 'partner'), edge('B', 'A', 'coworker'), edge('A', 'B', 'partner')];
    const types = relationshipTypesFromSubjectToViewer('A', 'B', rels).sort();
    expect(types).toEqual(['coworker', 'partner']);
  });

  it('unrelated pair → empty', () => {
    const rels = [edge('A', 'C', 'partner')];
    expect(relationshipTypesFromSubjectToViewer('A', 'B', rels)).toEqual([]);
  });
});

describe('scopeGrants truth table (42 §5.1)', () => {
  // A owns the fact; B is the viewer. A→B is partner.
  const partner = [edge('A', 'B', 'partner')];

  it('type-scoped to a matching type → granted', () => {
    expect(scopeGrants(fact({ shareableTypes: ['partner'] }), 'A', 'B', partner)).toBe(true);
  });

  it('type-scoped to a NON-matching type → denied (the common safe case)', () => {
    expect(scopeGrants(fact({ shareableTypes: ['sibling'] }), 'A', 'B', partner)).toBe(false);
  });

  it('legacy broadcast shareable:true → granted to any related viewer', () => {
    expect(scopeGrants(fact({ shareable: true }), 'A', 'B', partner)).toBe(true);
  });

  it('per-person shareableWith the viewer → granted regardless of type', () => {
    expect(scopeGrants(fact({ shareableWith: ['B'] }), 'A', 'B', [])).toBe(true);
  });

  it('a RESTRICTED fact is excluded even when type-scoped (restricted wins, §8)', () => {
    expect(
      scopeGrants(fact({ restricted: true, shareableTypes: ['partner'] }), 'A', 'B', partner),
    ).toBe(false);
  });

  it('a FLAGGED-inaccurate fact is excluded regardless of scope', () => {
    expect(
      scopeGrants(
        fact({ flaggedInaccurate: true, shareableTypes: ['partner'] }),
        'A',
        'B',
        partner,
      ),
    ).toBe(false);
  });

  it('a private fact (no sharing set) → denied', () => {
    expect(scopeGrants(fact(), 'A', 'B', partner)).toBe(false);
  });

  it('removing the relationship re-gates at read: a partner-scoped fact no longer reaches B', () => {
    expect(scopeGrants(fact({ shareableTypes: ['partner'] }), 'A', 'B', [])).toBe(false);
  });

  it('changing the type re-gates: A↔B is now coworker, a partner-scoped fact is denied', () => {
    const coworker = [edge('A', 'B', 'coworker')];
    expect(scopeGrants(fact({ shareableTypes: ['partner'] }), 'A', 'B', coworker)).toBe(false);
  });
});

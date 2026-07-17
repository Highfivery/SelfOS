import { describe, expect, it } from 'vitest';
import { RelationshipTypeSchema } from './schemas';
import {
  confidentialityPreamble,
  describeScope,
  INVERSE_RELATIONSHIP_TYPE,
  RELATIONSHIP_TYPE_LABELS,
  RELATIONSHIP_TYPE_ORDER,
} from './sharing';

describe('relationship-type maps stay complete + consistent (04 §4.2 / 42 §5.1)', () => {
  const all = RelationshipTypeSchema.options;

  it('labels, order, and the inverse map each cover every enum member exactly once', () => {
    expect(Object.keys(RELATIONSHIP_TYPE_LABELS).sort()).toEqual([...all].sort());
    expect([...RELATIONSHIP_TYPE_ORDER].sort()).toEqual([...all].sort());
    expect(Object.keys(INVERSE_RELATIONSHIP_TYPE).sort()).toEqual([...all].sort());
  });

  it('the inverse map is an involution — inverting twice returns the original type', () => {
    for (const type of all) {
      expect(INVERSE_RELATIONSHIP_TYPE[INVERSE_RELATIONSHIP_TYPE[type]]).toBe(type);
    }
  });

  it('generational/asymmetric types invert to their reciprocal (gender-neutral)', () => {
    expect(INVERSE_RELATIONSHIP_TYPE.grandparent).toBe('grandchild');
    expect(INVERSE_RELATIONSHIP_TYPE.greatGrandparent).toBe('greatGrandchild');
    expect(INVERSE_RELATIONSHIP_TYPE.stepParent).toBe('stepChild');
    expect(INVERSE_RELATIONSHIP_TYPE.parentInLaw).toBe('childInLaw');
    expect(INVERSE_RELATIONSHIP_TYPE.auntUncle).toBe('nieceNephew');
    expect(INVERSE_RELATIONSHIP_TYPE.guardian).toBe('ward');
    expect(INVERSE_RELATIONSHIP_TYPE.mentor).toBe('mentee');
  });

  it('symmetric types invert to themselves', () => {
    for (const type of [
      'cousin',
      'siblingInLaw',
      'stepSibling',
      'halfSibling',
      'roommate',
    ] as const) {
      expect(INVERSE_RELATIONSHIP_TYPE[type]).toBe(type);
    }
  });
});

describe('describeScope (42 §3.2)', () => {
  it('empty scope → Private', () => {
    expect(describeScope([])).toBe('Private');
  });

  it('one type → its label', () => {
    expect(describeScope(['partner'])).toBe('Partner');
  });

  it('multiple types → joined in stable display order, de-duped', () => {
    expect(describeScope(['friend', 'partner', 'partner'])).toBe('Partner, Friend');
  });

  it('a scope covering every type reads concisely, not every label (keeps the chip compact)', () => {
    expect(describeScope(RELATIONSHIP_TYPE_ORDER)).toBe('everyone you relate to');
  });
});

describe('confidentialityPreamble (42 §3.4)', () => {
  it('names the supported person and forbids quoting/attributing/revealing', () => {
    const text = confidentialityPreamble('Bri');
    expect(text).toContain('Bri');
    expect(text).toMatch(/never quote them/i);
    expect(text).toMatch(/name who shared them/i);
    expect(text).toMatch(/don't share/i);
  });

  it('falls back to a neutral name when none is given', () => {
    expect(confidentialityPreamble('')).toContain('this person');
  });
});

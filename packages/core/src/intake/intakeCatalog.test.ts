import { describe, expect, it } from 'vitest';
import { PERSON_FIELD_KEYS } from '../schemas';
import {
  INTAKE_CATALOG,
  buildInterviewerAddendum,
  getIntakeSection,
  intakeSectionMeta,
} from './intakeCatalog';

describe('intakeCatalog', () => {
  it('has the 10 specced sections with the restricted/adult flags', () => {
    expect(INTAKE_CATALOG).toHaveLength(10);
    expect(getIntakeSection('weighs')?.restricted).toBe(true);
    expect(getIntakeSection('intimacy')?.restricted).toBe(true);
    expect(getIntakeSection('intimacy')?.adult).toBe(true);
    expect(getIntakeSection('basics')?.restricted).toBe(false);
    // The only adult-gated section is intimacy.
    expect(INTAKE_CATALOG.filter((s) => s.adult).map((s) => s.id)).toEqual(['intimacy']);
  });

  it('every direct-field key is a real Person field key', () => {
    const valid = new Set<string>(PERSON_FIELD_KEYS);
    for (const section of INTAKE_CATALOG)
      for (const field of section.directFields) expect(valid.has(field.key)).toBe(true);
  });

  it('marks healthNotes as a private (own-context-only) direct field', () => {
    const health = getIntakeSection('health');
    expect(health?.directFields.find((f) => f.key === 'healthNotes')?.private).toBe(true);
  });

  it('exposes renderer meta with the static opener but no internal focus/fields', () => {
    const meta = intakeSectionMeta();
    expect(meta).toHaveLength(10);
    const basics = meta.find((m) => m.id === 'basics');
    expect(basics?.opener.length).toBeGreaterThan(0);
    expect(basics).not.toHaveProperty('focus');
    expect(meta.find((m) => m.id === 'health')?.contentNote).toBeTruthy();
  });

  it('builds an interviewer addendum that teaches the field marker only when the section has direct fields', () => {
    const basics = buildInterviewerAddendum('Sam', getIntakeSection('basics')!);
    expect(basics).toContain('SELFOS:FIELD');
    expect(basics).toContain('Sam');
    const story = buildInterviewerAddendum('Sam', getIntakeSection('story')!);
    expect(story).not.toContain('SELFOS:FIELD');
    // Restricted sections carry the trauma-informed clause.
    expect(buildInterviewerAddendum('Sam', getIntakeSection('weighs')!)).toContain('sensitive');
  });
});

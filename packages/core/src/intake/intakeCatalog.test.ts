import { describe, expect, it } from 'vitest';
import { PERSON_FIELD_KEYS } from '../schemas';
import {
  INTAKE_CATALOG,
  buildInterviewerAddendum,
  getIntakeSection,
  intakeSectionMeta,
} from './intakeCatalog';

describe('intakeCatalog', () => {
  it('has the 10 sections with the right tier/restricted/adult flags', () => {
    expect(INTAKE_CATALOG).toHaveLength(10);
    expect(getIntakeSection('weighs')?.restricted).toBe(true);
    expect(getIntakeSection('intimacy')?.restricted).toBe(true);
    expect(getIntakeSection('intimacy')?.adult).toBe(true);
    expect(getIntakeSection('basics')?.restricted).toBe(false);
    // The only adult-gated section is intimacy.
    expect(INTAKE_CATALOG.filter((s) => s.adult).map((s) => s.id)).toEqual(['intimacy']);
    // A short core gates first-run; everything else is invited (§14.2).
    expect(INTAKE_CATALOG.filter((s) => s.tier === 'core').map((s) => s.id)).toEqual([
      'basics',
      'life-now',
      'values',
      'want',
    ]);
    expect(getIntakeSection('intimacy')?.tier).toBe('invited');
  });

  it('every form question maps to a real Person field key', () => {
    const valid = new Set<string>(PERSON_FIELD_KEYS);
    for (const section of INTAKE_CATALOG) {
      for (const m of section.questions ?? []) {
        if (m.field) expect(valid.has(m.field)).toBe(true);
      }
    }
  });

  it('form sections carry questions; chat sections carry a focus', () => {
    expect(getIntakeSection('basics')?.mode).toBe('form');
    expect(getIntakeSection('basics')?.questions?.length ?? 0).toBeGreaterThan(0);
    expect(getIntakeSection('family')?.mode).toBe('chat');
    expect(getIntakeSection('family')?.questions).toBeUndefined();
    expect(getIntakeSection('family')?.focus?.length ?? 0).toBeGreaterThan(0);
  });

  it('maps healthNotes + the sensitive orientation/style fields as private (own-context-only)', () => {
    const health = getIntakeSection('health');
    expect(health?.questions?.find((m) => m.field === 'healthNotes')?.private).toBe(true);
    const intimacy = getIntakeSection('intimacy');
    expect(intimacy?.questions?.find((m) => m.field === 'sexualOrientation')?.private).toBe(true);
    expect(intimacy?.questions?.find((m) => m.field === 'relationshipStyle')?.private).toBe(true);
  });

  it('every intimacy answer is restricted or a private field (no sensitive answer leaks unrestricted)', () => {
    const intimacy = getIntakeSection('intimacy');
    for (const m of intimacy?.questions ?? []) {
      const guarded = m.restricted === true || (m.field !== undefined && m.private === true);
      // The only allowed exception is the non-identifying safeword shortcut, which carries no content.
      if (m.q.id === 'safeword') continue;
      expect(guarded, `intimacy question ${m.q.id} must be restricted or a private field`).toBe(
        true,
      );
    }
  });

  it('every branch trigger references an EARLIER question in the same section (discrete answer)', () => {
    for (const section of INTAKE_CATALOG) {
      const ids = (section.questions ?? []).map((m) => m.q.id);
      (section.questions ?? []).forEach((m, i) => {
        const trigger = m.q.branch?.whenQuestionId;
        if (!trigger) return;
        const triggerIndex = ids.indexOf(trigger);
        expect(triggerIndex, `${m.q.id} branches on unknown ${trigger}`).toBeGreaterThanOrEqual(0);
        expect(triggerIndex, `${m.q.id} branches on a later/self question`).toBeLessThan(i);
      });
    }
  });

  it('exposes renderer meta with tier/mode/questions but no host-only field mapping', () => {
    const meta = intakeSectionMeta();
    expect(meta).toHaveLength(10);
    const basics = meta.find((m) => m.id === 'basics');
    expect(basics?.tier).toBe('core');
    expect(basics?.mode).toBe('form');
    expect(basics?.questions?.length ?? 0).toBeGreaterThan(0);
    // The renderer gets plain `Question`s — never the field/restricted mapping.
    expect(basics?.questions?.[0]).not.toHaveProperty('field');
    expect(meta.find((m) => m.id === 'health')?.contentNote).toBeTruthy();
  });

  it('builds a trauma-informed interviewer addendum for restricted chat sections', () => {
    const addendum = buildInterviewerAddendum('Sam', getIntakeSection('weighs')!);
    expect(addendum).toContain('Sam');
    expect(addendum).toContain('sensitive');
    expect(getIntakeSection('family')?.focus).toBeTruthy();
  });
});

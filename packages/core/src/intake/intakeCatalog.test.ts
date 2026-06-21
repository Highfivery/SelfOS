import { describe, expect, it } from 'vitest';
import { PERSON_FIELD_KEYS } from '../schemas';
import {
  INTAKE_CATALOG,
  buildInterviewerAddendum,
  getIntakeSection,
  intakeSectionMeta,
} from './intakeCatalog';

describe('intakeCatalog', () => {
  it('has the 12 sections with the right tier/restricted/adult flags', () => {
    expect(INTAKE_CATALOG).toHaveLength(12);
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

  it('stays lean — the non-intimacy catalog cannot silently re-bloat (26 §10 anti-rebloat guard)', () => {
    // The 2026-06-21 redesign cut the non-intimacy bank ~392 → 126. Guard the band so a future edit that
    // re-adds dozens of overlapping questions fails the gate instead of slipping through (CLAUDE.md §7).
    const count = (id: string): number => getIntakeSection(id)?.questions?.length ?? 0;
    const nonIntimacy = INTAKE_CATALOG.filter((s) => s.id !== 'intimacy').reduce(
      (n, s) => n + (s.questions?.length ?? 0),
      0,
    );
    expect(nonIntimacy).toBeGreaterThan(90); // enough to be a useful picture
    expect(nonIntimacy).toBeLessThanOrEqual(150); // …but not a 400-question wall
    // The core gate stays short (it blocks first-run).
    const coreGate = count('basics') + count('life-now') + count('values') + count('want');
    expect(coreGate).toBeLessThanOrEqual(30);
  });

  it('the intimacy block is rebalanced — in band, with the two 3-state matrices (27)', () => {
    const intimacy = getIntakeSection('intimacy');
    const qs = intimacy?.questions ?? [];
    // Rebalanced 100 → ~58–65; guard the band so it can't silently re-bloat or be gutted.
    expect(qs.length).toBeGreaterThan(45);
    expect(qs.length).toBeLessThanOrEqual(70);
    // The activity + toys lists are collapsed into 3-point LABELLED matrices (min/mid/max all set), not the
    // old into-it / curious / hard-limits triple checklist.
    const matrices = qs.filter((m) => m.q.type === 'matrix');
    expect(matrices.map((m) => m.q.id).sort()).toEqual(['activities', 'toys']);
    for (const m of matrices) {
      const mx = m.q.matrix;
      expect(mx).toBeTruthy();
      if (!mx) continue;
      expect(mx.max - mx.min).toBe(2); // exactly 3 points
      expect(Boolean(mx.minLabel && mx.midLabel && mx.maxLabel)).toBe(true); // 3 labels → labelled render
      expect(mx.rows.length).toBeGreaterThan(5); // a real inventory of rows
    }
  });

  it('every form question maps to a real Person field key', () => {
    const valid = new Set<string>(PERSON_FIELD_KEYS);
    for (const section of INTAKE_CATALOG) {
      for (const m of section.questions ?? []) {
        if (m.field) expect(valid.has(m.field)).toBe(true);
      }
    }
  });

  it('every section is a form with questions; the deep sections keep a focus for the go-deeper chat', () => {
    expect(getIntakeSection('basics')?.mode).toBe('form');
    expect(getIntakeSection('basics')?.questions?.length ?? 0).toBeGreaterThan(0);
    // The former chat sections are now forms with structured prompts...
    expect(getIntakeSection('family')?.mode).toBe('form');
    expect(getIntakeSection('family')?.questions?.length ?? 0).toBeGreaterThan(0);
    // ...but keep a `focus` so the optional section-level "Tell me more →" chat stays well-guided.
    expect(getIntakeSection('family')?.focus?.length ?? 0).toBeGreaterThan(0);
    expect(getIntakeSection('story')?.mode).toBe('form');
    expect(getIntakeSection('weighs')?.mode).toBe('form');
    expect(INTAKE_CATALOG.every((s) => s.mode === 'form')).toBe(true);
  });

  it('maps healthNotes + the sensitive orientation/style fields as private (own-context-only)', () => {
    const health = getIntakeSection('health');
    expect(health?.questions?.find((m) => m.field === 'healthNotes')?.private).toBe(true);
    const intimacy = getIntakeSection('intimacy');
    expect(intimacy?.questions?.find((m) => m.field === 'sexualOrientation')?.private).toBe(true);
    expect(intimacy?.questions?.find((m) => m.field === 'relationshipStyle')?.private).toBe(true);
  });

  it('EVERY intimacy answer is restricted or a private field (no sensitive answer leaks unrestricted)', () => {
    const intimacy = getIntakeSection('intimacy');
    for (const m of intimacy?.questions ?? []) {
      const guarded = m.restricted === true || (m.field !== undefined && m.private === true);
      expect(guarded, `intimacy question ${m.q.id} must be restricted or a private field`).toBe(
        true,
      );
    }
  });

  it('every section has unique question ids (answers are keyed by id)', () => {
    for (const section of INTAKE_CATALOG) {
      const ids = (section.questions ?? []).map((m) => m.q.id);
      expect(new Set(ids).size, `duplicate question id in section ${section.id}`).toBe(ids.length);
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
    expect(meta).toHaveLength(12);
    const basics = meta.find((m) => m.id === 'basics');
    expect(basics?.tier).toBe('core');
    expect(basics?.mode).toBe('form');
    expect(basics?.questions?.length ?? 0).toBeGreaterThan(0);
    // The renderer gets plain `Question`s — never the field/restricted mapping.
    expect(basics?.questions?.[0]).not.toHaveProperty('field');
    expect(meta.find((m) => m.id === 'health')?.contentNote).toBeTruthy();
  });

  it('builds a trauma-informed interviewer addendum for the go-deeper chat on restricted sections', () => {
    const addendum = buildInterviewerAddendum('Sam', getIntakeSection('weighs')!);
    expect(addendum).toContain('Sam');
    expect(addendum).toContain('sensitive');
    expect(getIntakeSection('family')?.focus).toBeTruthy();
  });

  it('EVERY free-text input has a non-empty placeholder (shortText / longText + roster text columns)', () => {
    const missing: string[] = [];
    for (const section of INTAKE_CATALOG) {
      for (const m of section.questions ?? []) {
        if (m.q.type === 'shortText' || m.q.type === 'longText') {
          if (!m.q.placeholder || m.q.placeholder.trim() === '')
            missing.push(`${section.id}.${m.q.id}`);
        }
        // A roster's free-text columns must also carry a placeholder (selects don't need one).
        for (const col of m.q.roster ?? []) {
          if (col.type === 'text' && (!col.placeholder || col.placeholder.trim() === ''))
            missing.push(`${section.id}.${m.q.id}.${col.key}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

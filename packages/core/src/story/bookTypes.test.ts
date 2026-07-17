import { describe, expect, it } from 'vitest';
import { BookStyleSchema } from '../schemas';
import {
  BOOK_TYPES,
  BIOGRAPHY_BOOK_TYPE,
  MCADAMS_SCENES,
  getBookType,
  listBookTypes,
} from './bookTypes';

describe('BookType registry (64)', () => {
  it('registers exactly the biography type in v1', () => {
    expect(BOOK_TYPES.map((t) => t.id)).toEqual(['biography']);
    expect(getBookType('biography')).toBe(BIOGRAPHY_BOOK_TYPE);
    expect(listBookTypes()).toBe(BOOK_TYPES);
  });

  it('returns undefined for an unknown type (never throws)', () => {
    expect(getBookType('erotica')).toBeUndefined();
  });

  it('the biography is not adult-gated (own private data)', () => {
    expect(BIOGRAPHY_BOOK_TYPE.gates.adult).toBe(false);
  });

  it('has exactly one default structure template', () => {
    const defaults = BIOGRAPHY_BOOK_TYPE.structures.filter((s) => s.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.id).toBe('chronicle');
  });

  it('offers a style preset for every BookStyle, each with a directive', () => {
    const presetIds = BIOGRAPHY_BOOK_TYPE.stylePresets.map((p) => p.id).sort();
    expect(presetIds).toEqual([...BookStyleSchema.options].sort());
    for (const preset of BIOGRAPHY_BOOK_TYPE.stylePresets) {
      expect(preset.directive.length).toBeGreaterThan(0);
    }
  });

  it('carries the eight McAdams key scenes with unique keys', () => {
    expect(MCADAMS_SCENES).toHaveLength(8);
    const keys = MCADAMS_SCENES.map((s) => s.key);
    expect(new Set(keys).size).toBe(8);
    expect(keys).toContain('highPoint');
    expect(keys).toContain('lowPoint');
    expect(keys).toContain('turningPoint');
    for (const scene of MCADAMS_SCENES) {
      expect(scene.prompt.length).toBeGreaterThan(0);
      expect(scene.label.length).toBeGreaterThan(0);
    }
    expect(BIOGRAPHY_BOOK_TYPE.interview.scenes).toBe(MCADAMS_SCENES);
  });

  it('the interview framework has categories and a six-step deepening ladder', () => {
    expect(BIOGRAPHY_BOOK_TYPE.interview.categories.length).toBeGreaterThanOrEqual(5);
    expect(BIOGRAPHY_BOOK_TYPE.interview.deepeningLadder).toHaveLength(6);
    for (const cat of BIOGRAPHY_BOOK_TYPE.interview.categories) {
      expect(cat.examplePrompts.length).toBeGreaterThan(0);
    }
    expect(BIOGRAPHY_BOOK_TYPE.interview.framing).toMatch(/no right or wrong answers/i);
  });

  it('every style preset carries a first- and third-person specimen (§13.3 live preview)', () => {
    for (const type of BOOK_TYPES) {
      for (const preset of type.stylePresets) {
        expect(preset.specimen.first.trim().length).toBeGreaterThan(0);
        expect(preset.specimen.third.trim().length).toBeGreaterThan(0);
        // The two voices genuinely differ (so switching voice actually re-renders the preview).
        expect(preset.specimen.first).not.toBe(preset.specimen.third);
      }
    }
  });

  it('the doctrine states the load-bearing craft rules and forbids the AI-prose tells', () => {
    const d = BIOGRAPHY_BOOK_TYPE.doctrine.toLowerCase();
    // Craft anchors
    expect(d).toContain('scene');
    expect(d).toContain('never invent');
    expect(d).toContain('portrait, not autopsy');
    // Safety: no clinical labels in prose (spec-51 invariant carried into the doctrine)
    expect(d).toMatch(/never name instruments, scores, bands, or diagnoses/);
    // The banned-tell inventory is present (so the model is told what NOT to write)
    expect(d).toContain('tapestry');
    expect(d).toContain('delve');
    expect(d).toContain('not just x, but y');
    expect(d).toContain('i learned that');
  });
});

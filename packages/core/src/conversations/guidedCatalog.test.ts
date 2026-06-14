import { describe, expect, it } from 'vitest';
import {
  GUIDED_CATALOG,
  GUIDED_GROUPS,
  getExercise,
  guidedGroupTitle,
  listExercises,
} from './guidedCatalog';

describe('guidedCatalog integrity', () => {
  it('has unique ids', () => {
    const ids = GUIDED_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every exercise belongs to a known group', () => {
    const groups = new Set(GUIDED_GROUPS.map((g) => g.id));
    for (const e of GUIDED_CATALOG) expect(groups.has(e.group)).toBe(true);
  });

  it('structured exercises declare steps; chats do not', () => {
    for (const e of GUIDED_CATALOG) {
      if (e.kind === 'structured') {
        expect(e.steps && e.steps.length > 0).toBe(true);
      } else {
        expect(e.steps).toBeUndefined();
      }
    }
  });

  it('the structured set is exactly the four resolved exercises (16 §11.2)', () => {
    const structured = GUIDED_CATALOG.filter((e) => e.kind === 'structured').map((e) => e.id);
    expect(structured.sort()).toEqual(
      ['cbt-thought-record', 'decision-clarifier', 'grow-goal-setting', 'weekly-review'].sort(),
    );
  });

  it('only intimacy exercises are adult-gated', () => {
    for (const e of GUIDED_CATALOG) {
      expect(Boolean(e.adult)).toBe(e.group === 'intimacy');
    }
  });

  it('every exercise has a static opener + a steering addendum that frames it as not-therapy', () => {
    for (const e of GUIDED_CATALOG) {
      expect(e.openingMessage.trim().length).toBeGreaterThan(0);
      expect(e.systemPromptAddendum).toMatch(/not therapy|NOT therapy/i);
    }
  });

  it('getExercise resolves known ids and returns undefined for unknown ones', () => {
    expect(getExercise('cbt-thought-record')?.title).toBe('Thought Record');
    expect(getExercise('nope')).toBeUndefined();
  });

  it('guidedGroupTitle maps ids to the non-clinical display titles', () => {
    expect(guidedGroupTitle('therapy')).toBe('Reflective & therapy-informed');
    expect(guidedGroupTitle('coaching')).toBe('Coaching');
    expect(guidedGroupTitle('intimacy')).toBe('Intimacy & connection');
  });

  it('listExercises returns the full catalog', () => {
    expect(listExercises().length).toBe(GUIDED_CATALOG.length);
  });
});

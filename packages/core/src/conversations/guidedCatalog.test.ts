import { describe, expect, it } from 'vitest';
import {
  GUIDED_CATALOG,
  GUIDED_GROUPS,
  getExercise,
  guideLifeAreas,
  guidedGroupTitle,
  listExercises,
} from './guidedCatalog';

// The new (48) explicit intimacy entries — the set that must state the consensual-adult boundary in-prompt.
const EXPLICIT_INTIMACY_IDS = [
  'fantasy-exploration',
  'kink-power-exchange',
  'dirty-talk-practice',
  'yes-no-maybe-builder',
  'sexual-shame',
  'exploring-an-act',
  'mismatched-libido',
  'sexting-long-distance',
  'edging-mindful-arousal',
  'aftercare-checkins',
];

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

  it('the structured set is exactly the resolved exercises (16 §11.2 + 48 §5.2)', () => {
    // 48 adds the structured Yes/No/Maybe builder to the four from 16 §11.2.
    const structured = GUIDED_CATALOG.filter((e) => e.kind === 'structured').map((e) => e.id);
    expect(structured.sort()).toEqual(
      [
        'cbt-thought-record',
        'decision-clarifier',
        'grow-goal-setting',
        'weekly-review',
        'yes-no-maybe-builder',
      ].sort(),
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

  // 48-intimacy-guided-sessions: the expanded Intimacy & connection group.
  it('the expanded intimacy group resolves every new entry, all 18+-gated (48 §3.5)', () => {
    const newIntimacyIds = [
      // relational
      'reigniting-the-spark',
      'repair-after-rupture',
      'love-maps',
      'bids-and-appreciation',
      'non-monogamy-agreements',
      'feeling-desirable',
      'intimacy-after-change',
      // explicit
      ...EXPLICIT_INTIMACY_IDS,
    ];
    for (const id of newIntimacyIds) {
      const e = getExercise(id);
      expect(e, id).toBeDefined();
      expect(e?.group).toBe('intimacy');
      expect(e?.adult).toBe(true);
    }
  });

  it('the explicit intimacy entries state the consensual-adult boundary (48 §8.3)', () => {
    // Every explicit addendum must state the boundary in-prompt (§8.3): consensual adults, no minors/
    // real non-consent/illegal acts. Tested on the new explicit set (the existing 3 are non-explicit).
    for (const id of EXPLICIT_INTIMACY_IDS) {
      const addendum = getExercise(id)?.systemPromptAddendum ?? '';
      expect(addendum, id).toMatch(/consensual[- ]adult/i);
      expect(addendum, id).toMatch(/Anthropic's usage policy/);
    }
  });

  it('the Yes/No/Maybe builder is structured with category steps (48 §5.2)', () => {
    const builder = getExercise('yes-no-maybe-builder');
    expect(builder?.kind).toBe('structured');
    expect(builder?.steps?.length).toBeGreaterThan(2);
    expect(builder?.steps).toContain('Review the list');
  });

  it('guidedGroupTitle maps ids to the non-clinical display titles', () => {
    expect(guidedGroupTitle('therapy')).toBe('Reflective & therapy-informed');
    expect(guidedGroupTitle('coaching')).toBe('Coaching');
    expect(guidedGroupTitle('family')).toBe('Family & relationships');
    expect(guidedGroupTitle('intimacy')).toBe('Intimacy & connection');
  });

  it('offers a Family & relationships group — family-dynamics chats, never adult-gated (expansion)', () => {
    expect(GUIDED_GROUPS.map((g) => g.id)).toContain('family');
    const family = listExercises().filter((e) => e.group === 'family');
    expect(family.length).toBeGreaterThanOrEqual(10);
    // Family sessions are NOT in the 18+ intimacy group → never adult-gated (the catalog invariant holds).
    expect(family.every((e) => !e.adult && e.kind === 'chat')).toBe(true);
    // They foreground the Family life-area for portrait-fact selection.
    expect(guideLifeAreas('family')).toContain('Family');
  });

  it('the reflective and coaching groups each offer a fuller set (~12) (expansion)', () => {
    const all = listExercises();
    expect(all.filter((e) => e.group === 'therapy').length).toBeGreaterThanOrEqual(12);
    expect(all.filter((e) => e.group === 'coaching').length).toBeGreaterThanOrEqual(12);
  });

  it('listExercises returns the full catalog', () => {
    expect(listExercises().length).toBe(GUIDED_CATALOG.length);
  });
});

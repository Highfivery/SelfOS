import { describe, expect, it } from 'vitest';
import { matrixRowKey, matrixRowLabel } from '../schemas';
import { INTIMACY_ACTIVITIES } from './topics';
import {
  ACTIVITY_POINT_LABELS,
  INTIMACY_MATRIX_DYNAMICS,
  legacyKeyFor,
  migrateActivityMatrixValue,
  resolveIntakeActivityRows,
  slugifyActivity,
  type ActivityRowContext,
} from './activityRows';

const labels = (ctx: ActivityRowContext = {}): string[] =>
  resolveIntakeActivityRows(ctx).map(matrixRowLabel);
const keys = (ctx: ActivityRowContext = {}): string[] =>
  resolveIntakeActivityRows(ctx).map(matrixRowKey);
const hasLabel = (ctx: ActivityRowContext, label: string): boolean => labels(ctx).includes(label);
const hasKey = (ctx: ActivityRowContext, key: string): boolean => keys(ctx).includes(key);

const PENIS = 'Cock (penis)';
const VULVA = 'Pussy (vulva)';

describe('resolveIntakeActivityRows (46 anatomy-driven oral, never inferred)', () => {
  it("the report's straight man (own=penis, partner=vulva) → receiving blowjob + going-down giving, NO blowjob-giving", () => {
    const ctx = { ownAnatomy: PENIS, partnerAnatomy: [VULVA] };
    expect(hasLabel(ctx, 'Receiving oral (blowjob)')).toBe(true); // own penis → receives a blowjob
    expect(hasLabel(ctx, 'Going down on her (oral)')).toBe(true); // partner vulva → he goes down on her
    expect(hasLabel(ctx, 'Giving a blowjob')).toBe(false); // no partner has a penis → the #62 wrong row is gone
    expect(hasKey(ctx, 'oral-receiving')).toBe(true);
    expect(hasKey(ctx, 'oral-giving-vulva')).toBe(true);
    expect(hasKey(ctx, 'oral-giving-penis')).toBe(false);
    // Neutral labels are gone once anatomy resolves them.
    expect(hasLabel(ctx, 'Giving oral')).toBe(false);
    expect(hasLabel(ctx, 'Receiving oral')).toBe(false);
  });

  it('own=vulva, partner=penis → receiving going-down-on-you + blowjob giving only', () => {
    const ctx = { ownAnatomy: VULVA, partnerAnatomy: [PENIS] };
    expect(hasLabel(ctx, 'Receiving oral (going down on you)')).toBe(true);
    expect(hasLabel(ctx, 'Giving a blowjob')).toBe(true);
    expect(hasKey(ctx, 'oral-giving-penis')).toBe(true);
    expect(hasLabel(ctx, 'Going down on her (oral)')).toBe(false);
    expect(hasKey(ctx, 'oral-giving-vulva')).toBe(false);
  });

  it('partner = both anatomies → BOTH giving rows; order penis then vulva', () => {
    const giving = keys({ ownAnatomy: PENIS, partnerAnatomy: [PENIS, VULVA] }).filter((k) =>
      k.startsWith('oral-giving'),
    );
    expect(giving).toEqual(['oral-giving-penis', 'oral-giving-vulva']);
  });

  it('partner = "Don\'t mind" or empty → a single NEUTRAL giving row', () => {
    for (const partnerAnatomy of [["Don't mind"], [], undefined]) {
      const ctx = { ownAnatomy: PENIS, partnerAnatomy };
      expect(hasKey(ctx, 'oral-giving')).toBe(true);
      expect(hasLabel(ctx, 'Giving oral')).toBe(true);
      expect(hasKey(ctx, 'oral-giving-penis')).toBe(false);
      expect(hasKey(ctx, 'oral-giving-vulva')).toBe(false);
    }
  });

  it('REGRESSION (trans/nb erasure fixed): own=penis gets the blowjob receiving label, NOT a fallback', () => {
    // Gender is irrelevant to the resolver now — only anatomy. A trans woman who answers own=penis must get
    // the accurate label, which the pre-46 gender-inference model never did.
    const ctx = { ownAnatomy: PENIS, partnerAnatomy: [VULVA] };
    expect(hasLabel(ctx, 'Receiving oral (blowjob)')).toBe(true);
    expect(hasLabel(ctx, 'Receiving oral')).toBe(false); // not the generic fallback
  });

  it('"Both or intersex" / "Rather not say" / unset own anatomy → a neutral receiving label', () => {
    for (const ownAnatomy of ['Both or intersex', 'Rather not say', undefined]) {
      const ctx = { ownAnatomy, partnerAnatomy: [VULVA] };
      expect(hasLabel(ctx, 'Receiving oral')).toBe(true);
      expect(hasKey(ctx, 'oral-receiving')).toBe(true);
      expect(hasLabel(ctx, 'Receiving oral (blowjob)')).toBe(false);
      expect(hasLabel(ctx, 'Receiving oral (going down on you)')).toBe(false);
    }
  });

  it('orientation is decoupled — the resolver takes ONLY anatomy (no drawnTo/gender field)', () => {
    // Behaviourally, identical anatomy → identical rows regardless of orientation, because orientation is not
    // an input. Type-level proof below: gender is no longer part of the context.
    const a = resolveIntakeActivityRows({ ownAnatomy: PENIS, partnerAnatomy: [VULVA] });
    const b = resolveIntakeActivityRows({ ownAnatomy: PENIS, partnerAnatomy: [VULVA] });
    expect(a).toEqual(b);
    // @ts-expect-error — gender is no longer part of the context (46 decoupling).
    resolveIntakeActivityRows({ gender: 'Man' });
  });

  it('does NOT over-filter — every non-oral act stays universal, plus the two relationship dynamics', () => {
    const ctx = { ownAnatomy: PENIS, partnerAnatomy: [VULVA] };
    for (const act of [
      'Bondage',
      'Choking (giving)',
      'Fingering',
      'Vibrators / dildos',
      'Role-play',
      'Deepthroat',
    ]) {
      expect(hasLabel(ctx, act), act).toBe(true);
    }
    for (const dyn of INTIMACY_MATRIX_DYNAMICS) expect(hasLabel(ctx, dyn)).toBe(true);
  });

  it('the neutral default transforms the inventory oral rows + appends the dynamics, in order', () => {
    const nonOral = INTIMACY_ACTIVITIES.filter(
      (a) => a !== 'Oral (giving)' && a !== 'Oral (receiving)',
    );
    expect(labels()).toEqual([
      'Giving oral',
      'Receiving oral',
      ...nonOral,
      ...INTIMACY_MATRIX_DYNAMICS,
    ]);
  });

  it('exposes the 5-point feeling labels in order, with the boundary first', () => {
    expect(ACTIVITY_POINT_LABELS).toEqual([
      'Hard no',
      'Not interested',
      'Curious',
      'Like it',
      'Love it',
    ]);
  });
});

describe('stable keys (46 §4.2) — keys are anatomy-independent; only labels re-resolve', () => {
  it('the oral-receiving key is identical across different own anatomy; its label changes', () => {
    const a = resolveIntakeActivityRows({ ownAnatomy: PENIS, partnerAnatomy: [VULVA] });
    const b = resolveIntakeActivityRows({ ownAnatomy: VULVA, partnerAnatomy: [PENIS] });
    const recA = a.find((r) => matrixRowKey(r) === 'oral-receiving');
    const recB = b.find((r) => matrixRowKey(r) === 'oral-receiving');
    expect(recA && matrixRowLabel(recA)).toBe('Receiving oral (blowjob)');
    expect(recB && matrixRowLabel(recB)).toBe('Receiving oral (going down on you)');
    // Every universal (non-oral) key is present + identical in both resolutions.
    const universal = INTIMACY_ACTIVITIES.filter(
      (x) => x !== 'Oral (giving)' && x !== 'Oral (receiving)',
    ).map(slugifyActivity);
    for (const k of universal) {
      expect(
        a.some((r) => matrixRowKey(r) === k),
        k,
      ).toBe(true);
      expect(
        b.some((r) => matrixRowKey(r) === k),
        k,
      ).toBe(true);
    }
  });

  it('slugifyActivity is stable and deterministic', () => {
    expect(slugifyActivity('Anal (giving)')).toBe('anal-giving');
    expect(slugifyActivity('BDSM / dom-sub play')).toBe('bdsm-dom-sub-play');
    expect(slugifyActivity('Public / semi-public sex')).toBe('public-semi-public-sex');
    expect(slugifyActivity('Degradation / humiliation')).toBe('degradation-humiliation');
  });
});

describe('legacy carry-forward (46 §4.3)', () => {
  it('maps every pre-46 oral label + a universal label to its stable key', () => {
    expect(legacyKeyFor('Going down on her (oral)')).toBe('oral-giving-vulva');
    expect(legacyKeyFor('Giving a blowjob')).toBe('oral-giving-penis');
    expect(legacyKeyFor('Receiving oral (blowjob)')).toBe('oral-receiving');
    expect(legacyKeyFor('Receiving oral (going down on you)')).toBe('oral-receiving');
    expect(legacyKeyFor('Receiving oral')).toBe('oral-receiving');
    expect(legacyKeyFor('Giving oral')).toBe('oral-giving');
    expect(legacyKeyFor('Choking (giving)')).toBe('choking-giving');
    expect(legacyKeyFor('Degradation / humiliation')).toBe('degradation-humiliation');
    expect(legacyKeyFor('a totally unknown row')).toBeUndefined();
  });

  it('migrates a label-keyed value to stable keys; keeps an unmapped key verbatim', () => {
    const migrated = migrateActivityMatrixValue({
      'Going down on her (oral)': 5,
      'Receiving oral (blowjob)': 4,
      'Choking (giving)': 1,
      'some retired row': 3,
    });
    expect(migrated).toEqual({
      'oral-giving-vulva': 5,
      'oral-receiving': 4,
      'choking-giving': 1,
      'some retired row': 3, // preserved, never dropped (orphan-append)
    });
  });

  it('is idempotent — an already-stable value is unchanged', () => {
    const stable = { 'oral-receiving': 5, 'oral-giving-penis': 4, choking: 2, 'some orphan': 1 };
    expect(migrateActivityMatrixValue(stable)).toEqual(stable);
    expect(migrateActivityMatrixValue(migrateActivityMatrixValue(stable))).toEqual(stable);
  });

  it('a genuine stable rating wins over a legacy label mapping to the same key', () => {
    // Both 'oral-receiving' (stable, fresh) and 'Receiving oral' (legacy) present → keep the stable value.
    const migrated = migrateActivityMatrixValue({ 'oral-receiving': 5, 'Receiving oral': 2 });
    expect(migrated['oral-receiving']).toBe(5);
  });
});

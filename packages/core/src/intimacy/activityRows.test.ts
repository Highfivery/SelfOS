import { describe, expect, it } from 'vitest';
import { matrixRowKey, matrixRowLabel } from '../schemas';
import { INTIMACY_ACTIVITIES_FULL, orderedActivities } from './topics';
import {
  ACTIVITY_POINT_LABELS,
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
    const a = resolveIntakeActivityRows({ ownAnatomy: PENIS, partnerAnatomy: [VULVA] });
    const b = resolveIntakeActivityRows({ ownAnatomy: PENIS, partnerAnatomy: [VULVA] });
    expect(a).toEqual(b);
    // @ts-expect-error — gender is no longer part of the context (46 decoupling).
    resolveIntakeActivityRows({ gender: 'Man' });
  });

  it('does NOT over-filter — every non-oral act (incl. the folded-in dynamics) stays universal (49)', () => {
    const ctx = { ownAnatomy: PENIS, partnerAnatomy: [VULVA] };
    for (const act of [
      'Light bondage (cuffs / ties)',
      'Breath play / choking (giving)',
      'Fingering',
      'Vibrators',
      'General role-play',
      'Deepthroat',
      // The two relationship dynamics, now folded into the inventory as power-exchange entries (49 §11).
      'Degradation / humiliation',
      'Praise / worship',
    ]) {
      expect(hasLabel(ctx, act), act).toBe(true);
    }
  });

  it('the neutral default emits every inventory row in display order, oral rows resolved to neutral', () => {
    // The resolved rows are the ordered inventory with the two oral entries replaced by their neutral
    // resolution (one giving + one receiving), keyed by stable keys.
    const expected = orderedActivities().flatMap((act) => {
      if (act.key === 'oral-giving') return ['oral-giving'];
      if (act.key === 'oral-receiving') return ['oral-receiving'];
      return [act.key];
    });
    expect(keys()).toEqual(expected);
    // The first rows are the gentlest (sensual) category; the last are taboo-fantasy.
    expect(labels()[0]).toBe('Sensual massage');
    expect(hasLabel({}, 'Giving oral')).toBe(true);
    expect(hasLabel({}, 'Receiving oral')).toBe(true);
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
    // Every universal (non-oral) inventory key is present + identical in both resolutions.
    const universal = INTIMACY_ACTIVITIES_FULL.map((x) => x.key).filter(
      (k) => k !== 'oral-giving' && k !== 'oral-receiving',
    );
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

  it("an entry's row key is its inventory key, independent of its category (49 §7 re-categorization)", () => {
    // A rating follows the KEY, not the category — re-categorizing an entry would only change its group.
    for (const entry of INTIMACY_ACTIVITIES_FULL) {
      if (entry.key === 'oral-giving' || entry.key === 'oral-receiving') continue; // anatomy-resolved
      expect(hasKey({}, entry.key), entry.key).toBe(true);
    }
  });

  it('slugifyActivity is stable and deterministic', () => {
    expect(slugifyActivity('Anal (giving)')).toBe('anal-giving');
    expect(slugifyActivity('BDSM / dom-sub play')).toBe('bdsm-dom-sub-play');
    expect(slugifyActivity('Public / semi-public sex')).toBe('public-semi-public-sex');
    expect(slugifyActivity('Degradation / humiliation')).toBe('degradation-humiliation');
  });
});

describe('legacy carry-forward (46 §4.3, 49 §4.3)', () => {
  it('maps the pre-46 oral labels + a current inventory label to stable keys', () => {
    expect(legacyKeyFor('Going down on her (oral)')).toBe('oral-giving-vulva');
    expect(legacyKeyFor('Giving a blowjob')).toBe('oral-giving-penis');
    expect(legacyKeyFor('Receiving oral (blowjob)')).toBe('oral-receiving');
    expect(legacyKeyFor('Giving oral')).toBe('oral-giving');
    expect(legacyKeyFor('Oral (receiving)')).toBe('oral-receiving'); // pre-49 inventory base label
    expect(legacyKeyFor('Degradation / humiliation')).toBe('degradation-humiliation');
    expect(legacyKeyFor('Deepthroat')).toBe('deepthroat'); // a current label re-attaches to its key
    expect(legacyKeyFor('a totally unknown row')).toBeUndefined();
  });

  it('maps every PRE-49 split/renamed label (and its old slug) to the closest new stable key (49 §4.3)', () => {
    expect(legacyKeyFor('Bondage')).toBe('light-bondage-cuffs-ties');
    expect(legacyKeyFor('bondage')).toBe('light-bondage-cuffs-ties');
    expect(legacyKeyFor('Choking (giving)')).toBe('breath-play-choking-giving');
    expect(legacyKeyFor('choking-receiving')).toBe('breath-play-choking-receiving');
    expect(legacyKeyFor('BDSM / dom-sub play')).toBe('switching');
    expect(legacyKeyFor('Role-play')).toBe('general-role-play');
    expect(legacyKeyFor('Dirty talk')).toBe('light-dirty-talk');
    expect(legacyKeyFor('Vibrators / dildos')).toBe('vibrators');
    expect(legacyKeyFor('Butt plugs / anal toys')).toBe('anal-toys-butt-plugs');
    // Dedup (2026-06-26): 'Sensory deprivation (blindfold-only)' merged into 'Blindfolds' — old label + slug.
    expect(legacyKeyFor('Sensory deprivation (blindfold-only)')).toBe('blindfolds');
    expect(legacyKeyFor('sensory-deprivation-blindfold-only')).toBe('blindfolds');
    // 'Squirting' is intentionally unmapped — no close new entry → preserved verbatim (no data loss).
    expect(legacyKeyFor('Squirting')).toBeUndefined();
  });

  it('migrates a stored blindfold-only rating onto the kept Blindfolds row (no data loss)', () => {
    expect(migrateActivityMatrixValue({ 'sensory-deprivation-blindfold-only': 4 })).toEqual({
      blindfolds: 4,
    });
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
      'breath-play-choking-giving': 1,
      'some retired row': 3, // preserved, never dropped (orphan-append)
    });
  });

  it('carries a PRE-49 value (old labels + an unmappable Squirting) forward with no data loss', () => {
    const migrated = migrateActivityMatrixValue({
      Bondage: 3,
      'BDSM / dom-sub play': 4,
      Squirting: 5, // no close new entry → preserved verbatim
    });
    expect(migrated).toEqual({
      'light-bondage-cuffs-ties': 3,
      switching: 4,
      Squirting: 5,
    });
  });

  it('is idempotent — an already-stable value is unchanged', () => {
    const stable = { 'oral-receiving': 5, 'oral-giving-penis': 4, deepthroat: 2, 'some orphan': 1 };
    expect(migrateActivityMatrixValue(stable)).toEqual(stable);
    expect(migrateActivityMatrixValue(migrateActivityMatrixValue(stable))).toEqual(stable);
  });

  it('a genuine stable rating wins over a legacy label mapping to the same key', () => {
    const migrated = migrateActivityMatrixValue({ 'oral-receiving': 5, 'Receiving oral': 2 });
    expect(migrated['oral-receiving']).toBe(5);
  });
});

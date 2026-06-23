import { describe, expect, it } from 'vitest';
import { INTIMACY_ACTIVITIES } from './topics';
import {
  ACTIVITY_POINT_LABELS,
  INTIMACY_MATRIX_DYNAMICS,
  resolveIntakeActivityRows,
} from './activityRows';

const has = (rows: string[], label: string): boolean => rows.includes(label);

describe('resolveIntakeActivityRows (27 §4.2 gender/orientation-aware oral)', () => {
  it('a straight man sees the cunnilingus-giving + receiving-blowjob rows, NEVER "give a blowjob"', () => {
    const rows = resolveIntakeActivityRows({ gender: 'Man', drawnTo: ['Women'] });
    expect(has(rows, 'Going down on her (oral)')).toBe(true); // gives oral to a vulva-haver
    expect(has(rows, 'Receiving oral (blowjob)')).toBe(true); // receives on his own penis
    expect(has(rows, 'Giving a blowjob')).toBe(false); // never giving oral to a penis
    // The neutral oral labels are gone once tailored.
    expect(has(rows, 'Giving oral')).toBe(false);
    expect(has(rows, 'Receiving oral')).toBe(false);
  });

  it('a straight woman sees the blowjob-giving + receiving-cunnilingus rows, NEVER cunnilingus-giving', () => {
    const rows = resolveIntakeActivityRows({ gender: 'Woman', drawnTo: ['Men'] });
    expect(has(rows, 'Giving a blowjob')).toBe(true);
    expect(has(rows, 'Receiving oral (going down on you)')).toBe(true);
    expect(has(rows, 'Going down on her (oral)')).toBe(false);
  });

  it('a bisexual person sees BOTH giving-oral variants', () => {
    const rows = resolveIntakeActivityRows({ gender: 'Man', drawnTo: ['Men', 'Women'] });
    expect(has(rows, 'Giving a blowjob')).toBe(true);
    expect(has(rows, 'Going down on her (oral)')).toBe(true);
    expect(has(rows, 'Receiving oral (blowjob)')).toBe(true); // own anatomy still tailors receiving
  });

  it('a gay man sees blowjob-giving + receiving-blowjob (both penis), never cunnilingus', () => {
    const rows = resolveIntakeActivityRows({ gender: 'Man', drawnTo: ['Men'] });
    expect(has(rows, 'Giving a blowjob')).toBe(true);
    expect(has(rows, 'Receiving oral (blowjob)')).toBe(true);
    expect(has(rows, 'Going down on her (oral)')).toBe(false);
  });

  it('never assumes on uncertainty — non-binary, "Everyone", trans, "Other", or empty → full neutral list', () => {
    for (const ctx of [
      { gender: 'Non-binary', drawnTo: ['Women'] },
      { gender: 'Prefer not to say', drawnTo: ['Men'] },
      { gender: 'Other', drawnTo: ['Men'] },
      { gender: 'Man', drawnTo: ['Everyone'] },
      { gender: 'Man', drawnTo: ['Trans men'] },
      { gender: 'Man', drawnTo: ['Non-binary people'] },
      { gender: 'Man', drawnTo: ['Other'] },
      { gender: 'Man', drawnTo: [] },
      { gender: 'Man' }, // drawnTo unset
      {}, // nothing known
    ]) {
      const rows = resolveIntakeActivityRows(ctx);
      expect(has(rows, 'Receiving oral'), JSON.stringify(ctx)).toBe(true);
      expect(has(rows, 'Giving oral'), JSON.stringify(ctx)).toBe(true);
      // No anatomy-specific labels leak when uncertain.
      expect(has(rows, 'Giving a blowjob'), JSON.stringify(ctx)).toBe(false);
      expect(has(rows, 'Receiving oral (blowjob)'), JSON.stringify(ctx)).toBe(false);
      expect(has(rows, 'Going down on her (oral)'), JSON.stringify(ctx)).toBe(false);
    }
  });

  it('does NOT over-filter — every non-oral act stays universal, plus the two relationship dynamics', () => {
    const rows = resolveIntakeActivityRows({ gender: 'Man', drawnTo: ['Women'] });
    // A sample of acts that must remain for everyone (no over-filtering of pegging/choking/etc.).
    for (const act of [
      'Bondage',
      'Choking (giving)',
      'Fingering',
      'Vibrators / dildos',
      'Role-play',
    ]) {
      expect(has(rows, act), act).toBe(true);
    }
    // Deepthroat is an "other act" — left universal, not removed.
    expect(has(rows, 'Deepthroat')).toBe(true);
    for (const dyn of INTIMACY_MATRIX_DYNAMICS) expect(has(rows, dyn)).toBe(true);
  });

  it('the neutral default exactly transforms the inventory oral rows + appends the dynamics', () => {
    const rows = resolveIntakeActivityRows();
    const nonOral = INTIMACY_ACTIVITIES.filter(
      (a) => a !== 'Oral (giving)' && a !== 'Oral (receiving)',
    );
    expect(rows).toEqual([
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

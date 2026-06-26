import { describe, expect, it } from 'vitest';
import { matrixRowKey } from '../schemas';
import type { ScoreAnswers } from './scoring';
import { scoreTest } from './scoring';
import { getTest } from './testCatalog';
import type { TestDefinition } from './types';
import {
  answerTriggersCrisis,
  crisisItemPositive,
  detectWellbeingCrisis,
  flattenAnswerValues,
  resolveWellbeingBand,
} from './wellbeingCrisis';

const phq9 = getTest('phq9')!;
const gad7 = getTest('gad7')!;

/** A PHQ-9 answers map with item 9 (and optionally the rest) at a chosen value. */
function phqAnswers(item9: number, others = 0): ScoreAnswers {
  const record: Record<string, number> = {};
  for (const row of phq9.items[0]!.matrix!.rows) record[matrixRowKey(row)] = others;
  record['phq9-9'] = item9;
  return { phq9: record };
}

/** Set every row of a wellbeing instrument's single matrix to `value` → drives the raw total. */
function uniformAnswers(def: TestDefinition, value: number): ScoreAnswers {
  const record: Record<string, number> = {};
  for (const row of def.items[0]!.matrix!.rows) record[matrixRowKey(row)] = value;
  return { [def.items[0]!.id]: record };
}

describe('flattenAnswerValues', () => {
  it('spreads matrix row keys and keeps standalone numerics', () => {
    const flat = flattenAnswerValues({ phq9: { 'phq9-9': 2, 'phq9-1': 0 }, energy: 5, note: 'x' });
    expect(flat.get('phq9-9')).toBe(2);
    expect(flat.get('phq9-1')).toBe(0);
    expect(flat.get('energy')).toBe(5);
    expect(flat.has('note')).toBe(false);
  });
});

describe('answerTriggersCrisis (mid-check-in, §3.2 step 3)', () => {
  it('fires the instant PHQ-9 item 9 is answered positive (≥1)', () => {
    expect(answerTriggersCrisis(phq9, 'phq9-9', 1)).toBe(true);
    expect(answerTriggersCrisis(phq9, 'phq9-9', 3)).toBe(true);
  });
  it('does NOT fire for a "Not at all" (0) answer on item 9', () => {
    expect(answerTriggersCrisis(phq9, 'phq9-9', 0)).toBe(false);
  });
  it('does NOT fire for any other PHQ-9 item, however high', () => {
    expect(answerTriggersCrisis(phq9, 'phq9-2', 3)).toBe(false);
  });
  it('never fires for an instrument with no crisisItems (GAD-7)', () => {
    expect(answerTriggersCrisis(gad7, 'gad7-1', 3)).toBe(false);
  });
});

describe('crisisItemPositive', () => {
  it('detects a positive item 9 anywhere in the answers map', () => {
    expect(crisisItemPositive(phq9.crisisItems, phqAnswers(1))).toBe(true);
    expect(crisisItemPositive(phq9.crisisItems, phqAnswers(0, 3))).toBe(false);
  });
  it('is false when there are no crisis items', () => {
    expect(crisisItemPositive(gad7.crisisItems, uniformAnswers(gad7, 3))).toBe(false);
  });
});

describe('resolveWellbeingBand', () => {
  it('maps PHQ-9 raw totals to the right internal clinical band', () => {
    expect(resolveWellbeingBand(phq9, 0)?.clinicalKey).toBe('minimal');
    expect(resolveWellbeingBand(phq9, 4)?.clinicalKey).toBe('minimal');
    expect(resolveWellbeingBand(phq9, 5)?.clinicalKey).toBe('mild');
    expect(resolveWellbeingBand(phq9, 9)?.clinicalKey).toBe('mild');
    expect(resolveWellbeingBand(phq9, 10)?.clinicalKey).toBe('moderate');
    expect(resolveWellbeingBand(phq9, 15)?.clinicalKey).toBe('moderately-severe');
    expect(resolveWellbeingBand(phq9, 20)?.clinicalKey).toBe('severe');
    expect(resolveWellbeingBand(phq9, 27)?.clinicalKey).toBe('severe');
  });
  it('clamps an over-range total to the highest band, and the display is non-clinical', () => {
    const band = resolveWellbeingBand(phq9, 999);
    expect(band?.clinicalKey).toBe('severe');
    expect(band?.display.toLowerCase()).not.toContain('depress');
    expect(band?.display.toLowerCase()).not.toContain('you have');
  });
});

describe('detectWellbeingCrisis (item-level OR band-level, §5.2)', () => {
  it('flags on a positive item 9 even when the overall band is low', () => {
    const answers = phqAnswers(1); // only item 9 positive → total 1 → 'minimal' band
    const band = resolveWellbeingBand(phq9, scoreTest(phq9, answers)[0]!.raw);
    expect(band?.clinicalKey).toBe('minimal');
    expect(detectWellbeingCrisis(phq9, answers, band)).toBe(true);
  });
  it('flags on a high overall band (crisis: true) even with item 9 = 0', () => {
    const answers = phqAnswers(0, 3); // every other item maxed, item 9 = 0 → total 24 → 'severe'
    const band = resolveWellbeingBand(phq9, scoreTest(phq9, answers)[0]!.raw);
    expect(band?.clinicalKey).toBe('severe');
    expect(detectWellbeingCrisis(phq9, answers, band)).toBe(true);
  });
  it('does NOT flag a benign result', () => {
    const answers = phqAnswers(0, 0);
    const band = resolveWellbeingBand(phq9, 0);
    expect(detectWellbeingCrisis(phq9, answers, band)).toBe(false);
  });
  it('does NOT flag GAD-7 at its highest band (anxiety severe is not a crisis trigger)', () => {
    const answers = uniformAnswers(gad7, 3); // total 21 → 'severe', no crisis flag
    const band = resolveWellbeingBand(gad7, 21);
    expect(band?.clinicalKey).toBe('severe');
    expect(band?.crisis).toBeUndefined();
    expect(detectWellbeingCrisis(gad7, answers, band)).toBe(false);
  });
});

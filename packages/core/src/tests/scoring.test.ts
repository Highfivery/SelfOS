import { describe, expect, it } from 'vitest';
import { matrixRowKey } from '../schemas';
import { scoresToMetrics, scoreTest, type ScoreAnswers } from './scoring';
import { TEST_CATALOG, getTest } from './testCatalog';
import type { TestDefinition } from './types';

/** A tiny synthetic instrument: one 1–5 matrix of three items, two subscales (sum + mean, with a reverse item). */
function synthetic(out?: 'unit' | 'signed'): TestDefinition {
  return {
    id: 'synthetic',
    group: 'personality',
    title: 'Synthetic',
    instrument: 'TEST',
    blurb: '',
    framing: '',
    estimatedMinutes: 1,
    version: 1,
    items: [
      {
        id: 'grid',
        type: 'matrix',
        prompt: 'rate',
        required: true,
        matrix: {
          rows: [
            { key: 'q1', label: 'a' },
            { key: 'q2', label: 'b' },
            { key: 'q3', label: 'c' },
          ],
          min: 1,
          max: 5,
        },
      },
    ],
    scoring: {
      method: 'subscales',
      scale: { min: 1, max: 5 },
      subscales: [
        {
          key: 'sum.s',
          label: 'Sum',
          aggregate: 'sum',
          items: ['q1', '-q2', 'q3'], // q2 reverse-keyed
          normalize: { min: 3, max: 15, ...(out ? { out } : {}) },
          bands: [
            { upTo: 0.33, label: 'low' },
            { upTo: 0.66, label: 'mid' },
            { upTo: 1, label: 'high' },
          ],
        },
        {
          key: 'mean.s',
          label: 'Mean',
          aggregate: 'mean',
          items: ['q1', '-q2'],
          normalize: { min: 1, max: 5 },
        },
      ],
    },
  };
}

describe('scoreTest — engine correctness', () => {
  it('reverse-scores a `-` keyed item on the definition scale (min+max−value)', () => {
    // q1=5, q2=5 (reverse → 1+5−5=1), q3=5 → sum = 5+1+5 = 11; mean(q1=5, -q2=1) = 3
    const answers: ScoreAnswers = { grid: { q1: 5, q2: 5, q3: 5 } };
    const scores = scoreTest(synthetic(), answers);
    const sum = scores.find((s) => s.key === 'sum.s')!;
    const mean = scores.find((s) => s.key === 'mean.s')!;
    expect(sum.raw).toBe(11);
    expect(sum.normalized).toBe(0.6667); // (11−3)/(15−3) = 0.6667, rounded to 4 dp
    expect(sum.band).toBe('high'); // 0.6667 > 0.66
    expect(mean.raw).toBe(3);
    expect(mean.normalized).toBeCloseTo((3 - 1) / (5 - 1), 5); // 0.5
  });

  it('aggregates sum vs mean distinctly', () => {
    const answers: ScoreAnswers = { grid: { q1: 4, q2: 2, q3: 3 } };
    const scores = scoreTest(synthetic(), answers);
    // sum: q1=4, -q2 = 1+5−2 = 4, q3=3 → 11
    expect(scores.find((s) => s.key === 'sum.s')!.raw).toBe(11);
    // mean: (4 + 4) / 2 = 4
    expect(scores.find((s) => s.key === 'mean.s')!.raw).toBe(4);
  });

  it('normalizes signed onto −1..1 when out: "signed"', () => {
    const answers: ScoreAnswers = { grid: { q1: 1, q2: 5, q3: 1 } }; // sum: 1 + 1 + 1 = 3 (the floor)
    const scores = scoreTest(synthetic('signed'), answers);
    expect(scores.find((s) => s.key === 'sum.s')!.normalized).toBe(-1); // unit 0 → signed −1
  });

  it('resolves the descriptor band from the normalized value', () => {
    const low: ScoreAnswers = { grid: { q1: 1, q2: 5, q3: 1 } }; // sum 3 → 0.0
    expect(scoreTest(synthetic(), low).find((s) => s.key === 'sum.s')!.band).toBe('low');
    const high: ScoreAnswers = { grid: { q1: 5, q2: 1, q3: 5 } }; // sum 5+5+5=15 → 1.0
    expect(scoreTest(synthetic(), high).find((s) => s.key === 'sum.s')!.band).toBe('high');
  });

  it('is TOTAL: a missing answer is omitted, out-of-range is clamped, never throws', () => {
    // q3 missing → sum over {q1=5, -q2 = 1+5−5 = 1} = 6 (mean would be omitting q3 anyway)
    const partial: ScoreAnswers = { grid: { q1: 5, q2: 5 } };
    expect(() => scoreTest(synthetic(), partial)).not.toThrow();
    expect(scoreTest(synthetic(), partial).find((s) => s.key === 'sum.s')!.raw).toBe(6);

    // out-of-range clamps to [1,5]: q1=99→5, q2=-3→1 (reverse 1+5−1=5), q3=5 → 5+5+5 = 15
    const oor: ScoreAnswers = { grid: { q1: 99, q2: -3, q3: 5 } };
    expect(scoreTest(synthetic(), oor).find((s) => s.key === 'sum.s')!.raw).toBe(15);

    // all unanswered → floors to normalize.min, normalized 0
    const empty: ScoreAnswers = {};
    const s = scoreTest(synthetic(), empty).find((x) => x.key === 'sum.s')!;
    expect(s.raw).toBe(3);
    expect(s.normalized).toBe(0);
  });

  it('ignores a corrupt (non-numeric) matrix cell rather than crashing', () => {
    const corrupt = { grid: { q1: 5, q2: 'oops', q3: 5 } } as unknown as ScoreAnswers;
    expect(() => scoreTest(synthetic(), corrupt)).not.toThrow();
    // q2 dropped → sum over {q1=5, q3=5} = 10
    expect(scoreTest(synthetic(), corrupt).find((s) => s.key === 'sum.s')!.raw).toBe(10);
  });

  it('scoresToMetrics maps subscale keys → normalized values', () => {
    const scores = scoreTest(synthetic(), { grid: { q1: 3, q2: 3, q3: 3 } });
    const metrics = scoresToMetrics(scores);
    expect(metrics['sum.s']).toBeCloseTo(0.5, 5);
    expect(metrics['mean.s']).toBeCloseTo(0.5, 5);
  });
});

/** Build the all-midpoint answers for an instrument: every matrix cell at the scale midpoint. */
function midpointAnswers(def: TestDefinition): ScoreAnswers {
  const mid = (def.scoring.scale.min + def.scoring.scale.max) / 2;
  const answers: ScoreAnswers = {};
  for (const item of def.items) {
    if (item.type === 'matrix' && item.matrix) {
      const record: Record<string, number> = {};
      for (const row of item.matrix.rows) record[matrixRowKey(row)] = mid;
      answers[item.id] = record;
    }
  }
  return answers;
}

describe('instruments — structural integrity + keying-independent sanity', () => {
  it('every catalog instrument has unique item row keys + subscale items resolve to real keys', () => {
    for (const def of TEST_CATALOG) {
      const keys = new Set<string>();
      for (const item of def.items) {
        if (item.type === 'matrix' && item.matrix) {
          for (const row of item.matrix.rows) {
            const key = matrixRowKey(row);
            expect(keys.has(key), `dup key ${key} in ${def.id}`).toBe(false);
            keys.add(key);
          }
        }
      }
      for (const sub of def.scoring.subscales) {
        for (const ref of sub.items) {
          const id = ref.startsWith('-') ? ref.slice(1) : ref;
          expect(
            keys.has(id),
            `subscale ${sub.key} references unknown item ${id} in ${def.id}`,
          ).toBe(true);
        }
      }
      // pointLabels length must equal the point count where present (no silent label/scale drift).
      for (const item of def.items) {
        if (item.type === 'matrix' && item.matrix?.pointLabels) {
          expect(item.matrix.pointLabels.length).toBe(item.matrix.max - item.matrix.min + 1);
        }
      }
      // Invariant: a `sensitive` instrument (its results write restricted facts) MUST also be `adult` — the
      // bridge 18+-withholds items/results on `adult`, so a sensitive-but-not-adult test would write
      // restricted facts whose items aren't 18+-gated (50 §3.5/§8.3).
      if (def.sensitive) expect(def.adult, `${def.id} is sensitive but not adult`).toBe(true);
    }
  });

  it('at the scale MIDPOINT every subscale lands at neutral (0.5 unit / 0 signed) — keying-independent', () => {
    for (const def of TEST_CATALOG) {
      const scores = scoreTest(def, midpointAnswers(def));
      expect(scores.length).toBe(def.scoring.subscales.length);
      for (const score of scores) {
        const sub = def.scoring.subscales.find((s) => s.key === score.key)!;
        const out = sub.normalize.out ?? (def.scoring.method === 'subscales' ? 'unit' : 'signed');
        expect(score.normalized, `${def.id}/${score.key}`).toBeCloseTo(
          out === 'signed' ? 0 : 0.5,
          4,
        );
      }
    }
  });

  it('Big Five has 5 domains × 24 items; ECR-R two 18-item subscales (mean); kink uses the 14 categories', () => {
    const big = getTest('bigfive-ipip-120')!;
    expect(big.scoring.subscales).toHaveLength(5);
    for (const sub of big.scoring.subscales) {
      expect(sub.items).toHaveLength(24);
      expect(sub.aggregate).toBe('sum');
    }
    const ecr = getTest('ecr-r')!;
    expect(ecr.scoring.subscales).toHaveLength(2);
    for (const sub of ecr.scoring.subscales) {
      expect(sub.items).toHaveLength(18);
      expect(sub.aggregate).toBe('mean');
    }
    const kink = getTest('kink-interests')!;
    expect(kink.scoring.subscales).toHaveLength(14); // one per INTIMACY_CATEGORIES
    expect(kink.adult).toBe(true);
    expect(kink.sensitive).toBe(true);
    // The opt-in multiChoice + a branched matrix per category.
    expect(kink.items[0]?.type).toBe('multiChoice');
    expect(kink.items.filter((i) => i.type === 'matrix').every((i) => i.branch)).toBe(true);
  });

  it('kink scoring respects per-category means from the spec-49 inventory', () => {
    const kink = getTest('kink-interests')!;
    // Rate the first category's items at "Love it" (5), leave the rest unrated.
    const firstMatrix = kink.items.find((i) => i.type === 'matrix' && i.matrix)!;
    const record: Record<string, number> = {};
    for (const row of firstMatrix.matrix!.rows) record[matrixRowKey(row)] = 5;
    const scores = scoreTest(kink, { [firstMatrix.id]: record });
    const firstKey = `kink.${firstMatrix.id.replace('kink-', '')}`;
    expect(scores.find((s) => s.key === firstKey)!.normalized).toBe(1); // mean 5 → unit 1.0
    // An unrated category floors to 0 (no items answered).
    const otherKey = scores.find((s) => s.key !== firstKey)!;
    expect(otherKey.normalized).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { aggregateCrisisSignal } from '../coaching/crisisSignal';
import { memFileSystem } from '../host/memFileSystem';
import { getInsight, listInsightsForPerson } from '../insights';
import { matrixRowKey } from '../schemas';
import type { ScoreAnswers } from './scoring';
import { getTest } from './testCatalog';
import { deleteResult, listResults, takeTest } from './testService';
import type { TestDefinition } from './types';

const key = generateMasterKey();
let seq = 0;
const ids = (): string => `id-${++seq}`;

/** Every row of a wellbeing instrument's single matrix set to `value`. */
function uniform(def: TestDefinition, value: number): ScoreAnswers {
  const record: Record<string, number> = {};
  for (const row of def.items[0]!.matrix!.rows) record[matrixRowKey(row)] = value;
  return { [def.items[0]!.id]: record };
}

/** Per-row values by row key (defaults the rest to 0). */
function byRow(def: TestDefinition, values: Record<string, number>): ScoreAnswers {
  const record: Record<string, number> = {};
  for (const row of def.items[0]!.matrix!.rows)
    record[matrixRowKey(row)] = values[matrixRowKey(row)] ?? 0;
  return { [def.items[0]!.id]: record };
}

const CLINICAL_WORDS =
  /you have|you are (?:depressed|autistic)|depression|anxiety disorder|adhd|autistic/i;

describe('wellbeing reflections — deterministic band scoring + facts (51 §5.1/§5.4)', () => {
  it('PHQ-9: scores the total, keeps the INTERNAL clinicalKey on the result, emits a gentle non-clinical fact', async () => {
    const fs = memFileSystem();
    const def = getTest('phq9')!;
    // 11 raw → 'moderate' band.
    const answers = byRow(def, { 'phq9-1': 2, 'phq9-2': 2, 'phq9-3': 2, 'phq9-4': 2, 'phq9-5': 3 });
    const result = await takeTest(fs, key, def, { personId: 'p1', answers }, new Date(), ids);

    expect(result.scores[0]!.raw).toBe(11);
    expect(result.scores[0]!.band).toBe('moderate'); // internal clinicalKey kept (never shown clinically)
    expect(result.crisisFlag).toBeUndefined();

    const insight = await getInsight(fs, key, 'p1', result.insightId!);
    expect(insight?.source).toBe('test');
    expect(insight?.approved).toBe(true);
    expect(insight?.categories).toEqual(['Emotions & patterns']);
    expect(insight?.metrics?.['phq9.total']).toBeCloseTo(11 / 27, 3);
    expect(insight?.facts).toHaveLength(1);
    const fact = insight!.facts[0]!;
    expect(fact.text).toMatch(/self-reflection, not a clinical finding/);
    expect(fact.text).not.toMatch(CLINICAL_WORDS);
    // 54: shared with the PARTNER relationship type by default — but only the GENTLE non-diagnostic text
    // (never the clinical band/key), partner-only, never broadcast or per-person.
    expect(fact.shareable).toBe(false);
    expect(fact.restricted).toBeUndefined();
    expect(fact.shareableWith).toBeUndefined();
    expect(fact.shareableTypes).toEqual(['partner']);
  });

  it('PHQ-9 item 9 positive raises crisisFlag on BOTH the result and the derived Insight (even at a low band)', async () => {
    const fs = memFileSystem();
    const def = getTest('phq9')!;
    const result = await takeTest(
      fs,
      key,
      def,
      { personId: 'p1', answers: byRow(def, { 'phq9-9': 1 }) },
      new Date(),
      ids,
    );
    expect(result.scores[0]!.raw).toBe(1);
    expect(result.scores[0]!.band).toBe('minimal');
    expect(result.crisisFlag).toBe(true);
    const insight = await getInsight(fs, key, 'p1', result.insightId!);
    expect(insight?.crisisFlag).toBe(true);
  });

  it('a crisis-flagged wellbeing Insight is counted by aggregateCrisisSignal (40 §3.5) — no change needed', async () => {
    const fs = memFileSystem();
    const def = getTest('phq9')!;
    const now = new Date('2026-06-26T10:00:00Z');
    // Two crisis-flagged check-ins in-window → recurring distress surfaces the supportive banner.
    await takeTest(
      fs,
      key,
      def,
      { personId: 'p1', answers: byRow(def, { 'phq9-9': 2 }) },
      now,
      ids,
    );
    await takeTest(
      fs,
      key,
      getTest('gad7')!,
      { personId: 'p1', answers: uniform(getTest('gad7')!, 3) },
      now,
      ids,
    );
    // The PHQ-9 above is crisis-flagged; add a second crisis flag via another PHQ-9-style insight.
    const insights = await listInsightsForPerson(fs, key, 'p1');
    const flagged = insights.filter((i) => i.crisisFlag);
    expect(flagged.length).toBeGreaterThanOrEqual(1);
    // One crisis flag alone is not "recurring"; the aggregation reads any-source crisisFlag for free.
    const signal = aggregateCrisisSignal({ insights, nightmareNudge: false, now });
    expect(signal.count).toBe(flagged.length);
  });

  it('GAD-7: uniform answers land each of the four bands; severe is NOT a crisis', async () => {
    const fs = memFileSystem();
    const def = getTest('gad7')!;
    const cases: [number, string][] = [
      [0, 'minimal'],
      [1, 'mild'],
      [2, 'moderate'],
      [3, 'severe'],
    ];
    for (const [value, band] of cases) {
      const result = await takeTest(
        fs,
        key,
        def,
        { personId: `g${value}`, answers: uniform(def, value) },
        new Date(),
        ids,
      );
      expect(result.scores[0]!.band).toBe(band);
      expect(result.crisisFlag).toBeUndefined();
    }
  });

  it('ASRS: tags the Health & body life-area and lands a gentle band', async () => {
    const fs = memFileSystem();
    const def = getTest('asrs')!;
    const result = await takeTest(
      fs,
      key,
      def,
      { personId: 'p1', answers: uniform(def, 4) },
      new Date(),
      ids,
    );
    expect(result.scores[0]!.raw).toBe(24);
    expect(result.scores[0]!.band).toBe('many');
    const insight = await getInsight(fs, key, 'p1', result.insightId!);
    expect(insight?.categories).toEqual(['Health & body']);
    expect(insight?.facts[0]!.text).not.toMatch(CLINICAL_WORDS);
  });

  it('AQ-10: answering in the autistic-leaning direction lands the top band; the inverse lands the lowest', async () => {
    const fs = memFileSystem();
    const def = getTest('aq10')!;
    // Agree (4) on agree-keyed (1,7,8,10); disagree (1) on reverse-keyed (2,3,4,5,6,9).
    const leaning = byRow(def, {
      'aq-1': 4,
      'aq-7': 4,
      'aq-8': 4,
      'aq-10': 4,
      'aq-2': 1,
      'aq-3': 1,
      'aq-4': 1,
      'aq-5': 1,
      'aq-6': 1,
      'aq-9': 1,
    });
    const high = await takeTest(
      fs,
      key,
      def,
      { personId: 'a1', answers: leaning },
      new Date(),
      ids,
    );
    expect(high.scores[0]!.band).toBe('many');

    const inverse = byRow(def, {
      'aq-1': 1,
      'aq-7': 1,
      'aq-8': 1,
      'aq-10': 1,
      'aq-2': 4,
      'aq-3': 4,
      'aq-4': 4,
      'aq-5': 4,
      'aq-6': 4,
      'aq-9': 4,
    });
    const low = await takeTest(fs, key, def, { personId: 'a2', answers: inverse }, new Date(), ids);
    expect(low.scores[0]!.band).toBe('few');
  });

  it('RAADS-R: 80 items, reverse-keyed normative items, lands a band', async () => {
    const fs = memFileSystem();
    const def = getTest('raads-r')!;
    expect(def.items[0]!.matrix!.rows).toHaveLength(80);
    const high = await takeTest(
      fs,
      key,
      def,
      { personId: 'r1', answers: uniform(def, 3) },
      new Date(),
      ids,
    );
    expect(high.scores[0]!.key).toBe('raads.total');
    expect(high.scores[0]!.band).toBe('many');
    const low = await takeTest(
      fs,
      key,
      def,
      { personId: 'r2', answers: uniform(def, 0) },
      new Date(),
      ids,
    );
    expect(low.scores[0]!.band).toBe('few');
  });

  it('deleting the latest (crisis) take re-derives the Insight from the new latest — the stale crisis flag clears', async () => {
    const fs = memFileSystem();
    const def = getTest('phq9')!;
    // First take: benign (item 9 = 0). Second (latest) take: a positive item 9 → crisis-flagged.
    const first = await takeTest(
      fs,
      key,
      def,
      { personId: 'p1', answers: byRow(def, { 'phq9-1': 1 }) },
      new Date('2026-06-01T00:00:00Z'),
      ids,
    );
    const crisis = await takeTest(
      fs,
      key,
      def,
      { personId: 'p1', answers: byRow(def, { 'phq9-9': 2 }) },
      new Date('2026-06-10T00:00:00Z'),
      ids,
    );
    expect(crisis.crisisFlag).toBe(true);
    expect((await getInsight(fs, key, 'p1', crisis.insightId!))?.crisisFlag).toBe(true);

    // Delete the latest (crisis) take → the Insight re-derives from the remaining benign take, dropping the flag.
    await deleteResult(fs, key, 'p1', 'phq9', crisis.id, def);
    const remaining = await listResults(fs, key, 'p1', 'phq9');
    expect(remaining.map((r) => r.id)).toEqual([first.id]);
    const insight = await getInsight(fs, key, 'p1', first.insightId!);
    expect(insight?.crisisFlag).toBeUndefined();
    expect(insight?.provenance.testResultId).toBe(first.id); // points at the surviving take
  });

  it('retake reuses the single Insight, sets reTakeOf, and keeps every dated result (trend)', async () => {
    const fs = memFileSystem();
    const def = getTest('phq9')!;
    const first = await takeTest(
      fs,
      key,
      def,
      { personId: 'p1', answers: uniform(def, 1) },
      new Date('2026-06-01T00:00:00Z'),
      ids,
    );
    const second = await takeTest(
      fs,
      key,
      def,
      { personId: 'p1', answers: uniform(def, 0) },
      new Date('2026-06-20T00:00:00Z'),
      ids,
    );
    expect(second.insightId).toBe(first.insightId);
    expect(second.reTakeOf).toBe(first.id);
    const results = await listResults(fs, key, 'p1', 'phq9');
    expect(results).toHaveLength(2);
    // One derived Insight (updated, not duplicated).
    const insights = (await listInsightsForPerson(fs, key, 'p1')).filter(
      (i) => i.provenance.testId === 'phq9',
    );
    expect(insights).toHaveLength(1);
  });
});

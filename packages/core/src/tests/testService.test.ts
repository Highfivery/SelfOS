import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import { getInsight, listInsightsForPerson, summarizeForContext } from '../insights';
import { matrixRowKey } from '../schemas';
import type { ScoreAnswers } from './scoring';
import { getTest } from './testCatalog';
import { deleteAllResults, deleteResult, latestResult, listResults, takeTest } from './testService';
import type { TestDefinition } from './types';

const key = generateMasterKey();
let seq = 0;
const ids = (): string => `id-${++seq}`;

/** All-"agree" answers for an instrument (matrix max), so subscales land high — exercises the bridge. */
function maxAnswers(def: TestDefinition): ScoreAnswers {
  const answers: ScoreAnswers = {};
  for (const item of def.items) {
    if (item.type === 'matrix' && item.matrix) {
      const record: Record<string, number> = {};
      for (const row of item.matrix.rows) record[matrixRowKey(row)] = item.matrix.max;
      answers[item.id] = record;
    }
  }
  return answers;
}

describe('takeTest — result + Insight bridge', () => {
  it('persists a TestResult AND an approved test-source Insight with metrics + provenance', async () => {
    const fs = memFileSystem();
    const def = getTest('ecr-r')!;
    const result = await takeTest(
      fs,
      key,
      def,
      { personId: 'p1', answers: maxAnswers(def) },
      new Date('2026-06-26T10:00:00Z'),
      ids,
    );

    const stored = await latestResult(fs, key, 'p1', 'ecr-r');
    expect(stored?.id).toBe(result.id);
    expect(stored?.scores).toHaveLength(2);
    expect(result.insightId).toBeDefined();

    const insight = await getInsight(fs, key, 'p1', result.insightId!);
    expect(insight?.source).toBe('test');
    expect(insight?.approved).toBe(true);
    expect(insight?.subjectPersonId).toBe('p1');
    expect(insight?.provenance.testId).toBe('ecr-r');
    expect(insight?.provenance.testResultId).toBe(result.id);
    expect(insight?.metrics?.['ecr.anxiety']).toBeDefined();
    // ECR-R is not sensitive → facts are not restricted.
    expect(insight?.facts.every((f) => !f.restricted)).toBe(true);
  });

  it('a SENSITIVE test (kink) writes partner-shareable, own-relevance-gated facts (54)', async () => {
    const fs = memFileSystem();
    const def = getTest('kink-interests')!;
    const result = await takeTest(
      fs,
      key,
      def,
      { personId: 'p1', answers: maxAnswers(def) },
      new Date('2026-06-26T10:00:00Z'),
      ids,
    );
    const insight = await getInsight(fs, key, 'p1', result.insightId!);
    expect(insight?.facts.length).toBeGreaterThan(0);
    // 54: NOT `restricted` (so they can reach the partner — `restricted` stays reserved for break-glass intake
    // facts), own-only on the broadcast flag, shared with the `partner` type, tagged lifeArea Intimacy (the
    // own-context relevance gate keys off the sensitive life-area, so they still surface only in intimacy).
    expect(insight?.facts.every((f) => !f.restricted)).toBe(true);
    expect(insight?.facts.every((f) => f.shareable === false)).toBe(true);
    expect(insight?.facts.every((f) => f.shareableTypes?.includes('partner'))).toBe(true);
    expect(insight?.facts.every((f) => f.lifeArea === 'Intimacy')).toBe(true);
  });

  it('a sensitive test reaches a PARTNER, never a sibling (54)', async () => {
    const fs = memFileSystem();
    const def = getTest('kink-interests')!;
    await takeTest(fs, key, def, { personId: 'p1', answers: maxAnswers(def) }, new Date(), ids);
    // The viewer who relates to p1 as a PARTNER sees the shared facts (behind the confidentiality preamble).
    const partnerView = await summarizeForContext(
      fs,
      key,
      'partner',
      [{ id: 'p1', displayName: 'Pat', grantedTypes: ['partner'] }],
      { lifeAreas: ['Intimacy'] },
    );
    expect(partnerView).toContain('Shareable about Pat');
    // A sibling (any non-partner type) sees nothing cross over.
    const siblingView = await summarizeForContext(
      fs,
      key,
      'sib',
      [{ id: 'p1', displayName: 'Sam', grantedTypes: ['sibling'] }],
      { lifeAreas: ['Intimacy'] },
    );
    expect(siblingView).not.toContain('Shareable about Sam');
  });

  it('a retake reuses the insightId (UPDATE, not duplicate), sets reTakeOf, and adds a trend point', async () => {
    const fs = memFileSystem();
    const def = getTest('ecr-r')!;
    const first = await takeTest(
      fs,
      key,
      def,
      { personId: 'p1', answers: maxAnswers(def) },
      new Date('2026-06-26T10:00:00Z'),
      ids,
    );
    const second = await takeTest(
      fs,
      key,
      def,
      { personId: 'p1', answers: maxAnswers(def) },
      new Date('2026-06-27T10:00:00Z'),
      ids,
    );

    expect(second.id).not.toBe(first.id); // a NEW result file
    expect(second.reTakeOf).toBe(first.id); // chained
    expect(second.insightId).toBe(first.insightId); // SAME insight (updated)

    expect((await listResults(fs, key, 'p1', 'ecr-r')).map((r) => r.id)).toEqual([
      second.id,
      first.id,
    ]);
    expect(
      (await listInsightsForPerson(fs, key, 'p1')).filter((i) => i.source === 'test'),
    ).toHaveLength(1);
    const insight = await getInsight(fs, key, 'p1', first.insightId!);
    expect(insight?.provenance.testResultId).toBe(second.id); // points at the newest result
    expect(insight?.createdAt).toBe(first.createdAt); // preserves the original creation time
  });

  it('a sensitive test insight feeds the taker’s OWN intimacy-topic context but NOT a non-intimacy one', async () => {
    const fs = memFileSystem();
    const def = getTest('kink-interests')!;
    await takeTest(fs, key, def, { personId: 'p1', answers: maxAnswers(def) }, new Date(), ids);

    const intimacy = await summarizeForContext(fs, key, 'p1', [], { lifeAreas: ['Intimacy'] });
    expect(intimacy).toContain('intimacy interests');

    const money = await summarizeForContext(fs, key, 'p1', [], { lifeAreas: ['Money'] });
    expect(money).not.toContain('intimacy interests');

    // …and never reaches ANOTHER person's context (restricted facts never cross).
    const otherView = await summarizeForContext(fs, key, 'p2', [{ id: 'p1', displayName: 'Pat' }], {
      lifeAreas: ['Intimacy'],
    });
    expect(otherView).not.toContain('intimacy interests');
  });

  it('deleteResult removes a single take; deleteAllResults removes the derived Insight too', async () => {
    const fs = memFileSystem();
    const def = getTest('bigfive-ipip-120')!;
    const first = await takeTest(
      fs,
      key,
      def,
      { personId: 'p1', answers: maxAnswers(def) },
      new Date('2026-06-26T10:00:00Z'),
      ids,
    );
    const second = await takeTest(
      fs,
      key,
      def,
      { personId: 'p1', answers: maxAnswers(def) },
      new Date('2026-06-27T10:00:00Z'),
      ids,
    );

    await deleteResult(fs, key, 'p1', 'bigfive-ipip-120', second.id);
    expect((await listResults(fs, key, 'p1', 'bigfive-ipip-120')).map((r) => r.id)).toEqual([
      first.id,
    ]);
    // The insight survives while a result remains.
    expect(await getInsight(fs, key, 'p1', first.insightId!)).not.toBeNull();

    await deleteAllResults(fs, key, 'p1', 'bigfive-ipip-120');
    expect(await listResults(fs, key, 'p1', 'bigfive-ipip-120')).toHaveLength(0);
    expect(await getInsight(fs, key, 'p1', first.insightId!)).toBeNull();
  });
});

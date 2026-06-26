import { afterEach, describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import { listContextProviders, resetContextProviders } from '../questionnaires/contextProviders';
import { matrixRowKey } from '../schemas';
import type { ScoreAnswers } from './scoring';
import { getTest } from './testCatalog';
import { registerTestContextProvider } from './testContextProvider';
import { takeTest } from './testService';
import type { TestDefinition } from './types';

const key = generateMasterKey();

function maxAnswers(def: TestDefinition): ScoreAnswers {
  const out: ScoreAnswers = {};
  for (const item of def.items) {
    if (item.type === 'matrix' && item.matrix) {
      const record: Record<string, number> = {};
      for (const row of item.matrix.rows) record[matrixRowKey(row)] = item.matrix.max;
      out[item.id] = record;
    }
  }
  return out;
}

afterEach(() => resetContextProviders());

describe('test-profile context provider', () => {
  it('surfaces a non-sensitive profile line; gates a sensitive one to an intimacy topic', async () => {
    const fs = memFileSystem();
    await takeTest(
      fs,
      key,
      getTest('bigfive-ipip-120')!,
      { personId: 'p1', answers: maxAnswers(getTest('bigfive-ipip-120')!) },
      new Date(),
    );
    await takeTest(
      fs,
      key,
      getTest('kink-interests')!,
      { personId: 'p1', answers: maxAnswers(getTest('kink-interests')!) },
      new Date(),
    );

    registerTestContextProvider();
    const provider = listContextProviders().find((p) => p.id === 'tests')!;
    const req = (questionnaireType?: string) => ({
      authorPersonId: 'p1',
      includeAuthor: true,
      includeTarget: false,
      includeRelationship: false,
      ...(questionnaireType ? { questionnaireType } : {}),
    });

    const general = await provider.gather(fs, key, req('general'));
    expect(general).toContain('Big Five');
    expect(general).not.toContain('Kink'); // sensitive profile withheld for a non-intimacy topic

    const intimacy = await provider.gather(fs, key, req('intimacy'));
    expect(intimacy).toContain('Kink & intimacy interests'); // surfaced for the intimacy topic

    // No author context → nothing.
    expect(await provider.gather(fs, key, { ...req('intimacy'), includeAuthor: false })).toBe('');
  });
});

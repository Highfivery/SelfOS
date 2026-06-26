import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import type { ClaudeClient } from '../host';
import { memFileSystem } from '../host/memFileSystem';
import { matrixRowKey, type TestResult } from '../schemas';
import { queryUsage } from '../usage';
import { narrateResult } from './testNarrative';
import type { ScoreAnswers } from './scoring';
import { getTest } from './testCatalog';
import { takeTest } from './testService';
import type { TestDefinition } from './types';

const key = generateMasterKey();
const now = new Date('2026-06-26T10:00:00Z');

function answers(def: TestDefinition): ScoreAnswers {
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

function fakeClient(captured: { system?: string } = {}): ClaudeClient {
  return {
    send: async () => '',
    stream: async (options) => {
      captured.system = options.system;
      return {
        text: 'A warm reflection on how you answered.',
        usage: { inputTokens: 100, outputTokens: 50, cacheWriteTokens: 0, cacheReadTokens: 0 },
      };
    },
  };
}

async function seedResult(
  fs: ReturnType<typeof memFileSystem>,
  testId: string,
): Promise<TestResult> {
  const def = getTest(testId)!;
  return takeTest(fs, key, def, { personId: 'p1', answers: answers(def) }, now);
}

describe('narrateResult — the only metered call', () => {
  it('AI off / no key / over budget return typed envelopes and never spend', async () => {
    const fs = memFileSystem();
    const def = getTest('ecr-r')!;
    const result = await seedResult(fs, 'ecr-r');
    const base = {
      fs,
      key,
      client: fakeClient(),
      model: 'claude-sonnet-4-6',
      def,
      result,
      personId: 'p1',
      now,
      overBudget: false,
    };

    expect((await narrateResult({ ...base, aiEnabled: false, apiKey: 'k' })).ok).toBe(false);
    expect((await narrateResult({ ...base, aiEnabled: true, apiKey: null })).ok).toBe(false);
    expect(
      (await narrateResult({ ...base, aiEnabled: true, apiKey: 'k', overBudget: true })).ok,
    ).toBe(false);
    expect(
      await queryUsage(fs, key, {
        from: '2000-01-01',
        to: '2100-01-01',
        personId: 'p1',
        type: 'test.narrate',
      }),
    ).toHaveLength(0);
  });

  it('on success records a test.narrate usage event and returns the prose', async () => {
    const fs = memFileSystem();
    const def = getTest('ecr-r')!;
    const result = await seedResult(fs, 'ecr-r');
    const out = await narrateResult({
      fs,
      key,
      client: fakeClient(),
      apiKey: 'k',
      aiEnabled: true,
      model: 'claude-sonnet-4-6',
      def,
      result,
      personId: 'p1',
      now,
      overBudget: false,
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.text).toContain('reflection');
    expect(
      await queryUsage(fs, key, {
        from: '2000-01-01',
        to: '2100-01-01',
        personId: 'p1',
        type: 'test.narrate',
      }),
    ).toHaveLength(1);
  });

  it('a sensitive instrument adds the consensual-adult boundary to the system prompt', async () => {
    const fs = memFileSystem();
    const def = getTest('kink-interests')!;
    const result = await seedResult(fs, 'kink-interests');
    const captured: { system?: string } = {};
    await narrateResult({
      fs,
      key,
      client: fakeClient(captured),
      apiKey: 'k',
      aiEnabled: true,
      model: 'm',
      def,
      result,
      personId: 'p1',
      now,
      overBudget: false,
    });
    expect(captured.system).toContain('consensual adults');
  });

  it('takeTest itself records NO usage (scoring is free)', async () => {
    const fs = memFileSystem();
    await seedResult(fs, 'bigfive-ipip-120');
    expect(
      await queryUsage(fs, key, { from: '2000-01-01', to: '2100-01-01', personId: 'p1' }),
    ).toHaveLength(0);
  });
});

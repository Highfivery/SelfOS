// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateMasterKey } from '@selfos/core/crypto';
import { savePerson } from '../people/peopleService';
import type { Person, UsageEvent } from '../../shared/schemas';
import { recordUsage } from './usageStore';
import { checkBudget, setAppBudget, setPersonBudget } from './budgetService';

const key = Buffer.from(generateMasterKey());
const now = new Date('2026-06-15T12:00:00.000Z');
let vault: string;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'selfos-budget-'));
});
afterEach(async () => {
  await rm(vault, { recursive: true, force: true });
});

function person(id: string, name: string): Person {
  return {
    id,
    schemaVersion: 1,
    displayName: name,
    isSubject: true,
    tags: [],
    createdAt: 'now',
    updatedAt: 'now',
  };
}

function spend(id: string, personId: string, at: string, costUsd: number): UsageEvent {
  return {
    id,
    schemaVersion: 1,
    type: 'chat',
    personId,
    model: 'claude-sonnet-4-6',
    at,
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    costUsd,
  };
}

describe('budgetService', () => {
  it('falls back to the $10/week default for a person with no explicit budget', async () => {
    const state = await checkBudget(vault, key, { scope: 'person', personId: 'p1', now });
    expect(state.state).toBe('ok');
    expect(state.limitUsd).toBe(10);
    expect(state.period).toBe('week');
  });

  it('reports none for an unset app budget', async () => {
    expect((await checkBudget(vault, key, { scope: 'app', now })).state).toBe('none');
  });

  it('moves ok → warn → over with spend, and an override downgrades over → warn', async () => {
    await savePerson(vault, key, person('p1', 'Alex'));
    await setPersonBudget(vault, key, 'p1', { limitUsd: 1, period: 'month', warnRatio: 0.8 });

    await recordUsage(vault, key, spend('a', 'p1', '2026-06-10T00:00:00.000Z', 0.5));
    expect((await checkBudget(vault, key, { scope: 'person', personId: 'p1', now })).state).toBe(
      'ok',
    );

    await recordUsage(vault, key, spend('b', 'p1', '2026-06-11T00:00:00.000Z', 0.35));
    expect((await checkBudget(vault, key, { scope: 'person', personId: 'p1', now })).state).toBe(
      'warn',
    );

    await recordUsage(vault, key, spend('c', 'p1', '2026-06-12T00:00:00.000Z', 0.25));
    expect((await checkBudget(vault, key, { scope: 'person', personId: 'p1', now })).state).toBe(
      'over',
    );
    expect(
      (await checkBudget(vault, key, { scope: 'person', personId: 'p1', now, override: true }))
        .state,
    ).toBe('warn');
  });

  it('sums all people for the app budget', async () => {
    await savePerson(vault, key, person('p1', 'Alex'));
    await savePerson(vault, key, person('p2', 'Sam'));
    await setAppBudget(vault, key, { limitUsd: 1, period: 'month', warnRatio: 0.8 });
    await recordUsage(vault, key, spend('a', 'p1', '2026-06-10T00:00:00.000Z', 0.6));
    await recordUsage(vault, key, spend('b', 'p2', '2026-06-10T00:00:00.000Z', 0.6));
    expect((await checkBudget(vault, key, { scope: 'app', now })).state).toBe('over');
  });

  it('ignores spend from a previous period', async () => {
    await savePerson(vault, key, person('p1', 'Alex'));
    await setPersonBudget(vault, key, 'p1', { limitUsd: 1, period: 'month', warnRatio: 0.8 });
    await recordUsage(vault, key, spend('old', 'p1', '2026-05-20T00:00:00.000Z', 5));
    expect((await checkBudget(vault, key, { scope: 'person', personId: 'p1', now })).state).toBe(
      'ok',
    );
  });
});

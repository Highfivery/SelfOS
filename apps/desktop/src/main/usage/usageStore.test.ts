// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateMasterKey } from '@selfos/core/crypto';
import type { FileSystem } from '@selfos/core/host';
import { createNodeFileSystem } from '../host/nodeFileSystem';
import { savePerson } from '../people/peopleService';
import type { Person, UsageEvent } from '../../shared/schemas';
import { queryUsage, recordUsage, summarize } from './usageStore';

const key = Buffer.from(generateMasterKey());
let vault: string;
let fs: FileSystem;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'selfos-usage-'));
  fs = createNodeFileSystem(vault);
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

function ev(over: Partial<UsageEvent> & { id: string }): UsageEvent {
  return {
    schemaVersion: 1,
    type: 'chat',
    personId: 'p1',
    model: 'claude-sonnet-4-6',
    at: '2026-06-10T10:00:00.000Z',
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    costUsd: 0,
    ...over,
  };
}

describe('usageStore', () => {
  it('records, queries, and summarizes usage', async () => {
    await savePerson(fs, key, person('p1', 'Alex'));
    await recordUsage(
      fs,
      key,
      ev({ id: 'e1', sessionId: 'c1', inputTokens: 1000, outputTokens: 500, costUsd: 0.02 }),
    );
    await recordUsage(
      fs,
      key,
      ev({ id: 'e2', sessionId: 'c1', cacheReadTokens: 1000, costUsd: 0.01 }),
    );

    const events = await queryUsage(fs, key, {
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-06-30T23:59:59.000Z',
    });
    expect(events.length).toBe(2);

    const summary = summarize(events);
    expect(summary.totalCostUsd).toBeCloseTo(0.03);
    expect(summary.sessionCount).toBe(1);
    expect(summary.byType['chat']?.count).toBe(2);
    expect(summary.cacheSavingsUsd).toBeGreaterThan(0);
    expect(summary.avgCostPerSession).toBeCloseTo(0.03);
  });

  it('stores usage encrypted at rest', async () => {
    await savePerson(fs, key, person('p1', 'Alex'));
    await recordUsage(fs, key, ev({ id: 'e1', model: 'claude-opus-4-8' }));
    const raw = await readFile(join(vault, 'people', 'p1', 'usage', '2026-06.enc'), 'utf8');
    expect(raw).toContain('aes-256-gcm');
    expect(raw).not.toContain('claude-opus-4-8');
  });

  it('filters by date range', async () => {
    await savePerson(fs, key, person('p1', 'Alex'));
    await recordUsage(fs, key, ev({ id: 'old', at: '2026-05-01T00:00:00.000Z' }));
    await recordUsage(fs, key, ev({ id: 'new', at: '2026-06-10T00:00:00.000Z' }));
    const june = await queryUsage(fs, key, {
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-06-30T00:00:00.000Z',
    });
    expect(june.map((e) => e.id)).toEqual(['new']);
  });
});

import { describe, expect, it } from 'vitest';

import { generateMasterKey } from '../crypto';
import type { ClaudeClient, FileSystem } from '../host';
import { memFileSystem } from '../host/memFileSystem';
import { saveInsight } from '../insights';
import { upsertPerson } from '../people/peopleService';
import { upsertRelationship } from '../people/relationshipService';
import type { Insight } from '../schemas';

import type { AiDeps } from './aiCall';
import { refreshCoverage } from './coverageService';
import { readProfile } from './personalizationProfile';
import { gatherRecipientTestMetrics } from './recipientHistory';

const key = generateMasterKey();

const seedPerson = (fs: FileSystem, id: string, name: string): Promise<unknown> =>
  upsertPerson(fs, key, { id, displayName: name, isSubject: true, tags: [] });

const insightOf = (over: Partial<Insight> & { id: string; subjectPersonId: string }): Insight => ({
  schemaVersion: 1,
  source: 'test',
  summary: `summary-${over.id}`,
  facts: [],
  confidence: 'medium',
  categories: [],
  approved: true,
  provenance: { at: '2026-08-01T00:00:00.000Z' },
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...over,
});

describe('gatherRecipientTestMetrics (spec 69 §5.4 follow-on)', () => {
  it("surfaces the NUMBERS from a person's own test insights", async () => {
    const fs = memFileSystem();
    await seedPerson(fs, 'a', 'Angel');
    await saveInsight(
      fs,
      key,
      insightOf({
        id: 'ins-test',
        subjectPersonId: 'a',
        summary: 'Attachment style',
        metrics: { anxiety: 0.72, avoidance: 0.31 },
      }),
    );
    const block = await gatherRecipientTestMetrics(fs, key, 'a');
    expect(block).toContain('Attachment style');
    expect(block).toContain('anxiety 0.72');
    expect(block).toContain('avoidance 0.31');
  });

  it('ignores non-test / unapproved insights and is empty otherwise', async () => {
    const fs = memFileSystem();
    await seedPerson(fs, 'a', 'Angel');
    await saveInsight(
      fs,
      key,
      insightOf({ id: 'sess', subjectPersonId: 'a', source: 'session', metrics: { mood: 0.5 } }),
    );
    expect(await gatherRecipientTestMetrics(fs, key, 'a')).toBe('');
  });
});

describe('refreshCoverage persists the reciprocity ledger (spec 69 §5.4 follow-on)', () => {
  const client = (text: string): ClaudeClient => ({
    send: () => Promise.resolve(''),
    stream: (_o, onDelta) => {
      onDelta(text);
      return Promise.resolve({
        text,
        usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
      });
    },
  });
  const deps = (fs: FileSystem): AiDeps => ({
    fs,
    key,
    client: client(JSON.stringify([{ lifeArea: 'Money', depth: 0 }])),
    apiKey: 'sk-test',
    model: 'claude-sonnet-4-6',
    personId: 'a',
    now: new Date('2026-08-07T00:00:00.000Z'),
  });

  it("records a partner's shared desire as a reciprocity candidate", async () => {
    const fs = memFileSystem();
    await seedPerson(fs, 'a', 'Angel');
    await seedPerson(fs, 'b', 'Ben');
    await upsertRelationship(fs, key, { fromPersonId: 'a', toPersonId: 'b', type: 'partner' });
    await saveInsight(
      fs,
      key,
      insightOf({
        id: 'ins-b',
        subjectPersonId: 'b',
        summary: 'About Ben',
        facts: [
          {
            id: 'f1',
            text: 'Ben would love more spontaneity',
            shareable: false,
            shareableTypes: ['partner'],
            lifeArea: 'Relationships',
          },
        ],
      }),
    );
    const res = await refreshCoverage(deps(fs), 'a');
    expect(res.ok).toBe(true);
    const profile = await readProfile(fs, key, 'a');
    expect(profile.relational?.reciprocity).toEqual([
      expect.objectContaining({
        fromPartnerId: 'b',
        note: 'Ben would love more spontaneity',
        explored: false,
      }),
    ]);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { ClaudeClient, FileSystem } from '../host';
import { flattenContent } from '../host';
import type { Insight, InsightFact, RelationshipType } from '../schemas';
import { saveInsight } from '../insights';
import { queryUsage } from '../usage';
import {
  getRelationshipSynthesis,
  synthesizeRelationship,
  type RelationshipSynthesizeDeps,
} from './relationshipSynthesisService';

const key = generateMasterKey();
const now = new Date('2026-06-26T12:00:00.000Z');
let fs: FileSystem;
beforeEach(() => {
  fs = memFileSystem();
});

function insight(
  id: string,
  subjectPersonId: string,
  facts: InsightFact[],
  over: Partial<Insight> = {},
): Insight {
  return {
    id,
    schemaVersion: 1,
    source: 'session',
    subjectPersonId,
    summary: `summary ${id}`,
    facts,
    confidence: 'medium',
    categories: ['Relationships'],
    approved: true,
    provenance: { conversationId: id, at: now.toISOString() },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...over,
  };
}
const fact = (id: string, text: string, over: Partial<InsightFact> = {}): InsightFact => ({
  id,
  text,
  shareable: false,
  ...over,
});

function jsonClient(
  observations = ['You both value security.', 'You process conflict differently.'],
): ClaudeClient {
  return {
    send: () => Promise.resolve(''),
    stream: () =>
      Promise.resolve({
        text: JSON.stringify({ observations }),
        usage: { inputTokens: 30, outputTokens: 20, cacheWriteTokens: 0, cacheReadTokens: 0 },
      }),
  };
}

function deps(
  client: ClaudeClient,
  over: Partial<RelationshipSynthesizeDeps> = {},
): RelationshipSynthesizeDeps {
  return {
    fs,
    key,
    client,
    apiKey: 'sk-test',
    model: 'claude-sonnet-4-6',
    viewerPersonId: 'v',
    partnerPersonId: 'p',
    partnerName: 'Pat',
    grantedTypes: ['partner'] as RelationshipType[],
    now,
    ...over,
  };
}

describe('synthesizeRelationship (54 §5)', () => {
  it('returns NO_KEY without an API key (no spend)', async () => {
    await saveInsight(fs, key, insight('v1', 'v', [fact('a', 'withdraws under conflict')]));
    await saveInsight(fs, key, insight('v2', 'v', [fact('b', 'values security')]));
    const out = await synthesizeRelationship(deps(jsonClient(), { apiKey: null }));
    expect(out).toMatchObject({ ok: false, reason: 'NO_KEY' });
    expect(
      await queryUsage(fs, key, { from: '2026-01-01', to: '2026-12-31', personId: 'v' }),
    ).toHaveLength(0);
  });

  it('returns EMPTY when there isn’t enough signal (no spend)', async () => {
    await saveInsight(fs, key, insight('v1', 'v', [fact('a', 'one thing')])); // 1 own, 0 shared
    const out = await synthesizeRelationship(deps(jsonClient()));
    expect(out).toMatchObject({ ok: false, reason: 'EMPTY' });
    expect(
      await queryUsage(fs, key, { from: '2026-01-01', to: '2026-12-31', personId: 'v' }),
    ).toHaveLength(0);
  });

  it('produces + caches observations, metered relationship.synthesize', async () => {
    await saveInsight(fs, key, insight('v1', 'v', [fact('a', 'withdraws under conflict')]));
    await saveInsight(
      fs,
      key,
      insight('p1', 'p', [fact('s', 'pursues to resolve', { shareableTypes: ['partner'] })]),
    );
    const out = await synthesizeRelationship(
      deps(jsonClient(['You and Pat handle conflict differently.'])),
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.synthesis.observations[0]).toContain('Pat');
    const cached = await getRelationshipSynthesis(fs, key, 'v', 'p');
    expect(cached?.observations.length).toBeGreaterThan(0);
    const usage = await queryUsage(fs, key, {
      from: '2026-01-01',
      to: '2026-12-31',
      personId: 'v',
    });
    expect(usage).toHaveLength(1);
    expect(usage[0]?.type).toBe('relationship.synthesize');
  });

  it('feeds only the partner’s SHARED facts into the digest — never private/restricted ones (privacy)', async () => {
    let captured = '';
    const capturing: ClaudeClient = {
      send: () => Promise.resolve(''),
      stream: (options) => {
        captured = flattenContent(options.messages.at(-1)?.content ?? '');
        return Promise.resolve({
          text: JSON.stringify({ observations: ['ok'] }),
          usage: { inputTokens: 5, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    await saveInsight(fs, key, insight('v1', 'v', [fact('a', 'OWN-INSIGHT')]));
    await saveInsight(
      fs,
      key,
      insight('p1', 'p', [
        fact('shared', 'PARTNER-SHARED', { shareableTypes: ['partner'] }),
        fact('private', 'PARTNER-PRIVATE'), // own-only — no shareableTypes
        fact('secret', 'PARTNER-RESTRICTED', { restricted: true, shareableTypes: ['partner'] }), // restricted never crosses
      ]),
    );
    await synthesizeRelationship(deps(capturing));
    expect(captured).toContain('OWN-INSIGHT');
    expect(captured).toContain('PARTNER-SHARED');
    expect(captured).not.toContain('PARTNER-PRIVATE');
    expect(captured).not.toContain('PARTNER-RESTRICTED');
  });

  it('meters BEFORE parse — a refusal is still billed and reported honestly', async () => {
    await saveInsight(fs, key, insight('v1', 'v', [fact('a', 'x')]));
    await saveInsight(
      fs,
      key,
      insight('p1', 'p', [fact('s', 'y', { shareableTypes: ['partner'] })]),
    );
    const refusing: ClaudeClient = {
      send: () => Promise.resolve(''),
      stream: () =>
        Promise.resolve({
          text: 'I cannot help with this request.',
          usage: { inputTokens: 10, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 },
        }),
    };
    const out = await synthesizeRelationship(deps(refusing));
    expect(out.ok).toBe(false);
    expect(
      await queryUsage(fs, key, { from: '2026-01-01', to: '2026-12-31', personId: 'v' }),
    ).toHaveLength(1);
  });
});

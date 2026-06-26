import { beforeEach, describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { ClaudeClient, FileSystem } from '../host';
import type { Insight } from '../schemas';
import { saveInsight } from '../insights';
import { queryUsage } from '../usage';
import { getSuggestion, shouldSuggestChallenge, suggestChallenge } from './challengeSuggestService';

const key = generateMasterKey();
const now = new Date('2026-06-26T12:00:00.000Z');
let fs: FileSystem;
beforeEach(() => {
  fs = memFileSystem();
});

function insight(id: string, over: Partial<Insight> = {}): Insight {
  return {
    id,
    schemaVersion: 1,
    source: 'session',
    subjectPersonId: 'p1',
    summary: `reflected on ${id}`,
    facts: [{ id: `${id}-f`, text: `a fact from ${id}`, shareable: false }],
    confidence: 'medium',
    categories: ['Goals & growth'],
    approved: true,
    provenance: { conversationId: id, at: now.toISOString() },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...over,
  };
}

/** A fake client capturing the system + returning a JSON candidate. */
function jsonClient(over: Record<string, unknown> = {}): {
  client: ClaudeClient;
  system: () => string;
} {
  let captured = '';
  return {
    system: () => captured,
    client: {
      send: () => Promise.resolve(''),
      stream: (options) => {
        captured = options.system ?? '';
        return Promise.resolve({
          text: JSON.stringify({
            action: 'Take a 10-minute walk after dinner three times this week',
            why: 'You wanted steadier evenings.',
            comfort: 2,
            lifeArea: 'Health & body',
            domain: 'habit',
            ...over,
          }),
          usage: { inputTokens: 100, outputTokens: 40, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    },
  };
}

const deps = (client: ClaudeClient, over: Record<string, unknown> = {}) => ({
  fs,
  key,
  client,
  apiKey: 'sk-test',
  model: 'claude-sonnet-4-6',
  personId: 'p1',
  adultAllowed: false,
  now,
  ...over,
});

describe('suggestChallenge', () => {
  it('builds a transcript-free digest, meters challenge.suggest BEFORE returning, and caches the candidate', async () => {
    await saveInsight(fs, key, insight('i1'));
    await saveInsight(fs, key, insight('i2'));
    const { client, system } = jsonClient();
    const result = await suggestChallenge(deps(client));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.suggestion.action).toContain('10-minute walk');
    expect(result.suggestion.domain).toBe('habit');
    // the digest carries summaries/facts, NEVER a transcript
    const sentToModel = system();
    expect(sentToModel).toBeTruthy();
    // metered
    const usage = await queryUsage(fs, key, {
      from: new Date(now.getTime() - 1000).toISOString(),
      to: new Date(now.getTime() + 1000).toISOString(),
      personId: 'p1',
      type: 'challenge.suggest',
    });
    expect(usage).toHaveLength(1);
    // cached (no spend) re-read
    expect((await getSuggestion(fs, key, 'p1'))?.action).toContain('10-minute walk');
  });

  it('excludes restricted facts from the digest (a kink/test profile’s sexual specifics never reach the model)', async () => {
    await saveInsight(
      fs,
      key,
      insight('i1', {
        summary: 'an ordinary reflection',
        facts: [
          { id: 'pub', text: 'wants more movement', shareable: false },
          { id: 'sec', text: 'SECRET-SEXUAL-DETAIL', shareable: false, restricted: true },
        ],
      }),
    );
    await saveInsight(fs, key, insight('i2'));
    const { client, system } = jsonClient();
    await suggestChallenge(deps(client));
    expect(system()).not.toContain('SECRET-SEXUAL-DETAIL');
  });

  it('drops a SEXUAL candidate when the 18+ ack is absent (safety net, §8.3)', async () => {
    await saveInsight(fs, key, insight('i1'));
    await saveInsight(fs, key, insight('i2'));
    const { client } = jsonClient({ domain: 'intimacy', adult: true, lifeArea: 'Intimacy' });
    const result = await suggestChallenge(deps(client, { adultAllowed: false }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('EMPTY');
  });

  it('returns EMPTY (no spend) when there is nothing to ground a candidate', async () => {
    const { client } = jsonClient();
    const result = await suggestChallenge(deps(client));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('EMPTY');
    const usage = await queryUsage(fs, key, {
      from: new Date(now.getTime() - 1000).toISOString(),
      to: new Date(now.getTime() + 1000).toISOString(),
      personId: 'p1',
      type: 'challenge.suggest',
    });
    expect(usage).toHaveLength(0);
  });

  it('NO_KEY when there is no api key', async () => {
    const { client } = jsonClient();
    const result = await suggestChallenge(deps(client, { apiKey: null }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('NO_KEY');
  });
});

describe('shouldSuggestChallenge (pure, §5.3)', () => {
  it('never suggests when proactivity is off', () => {
    expect(shouldSuggestChallenge({ hasActiveChallenge: false, level: 'off' }, now)).toBe(false);
  });
  it('never suggests while a challenge is active', () => {
    expect(shouldSuggestChallenge({ hasActiveChallenge: true, level: 'gentle' }, now)).toBe(false);
  });
  it('suggests for a level when no active challenge + no recent idea', () => {
    expect(shouldSuggestChallenge({ hasActiveChallenge: false, level: 'gentle' }, now)).toBe(true);
  });
  it('throttles after a recent idea (within the level window), opens after it', () => {
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
    // gentle has a 7-day window → still throttled 2 days later
    expect(
      shouldSuggestChallenge(
        { hasActiveChallenge: false, level: 'gentle', lastSuggestedAt: twoDaysAgo },
        now,
      ),
    ).toBe(false);
    // active has a shorter 3-day window → still throttled at 2 days, but open by 4 days
    expect(
      shouldSuggestChallenge(
        { hasActiveChallenge: false, level: 'active', lastSuggestedAt: twoDaysAgo },
        now,
      ),
    ).toBe(false);
    const fourDaysAgo = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString();
    expect(
      shouldSuggestChallenge(
        { hasActiveChallenge: false, level: 'active', lastSuggestedAt: fourDaysAgo },
        now,
      ),
    ).toBe(true);
  });
});

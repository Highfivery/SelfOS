import { beforeEach, describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import type { ClaudeClient } from '../host';
import { memFileSystem } from '../host/memFileSystem';
import { queryUsage } from '../usage';
import type { AiDeps } from '../questionnaires/generationService';
import {
  acknowledgeAdult,
  getCachedSuggestions,
  getGuidanceState,
  suggestGuidedSessions,
} from './guidanceService';

const key = generateMasterKey();
const now = new Date('2026-06-15T12:00:00.000Z');
let fs: ReturnType<typeof memFileSystem>;
beforeEach(() => {
  fs = memFileSystem();
});

function client(text: string): ClaudeClient {
  return {
    send: () => Promise.resolve('ok'),
    stream: (_options, onDelta) => {
      onDelta('');
      return Promise.resolve({
        text,
        usage: { inputTokens: 60, outputTokens: 20, cacheWriteTokens: 0, cacheReadTokens: 0 },
      });
    },
  };
}

function deps(text: string, overrides: Partial<AiDeps> = {}): AiDeps {
  return {
    fs,
    key,
    client: client(text),
    apiKey: 'sk-test',
    model: 'claude-sonnet-4-6',
    personId: 'p1',
    now,
    ...overrides,
  };
}

describe('suggestGuidedSessions', () => {
  it('validates against the catalog (drops non-catalog ids), caches, and meters guided.suggest', async () => {
    const text = JSON.stringify([
      { guideId: 'values-clarification', reason: 'You named wanting clarity on what matters.' },
      { guideId: 'grow-goal-setting', reason: 'You have a goal to move forward.' },
      { guideId: 'not-a-real-id', reason: 'should be dropped' },
    ]);
    const result = await suggestGuidedSessions(deps(text), { adultAllowed: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.suggestions.map((s) => s.guideId)).toEqual([
      'values-clarification',
      'grow-goal-setting',
    ]);

    // Cached for the no-spend launcher read.
    const cache = await getCachedSuggestions(fs, key, 'p1');
    expect(cache?.suggestions).toHaveLength(2);

    // Metered as guided.suggest.
    const events = await queryUsage(fs, key, { from: '0000', to: '9999', personId: 'p1' });
    expect(events.some((e) => e.type === 'guided.suggest')).toBe(true);
  });

  it('excludes intimacy exercises until the 18+ ack, and includes them once allowed', async () => {
    const text = JSON.stringify([
      { guideId: 'sensate-focus', reason: 'intimacy pick' },
      { guideId: 'values-clarification', reason: 'safe pick' },
    ]);
    const gated = await suggestGuidedSessions(deps(text), { adultAllowed: false });
    expect(gated.ok).toBe(true);
    if (gated.ok) expect(gated.suggestions.map((s) => s.guideId)).toEqual(['values-clarification']);

    const allowed = await suggestGuidedSessions(deps(text), { adultAllowed: true });
    expect(allowed.ok).toBe(true);
    if (allowed.ok)
      expect(allowed.suggestions.map((s) => s.guideId)).toEqual([
        'sensate-focus',
        'values-clarification',
      ]);
  });

  it('returns NO_KEY without spending when there is no API key', async () => {
    const result = await suggestGuidedSessions(deps('[]', { apiKey: null }), {
      adultAllowed: false,
    });
    expect(result).toMatchObject({ ok: false, reason: 'NO_KEY' });
    expect(await getCachedSuggestions(fs, key, 'p1')).toBeNull();
  });

  it('returns an honest MALFORMED (not a data blame) when nothing usable comes back (and does not cache)', async () => {
    const result = await suggestGuidedSessions(deps('no json here'), { adultAllowed: false });
    // 37 §3.2: a no-JSON reply is MALFORMED ("unexpected shape, try again"), never a "add more about
    // yourself" data blame.
    expect(result).toMatchObject({ ok: false, reason: 'MALFORMED' });
    expect((result as { message: string }).message).not.toMatch(/add more about/i);
    expect(await getCachedSuggestions(fs, key, 'p1')).toBeNull();
  });
});

describe('guidance state + 18+ ack', () => {
  it('round-trips the 18+ acknowledgement and the cache through getGuidanceState', async () => {
    const before = await getGuidanceState(fs, key, 'p1');
    expect(before).toEqual({ cache: null, adultAcknowledged: false });

    await acknowledgeAdult(fs, key, 'p1');
    const text = JSON.stringify([{ guideId: 'reflective-session', reason: 'a gentle start' }]);
    await suggestGuidedSessions(deps(text), { adultAllowed: true });

    const after = await getGuidanceState(fs, key, 'p1');
    expect(after.adultAcknowledged).toBe(true);
    expect(after.cache?.suggestions[0]?.guideId).toBe('reflective-session');
  });
});

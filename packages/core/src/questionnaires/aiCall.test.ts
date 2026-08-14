import { describe, expect, it } from 'vitest';
import { CONTINUATION_INSTRUCTION } from '../conversations/streamWithContinuation';
import { generateMasterKey } from '../crypto';
import type { ClaudeClient, ClaudeStreamOptions, ClaudeStreamResult, ClaudeUsage } from '../host';
import { memFileSystem } from '../host/memFileSystem';
import { queryUsage, recordUsage, setPersonBudget } from '../usage';
import { runClaude, type AiDeps } from './aiCall';

const key = generateMasterKey();
const now = new Date('2026-07-15T00:00:00.000Z');

const USAGE_1: ClaudeUsage = {
  inputTokens: 500,
  outputTokens: 400,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
};
const USAGE_2: ClaudeUsage = {
  inputTokens: 600,
  outputTokens: 300,
  cacheWriteTokens: 7,
  cacheReadTokens: 11,
};

/** A client that serves a scripted queue of replies (repeating the last), recording each call's options. */
function scriptedClient(script: ClaudeStreamResult[]): {
  client: ClaudeClient;
  calls: ClaudeStreamOptions[];
} {
  const calls: ClaudeStreamOptions[] = [];
  const queue = [...script];
  const client: ClaudeClient = {
    send: () => Promise.resolve(''),
    stream: (options) => {
      calls.push(options);
      const next = queue.length > 1 ? queue.shift()! : queue[0]!;
      return Promise.resolve(next);
    },
  };
  return { client, calls };
}

function deps(fs: ReturnType<typeof memFileSystem>, client: ClaudeClient): AiDeps {
  return { fs, key, client, apiKey: 'sk', model: 'claude-sonnet-4-6', personId: 'me', now };
}

async function recordedEvents(fs: ReturnType<typeof memFileSystem>, type: string) {
  return queryUsage(fs, key, {
    from: '2000-01-01T00:00:00.000Z',
    to: '2100-01-01T00:00:00.000Z',
    personId: 'me',
    type,
  });
}

describe('runClaude — truncation-safe continuation (66 §5.1)', () => {
  it('continues a max_tokens reply, stitches the text, and meters ONE summed UsageEvent', async () => {
    const fs = memFileSystem();
    const { client, calls } = scriptedClient([
      { text: 'part one ', usage: USAGE_1, stopReason: 'max_tokens' },
      { text: 'part two.', usage: USAGE_2, stopReason: 'end_turn' },
    ]);
    const res = await runClaude(deps(fs, client), 'sys', 'user text', 'test.pass', 1000);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // The stitched reply — one seamless text, and NOT flagged truncated (the model finished).
    expect(res.text).toBe('part one part two.');
    expect(res.truncated).toBeUndefined();

    // The continuation carried the partial as an assistant turn + the instruction as the final user turn.
    expect(calls).toHaveLength(2);
    const followUp = calls[1]!.messages;
    expect(followUp[followUp.length - 2]).toEqual({ role: 'assistant', content: 'part one' });
    expect(followUp[followUp.length - 1]).toEqual({
      role: 'user',
      content: CONTINUATION_INSTRUCTION,
    });

    // Exactly ONE UsageEvent, with token counts SUMMED across both billed calls.
    const events = await recordedEvents(fs, 'test.pass');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      inputTokens: 1100,
      outputTokens: 700,
      cacheWriteTokens: 7,
      cacheReadTokens: 11,
    });
    expect(res.usage.inputTokens).toBe(1100);
  });

  it('flags `truncated` when the reply STILL ends at max_tokens after the bounded continuations', async () => {
    const fs = memFileSystem();
    // Every call hits the ceiling → 1 initial + MAX_CONTINUATIONS(2) continuations, then an honest partial.
    const { client, calls } = scriptedClient([
      { text: 'never ', usage: USAGE_1, stopReason: 'max_tokens' },
    ]);
    const res = await runClaude(deps(fs, client), 'sys', 'user', 'test.pass', 1000);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(calls).toHaveLength(3); // bounded — never chains forever
    expect(res.truncated).toBe(true);
    expect(res.text).toBe('never never never ');
    // Still exactly one metered event (summed across all three calls).
    const events = await recordedEvents(fs, 'test.pass');
    expect(events).toHaveLength(1);
    expect(events[0]?.inputTokens).toBe(1500);
  });

  it('stops continuing when the budget goes over mid-turn (canContinue): keeps the partial, truncated', async () => {
    const fs = memFileSystem();
    // The budget is fine when the turn starts; a CONCURRENT billed call lands during the (long) stream,
    // pushing the person over — the exact race canContinue exists for.
    await setPersonBudget(fs, key, 'me', { limitUsd: 0.01, period: 'week', warnRatio: 0.8 });
    const calls: ClaudeStreamOptions[] = [];
    const client: ClaudeClient = {
      send: () => Promise.resolve(''),
      stream: async (options) => {
        calls.push(options);
        await recordUsage(fs, key, {
          id: `concurrent-${calls.length}`,
          schemaVersion: 1,
          type: 'chat',
          personId: 'me',
          model: 'claude-sonnet-4-6',
          at: new Date(now.getTime() - 60_000).toISOString(),
          inputTokens: 1,
          outputTokens: 1,
          cacheWriteTokens: 0,
          cacheReadTokens: 0,
          costUsd: 999,
        });
        return { text: 'the partial ', usage: USAGE_1, stopReason: 'max_tokens' };
      },
    };
    const res = await runClaude(deps(fs, client), 'sys', 'user', 'test.pass', 1000);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(calls).toHaveLength(1); // the budget gate stopped every continuation
    expect(res.text).toBe('the partial '); // the partial is kept, never discarded
    expect(res.truncated).toBe(true); // and honestly flagged as cut off
    // The call that DID run is still metered (its own single event).
    expect(await recordedEvents(fs, 'test.pass')).toHaveLength(1);
  });
});

/**
 * 72 §5.8 — a pair-owned book's `personId` is a `pairKey`, not a person, so it is not a spendable identity.
 * Without splitting the two, the budget check would look up a person that doesn't exist and the usage event
 * would be filed under an id no Usage screen can resolve.
 */
describe('metering a call made on behalf of a pair', () => {
  it('bills the person who ran it, not the pair the book belongs to', async () => {
    const fs = memFileSystem();
    const result = await runClaude(
      {
        ...deps(
          fs,
          scriptedClient([{ text: 'hello', usage: USAGE_1, stopReason: 'end_turn' }]).client,
        ),
        personId: 'angel~ben',
        meterPersonId: 'ben',
      },
      'sys',
      'user',
      'story.chapter',
      100,
    );
    expect(result.ok).toBe(true);
    // Filed under the person…
    const underBen = await queryUsage(fs, key, {
      from: '2000-01-01T00:00:00.000Z',
      to: '2100-01-01T00:00:00.000Z',
      personId: 'ben',
      type: 'story.chapter',
    });
    expect(underBen.length).toBe(1);
    // …and nothing under the pair.
    const underPair = await queryUsage(fs, key, {
      from: '2000-01-01T00:00:00.000Z',
      to: '2100-01-01T00:00:00.000Z',
      personId: 'angel~ben',
      type: 'story.chapter',
    });
    expect(underPair).toEqual([]);
  });

  it('honours the RUNNING person’s budget, not the pair’s (which has none)', async () => {
    const fs = memFileSystem();
    await setPersonBudget(fs, key, 'ben', { limitUsd: 0.01, period: 'week', warnRatio: 0.8 });
    // Ben has already spent his allowance elsewhere this period.
    await recordUsage(fs, key, {
      id: 'spent',
      schemaVersion: 1,
      type: 'chat',
      personId: 'ben',
      model: 'claude-sonnet-4-6',
      at: now.toISOString(),
      inputTokens: 0,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      costUsd: 5,
    });
    const result = await runClaude(
      {
        ...deps(
          fs,
          scriptedClient([{ text: 'hello', usage: USAGE_1, stopReason: 'end_turn' }]).client,
        ),
        personId: 'angel~ben',
        meterPersonId: 'ben',
      },
      'sys',
      'user',
      'story.chapter',
      100,
    );
    // Ben is over budget, so the shared book cannot be written on his allowance either.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('BUDGET');
  });

  it('every other caller is unchanged — personId bills personId', async () => {
    const fs = memFileSystem();
    await runClaude(
      deps(fs, scriptedClient([{ text: 'hello', usage: USAGE_1, stopReason: 'end_turn' }]).client),
      'sys',
      'user',
      'story.chapter',
      100,
    );
    expect((await recordedEvents(fs, 'story.chapter')).length).toBe(1);
  });
});

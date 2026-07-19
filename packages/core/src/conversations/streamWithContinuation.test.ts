import { describe, expect, it, vi } from 'vitest';
import type {
  ClaudeClient,
  ClaudeStreamOptions,
  ClaudeStreamResult,
  ClaudeUsage,
} from '../host/claudeClient';
import { MAX_CONTINUATIONS, streamWithContinuation } from './streamWithContinuation';
import { parseChallengeMarker, stripCoachMarkers } from './guidedSteps';

const USAGE: ClaudeUsage = {
  inputTokens: 10,
  outputTokens: 5,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
};

/** A client that serves a scripted queue of replies, recording the options each call received. */
function scriptedClient(script: Partial<ClaudeStreamResult>[]): {
  client: ClaudeClient;
  calls: ClaudeStreamOptions[];
} {
  const calls: ClaudeStreamOptions[] = [];
  const queue = [...script];
  const client: ClaudeClient = {
    send: () => Promise.resolve(''),
    stream: (options, onDelta) => {
      calls.push(options);
      const next = queue.shift() ?? { text: '', stopReason: 'end_turn' };
      const text = next.text ?? '';
      if (text) onDelta(text);
      return Promise.resolve({
        text,
        usage: next.usage ?? USAGE,
        ...(next.stopReason ? { stopReason: next.stopReason } : {}),
      });
    },
  };
  return { client, calls };
}

const BASE: ClaudeStreamOptions = {
  apiKey: 'k',
  model: 'claude-sonnet-5',
  system: 'sys',
  messages: [{ role: 'user', content: 'hello' }],
  maxTokens: 4096,
};

describe('streamWithContinuation', () => {
  it('returns a finished reply untouched, with no continuation', async () => {
    const { client, calls } = scriptedClient([{ text: 'All done.', stopReason: 'end_turn' }]);
    const result = await streamWithContinuation(client, BASE, () => {});

    expect(result.text).toBe('All done.');
    expect(result.continuations).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it('NEVER continues when the transport reports no stop reason (fail-safe against looping)', async () => {
    // An older/simplified host may not report one. Absent must mean "finished", never "truncated".
    const { client, calls } = scriptedClient([{ text: 'Partial' }]);
    const result = await streamWithContinuation(client, BASE, () => {});

    expect(result.continuations).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it('continues a truncated reply and stitches the halves into one text', async () => {
    const { client, calls } = scriptedClient([
      { text: 'It stops mid-', stopReason: 'max_tokens' },
      { text: 'sentence — and finishes.', stopReason: 'end_turn' },
    ]);
    const deltas: string[] = [];
    const result = await streamWithContinuation(client, BASE, (d) => deltas.push(d));

    expect(result.text).toBe('It stops mid-sentence — and finishes.');
    expect(result.continuations).toBe(1);
    expect(calls).toHaveLength(2);
    // The renderer must see one uninterrupted stream — the seam is invisible (§3.1).
    expect(deltas.join('')).toBe('It stops mid-sentence — and finishes.');
  });

  it('continues via assistant prefill with thinking disabled', async () => {
    const { client, calls } = scriptedClient([
      { text: 'Half. ', stopReason: 'max_tokens' },
      { text: 'Rest.', stopReason: 'end_turn' },
    ]);
    await streamWithContinuation(client, BASE, () => {});

    const continuation = calls[1]!;
    const last = continuation.messages[continuation.messages.length - 1]!;
    expect(last.role).toBe('assistant');
    // Trailing whitespace must be trimmed — the API rejects a final assistant turn that ends in it.
    expect(last.content).toBe('Half.');
    // Prefill is incompatible with extended thinking, and the continuation wants the whole budget anyway.
    expect(continuation.extendedThinking).toBe(false);
    // The first call is untouched — thinking stays on for normal coaching replies.
    expect(calls[0]!.extendedThinking).toBeUndefined();
  });

  it('keeps the partial rather than trimming it out of the final text', async () => {
    // We trim only what we SEND as prefill; the accumulated text keeps its whitespace so the
    // continuation appends without swallowing the space at the seam.
    const { client } = scriptedClient([
      { text: 'One. ', stopReason: 'max_tokens' },
      { text: 'Two.', stopReason: 'end_turn' },
    ]);
    const result = await streamWithContinuation(client, BASE, () => {});
    expect(result.text).toBe('One. Two.');
  });

  it('sums usage across every call so the caller meters the full billed cost', async () => {
    const { client } = scriptedClient([
      {
        text: 'a',
        stopReason: 'max_tokens',
        usage: { ...USAGE, inputTokens: 100, outputTokens: 7 },
      },
      { text: 'b', stopReason: 'end_turn', usage: { ...USAGE, inputTokens: 120, outputTokens: 3 } },
    ]);
    const result = await streamWithContinuation(client, BASE, () => {});

    expect(result.usage.inputTokens).toBe(220);
    expect(result.usage.outputTokens).toBe(10);
  });

  it('stops at the continuation cap rather than chaining forever', async () => {
    // Every call truncates — a pathological reply must not spend without bound.
    const { client, calls } = scriptedClient(
      Array.from({ length: 10 }, () => ({ text: 'x', stopReason: 'max_tokens' as const })),
    );
    const result = await streamWithContinuation(client, BASE, () => {});

    expect(result.continuations).toBe(MAX_CONTINUATIONS);
    expect(calls).toHaveLength(MAX_CONTINUATIONS + 1);
    // The partial is kept, not discarded — a short reply beats a lost one.
    expect(result.text).toBe('xxx');
  });

  it('stops when the budget runs out mid-continuation, keeping what it has', async () => {
    const { client, calls } = scriptedClient([
      { text: 'Started', stopReason: 'max_tokens' },
      { text: ' more', stopReason: 'end_turn' },
    ]);
    const canContinue = vi.fn(() => false);
    const result = await streamWithContinuation(client, BASE, () => {}, { canContinue });

    expect(canContinue).toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(result.text).toBe('Started');
    expect(result.continuations).toBe(0);
  });

  it('re-checks the budget before EVERY continuation, not just the first', async () => {
    const { client, calls } = scriptedClient([
      { text: 'a', stopReason: 'max_tokens' },
      { text: 'b', stopReason: 'max_tokens' },
      { text: 'c', stopReason: 'end_turn' },
    ]);
    // Allow the first continuation, refuse the second.
    const canContinue = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    const result = await streamWithContinuation(client, BASE, () => {}, { canContinue });

    expect(canContinue).toHaveBeenCalledTimes(2);
    expect(calls).toHaveLength(2);
    expect(result.text).toBe('ab');
  });

  it('stops early when a continuation adds nothing, instead of burning the cap', async () => {
    const { client, calls } = scriptedClient([
      { text: 'Something', stopReason: 'max_tokens' },
      { text: '', stopReason: 'max_tokens' },
      { text: 'never reached', stopReason: 'end_turn' },
    ]);
    const result = await streamWithContinuation(client, BASE, () => {});

    expect(calls).toHaveLength(2);
    expect(result.text).toBe('Something');
  });

  it('reassembles a coach marker split across the seam (stitch before you strip)', async () => {
    // The reason the helper never strips: a marker straddling a continuation boundary re-forms on
    // concatenation, so the caller's single strip/parse pass sees a whole marker.
    const { client } = scriptedClient([
      { text: 'Nice work. [[SELFOS:CHAL', stopReason: 'max_tokens' },
      { text: 'LENGE:{"action":"Take a walk","comfort":2}]]', stopReason: 'end_turn' },
    ]);
    const result = await streamWithContinuation(client, BASE, () => {});

    expect(parseChallengeMarker(result.text)?.action).toBe('Take a walk');
    expect(stripCoachMarkers(result.text)).toBe('Nice work.');
  });
});

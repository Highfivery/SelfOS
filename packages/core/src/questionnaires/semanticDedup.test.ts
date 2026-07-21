import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { ClaudeClient, FileSystem } from '../host';
import type { Question } from '../schemas';
import type { AiDeps } from './aiCall';
import { semanticDedupFilter } from './semanticDedup';

const key = generateMasterKey();
const now = new Date('2026-07-13T12:00:00.000Z');

function fakeClient(text: string): ClaudeClient {
  return {
    send: () => Promise.resolve(text),
    stream: (_o, onDelta) => {
      onDelta(text);
      return Promise.resolve({
        text,
        usage: { inputTokens: 5, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 },
      });
    },
  };
}

/** A client that returns each text in `texts` on successive stream calls (last one repeats). */
function seqClient(texts: string[]): { client: ClaudeClient; calls: () => number } {
  let i = 0;
  const client: ClaudeClient = {
    send: () => Promise.resolve(texts[0] ?? ''),
    stream: (_o, onDelta) => {
      const text = texts[Math.min(i, texts.length - 1)] ?? '';
      i += 1;
      onDelta(text);
      return Promise.resolve({
        text,
        usage: { inputTokens: 5, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 },
      });
    },
  };
  return { client, calls: () => i };
}

function deps(fs: FileSystem, client: ClaudeClient, apiKey: string | null = 'sk-x'): AiDeps {
  return { fs, key, client, apiKey, model: 'claude-sonnet-4-6', personId: 'p1', now };
}

const q = (prompt: string): Question => ({
  id: prompt,
  type: 'shortText',
  prompt,
  required: false,
});
const CANDIDATES = [q('What do you value most?'), q('How do you unwind?'), q('What scares you?')];

describe('semantic de-dup pass (08 §23.5 layer 3)', () => {
  it('keeps only the indices the model returns as genuinely new', async () => {
    const fs = memFileSystem();
    const result = await semanticDedupFilter(
      deps(fs, fakeClient('[1,3]')),
      CANDIDATES,
      'Already asked: how they relax after work.',
    );
    expect(result.kept.map((x) => x.prompt)).toEqual([
      'What do you value most?',
      'What scares you?',
    ]);
    expect(result.usage?.type).toBe('questionnaire.dedup');
  });

  it('FAILS SAFE — keeps every candidate when there is no key, and FLAGS it degraded', async () => {
    const fs = memFileSystem();
    const result = await semanticDedupFilter(deps(fs, fakeClient('[1]'), null), CANDIDATES, 'ref');
    expect(result.kept).toHaveLength(3);
    expect(result.usage).toBeUndefined();
    // The no-op is now observable — de-dup silently did nothing (the hole the reported bug hides in).
    expect(result.degraded).toBe(true);
  });

  it('treats an empty keep-list as a parse artifact — keeps all, flags degraded (no retry on a valid [])', async () => {
    const fs = memFileSystem();
    const seq = seqClient(['[]']);
    const result = await semanticDedupFilter(deps(fs, seq.client), CANDIDATES, 'ref');
    expect(result.kept).toHaveLength(3);
    expect(result.degraded).toBe(true);
    expect(seq.calls()).toBe(1); // a valid empty array is a real signal, not a glitch → no retry
  });

  it('RETRIES ONCE on a garbled (unparseable) reply, then uses the retry’s valid indices', async () => {
    const fs = memFileSystem();
    const seq = seqClient(['sorry, here are the ones to keep: one and three', '[1,3]']);
    const result = await semanticDedupFilter(deps(fs, seq.client), CANDIDATES, 'ref');
    expect(seq.calls()).toBe(2); // garbled → retried
    expect(result.kept.map((x) => x.prompt)).toEqual([
      'What do you value most?',
      'What scares you?',
    ]);
    expect(result.degraded).toBeUndefined(); // the retry produced a real signal
  });

  it('keeps all + flags degraded when BOTH the reply and the retry are unparseable', async () => {
    const fs = memFileSystem();
    const seq = seqClient(['no json here', 'still no json']);
    const result = await semanticDedupFilter(deps(fs, seq.client), CANDIDATES, 'ref');
    expect(seq.calls()).toBe(2);
    expect(result.kept).toHaveLength(3);
    expect(result.degraded).toBe(true);
  });

  it('does NOT flag degraded when the model legitimately keeps everything', async () => {
    const fs = memFileSystem();
    const result = await semanticDedupFilter(deps(fs, fakeClient('[1,2,3]')), CANDIDATES, 'ref');
    expect(result.kept).toHaveLength(3);
    expect(result.degraded).toBeUndefined();
  });

  it('skips the call entirely with ≤1 candidate (nothing to compare)', async () => {
    const fs = memFileSystem();
    let called = false;
    const spyClient: ClaudeClient = {
      send: () => Promise.resolve(''),
      stream: () => {
        called = true;
        return Promise.resolve({
          text: '[]',
          usage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    const one = await semanticDedupFilter(deps(fs, spyClient), [q('only one')], 'ref');
    expect(one.kept).toHaveLength(1);
    expect(called).toBe(false);
  });

  it('runs intra-batch dedup with an empty reference — drops a later near-identical candidate (#192)', async () => {
    const fs = memFileSystem();
    let called = false;
    // The model keeps candidate 1 and drops candidate 2 (its intra-batch near-duplicate), keeps candidate 3.
    const client: ClaudeClient = {
      send: () => Promise.resolve('[1,3]'),
      stream: (_o, onDelta) => {
        called = true;
        onDelta('[1,3]');
        return Promise.resolve({
          text: '[1,3]',
          usage: { inputTokens: 5, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    const candidates = [
      q('What turns you on the most?'),
      q('What really gets you going in bed?'),
      q('What is a boundary you never want crossed?'),
    ];
    const result = await semanticDedupFilter(deps(fs, client), candidates, '   ');
    expect(called).toBe(true);
    expect(result.kept.map((x) => x.prompt)).toEqual([
      'What turns you on the most?',
      'What is a boundary you never want crossed?',
    ]);
  });
});

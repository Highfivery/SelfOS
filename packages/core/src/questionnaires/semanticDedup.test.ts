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

  it('FAILS SAFE — keeps every candidate when there is no key (no dead-end)', async () => {
    const fs = memFileSystem();
    const result = await semanticDedupFilter(deps(fs, fakeClient('[1]'), null), CANDIDATES, 'ref');
    expect(result.kept).toHaveLength(3);
    expect(result.usage).toBeUndefined();
  });

  it('treats an empty/garbled keep-list as a parse artifact and keeps all', async () => {
    const fs = memFileSystem();
    const result = await semanticDedupFilter(deps(fs, fakeClient('[]')), CANDIDATES, 'ref');
    expect(result.kept).toHaveLength(3);
  });

  it('skips the call entirely with ≤1 candidate or an empty reference', async () => {
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
    const noRef = await semanticDedupFilter(deps(fs, spyClient), CANDIDATES, '   ');
    expect(one.kept).toHaveLength(1);
    expect(noRef.kept).toHaveLength(3);
    expect(called).toBe(false);
  });
});

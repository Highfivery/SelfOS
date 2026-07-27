import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { ClaudeClient, FileSystem } from '../host';
import { resolveFactCorrection, type KnownFact } from './factCorrectionService';
import type { AiDeps } from './generationService';

const key = generateMasterKey();
const now = new Date('2026-07-26T12:00:00.000Z');

function fakeClient(text: string): ClaudeClient {
  return {
    send: () => Promise.resolve(text),
    stream: (_o, onDelta) => {
      onDelta(text);
      return Promise.resolve({
        text,
        usage: { inputTokens: 10, outputTokens: 20, cacheWriteTokens: 0, cacheReadTokens: 0 },
      });
    },
  };
}
function deps(fs: FileSystem, client: ClaudeClient): AiDeps {
  return { fs, key, client, apiKey: 'sk-x', model: 'claude-sonnet-4-6', personId: 'p1', now };
}

const facts: KnownFact[] = [
  { source: 'profile', label: 'your birthday', text: 'age: 39 (born 1985-05-14)' },
  {
    source: 'insight',
    label: 'your Memory',
    text: 'Feels distant lately',
    insightId: 'i1',
    factId: 'f1',
  },
];

describe('resolveFactCorrection', () => {
  it('rewrites the question and maps the matched index to its KnownFact', async () => {
    const reply = JSON.stringify({
      matchedIndex: 1,
      rewrittenPrompt: 'How did turning 41 feel?',
    });
    const res = await resolveFactCorrection(deps(memFileSystem(), fakeClient(reply)), {
      questionPrompt: 'How did turning 39 feel?',
      correction: 'I turned 41, not 39.',
      knownFacts: facts,
    });
    expect(res.ok).toBe(true);
    expect(res.rewrittenPrompt).toBe('How did turning 41 feel?');
    // matchedIndex 1 → the FIRST fact (the profile birthday), 1-based.
    expect(res.matched?.source).toBe('profile');
    expect(res.matched?.label).toBe('your birthday');
  });

  it('returns no match (index 0) so the caller can fall back to letting the person pick the source', async () => {
    const reply = JSON.stringify({ matchedIndex: 0, rewrittenPrompt: 'How are you doing lately?' });
    const res = await resolveFactCorrection(deps(memFileSystem(), fakeClient(reply)), {
      questionPrompt: 'How are things since your move?',
      correction: 'I never moved.',
      knownFacts: facts,
    });
    expect(res.ok).toBe(true);
    expect(res.rewrittenPrompt).toBe('How are you doing lately?');
    expect(res.matched).toBeUndefined();
  });

  it('surfaces an honest failure on an unparseable reply (never a silent success)', async () => {
    const res = await resolveFactCorrection(
      deps(memFileSystem(), fakeClient('sorry, prose only')),
      {
        questionPrompt: 'Q?',
        correction: 'wrong',
        knownFacts: facts,
      },
    );
    expect(res.ok).toBe(false);
    expect(res.rewrittenPrompt).toBeUndefined();
  });
});

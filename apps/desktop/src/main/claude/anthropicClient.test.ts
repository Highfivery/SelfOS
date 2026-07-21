// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the Anthropic SDK so we test the client's content mapping without the network.
const { create, stream } = vi.hoisted(() => ({ create: vi.fn(), stream: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create, stream };
  },
}));

import { generateMasterKey } from '@selfos/core/crypto';
import { memFileSystem } from '@selfos/core/host';
import { generateQuestions, type AiDeps } from '@selfos/core/questionnaires';
import { anthropicClient, fakeClaudeClient } from './anthropicClient';

interface StreamMock {
  on(event: string, cb: (delta: string) => void): void;
  finalMessage(): Promise<unknown>;
}

beforeEach(() => {
  create.mockReset();
  stream.mockReset();
});

describe('anthropicClient vision mapping (45 §5.3)', () => {
  it('stream maps a text+image content block array to the SDK base64 image param', async () => {
    let captured: unknown;
    stream.mockImplementation((args: { messages: unknown }): StreamMock => {
      captured = args.messages;
      return {
        on: () => {},
        finalMessage: () =>
          Promise.resolve({
            content: [{ type: 'text', text: 'ok' }],
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
      };
    });
    await anthropicClient().stream(
      {
        apiKey: 'sk',
        model: 'm',
        system: 'sys',
        maxTokens: 16,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'what is this?' },
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUFB' } },
            ],
          },
        ],
      },
      () => {},
    );
    expect(captured).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is this?' },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUFB' } },
        ],
      },
    ]);
  });

  it('a plain string message passes through unchanged', async () => {
    let captured: unknown;
    create.mockImplementation((args: { messages: unknown }) => {
      captured = args.messages;
      return Promise.resolve({ content: [{ type: 'text', text: 'ok' }] });
    });
    await anthropicClient().send({
      apiKey: 'sk',
      model: 'm',
      messages: [{ role: 'user', content: 'hello' }],
      maxTokens: 16,
    });
    expect(captured).toEqual([{ role: 'user', content: 'hello' }]);
  });
});

describe('fakeClaudeClient', () => {
  it('flattens content blocks to text without throwing (image-only message)', async () => {
    const result = await fakeClaudeClient().stream(
      {
        apiKey: '',
        model: 'm',
        system: '',
        maxTokens: 16,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'hello there' },
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUFB' } },
            ],
          },
        ],
      },
      () => {},
    );
    expect(typeof result.text).toBe('string');
    expect(result.text.length).toBeGreaterThan(0);
  });

  // Regression guard for the reported "AI re-asks things it already knows" bug (08 §23.5). The semantic
  // de-dup pass is the ONLY layer that catches a re-ask of KNOWN info in different words. Before this the
  // offline fake had no de-dup branch, so it returned keep-all and every test passed while the real pass
  // could be a no-op (37 §10). This drives the FULL `generateQuestions` pipeline through the fake and proves
  // a candidate covered by the dedup reference is actually DROPPED — the fake now genuinely exercises it.
  it('the de-dup pass DROPS a candidate covered by the reference (08 §23.5 — not a keep-all no-op)', async () => {
    const key = generateMasterKey();
    const deps: AiDeps = {
      fs: memFileSystem(),
      key,
      client: fakeClaudeClient(),
      apiKey: 'sk-x',
      model: 'claude-sonnet-4-6',
      personId: 'p1',
      now: new Date('2026-07-21T12:00:00.000Z'),
    };
    // The generation fake returns three fixed questions, one being "What felt hardest this week?". A
    // reference that already covers that ("hardest … last week") must drop it, keeping the genuinely-new ones.
    const result = await generateQuestions(deps, {
      type: 'general',
      sensitivity: 'standard',
      context: {
        authorPersonId: 'p1',
        includeAuthor: true,
        includeTarget: false,
        includeRelationship: false,
      },
      existingPrompts: [],
      dedupReference:
        'ALREADY ASKED in prior questionnaires:\n- What was the hardest thing for you last week?',
    });
    expect(result.ok).toBe(true);
    const prompts = (result.ok ? result.questions : [])?.map((q) => q.prompt) ?? [];
    // The covered candidate is gone; the unrelated ones survive — a real reference-driven drop.
    expect(prompts).not.toContain('What felt hardest this week?');
    expect(prompts).toContain('Do you feel heard lately?');
  });
});

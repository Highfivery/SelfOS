// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the Anthropic SDK so we test the client's content mapping without the network.
const { create, stream } = vi.hoisted(() => ({ create: vi.fn(), stream: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create, stream };
  },
}));

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
});

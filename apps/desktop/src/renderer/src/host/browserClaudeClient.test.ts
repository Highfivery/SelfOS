// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the Anthropic SDK so we test the client's mapping (text concat + usage) without the network.
const { create, stream } = vi.hoisted(() => ({ create: vi.fn(), stream: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create, stream };
  },
}));

import { browserClaudeClient } from './browserClaudeClient';

interface StreamMock {
  on(event: string, cb: (delta: string) => void): void;
  finalMessage(): Promise<unknown>;
}

beforeEach(() => {
  create.mockReset();
  stream.mockReset();
});

describe('browserClaudeClient', () => {
  it('send concatenates only the text blocks', async () => {
    create.mockResolvedValue({
      content: [
        { type: 'text', text: 'Hello ' },
        { type: 'thinking', thinking: 'ignored' },
        { type: 'text', text: 'world' },
      ],
    });
    const text = await browserClaudeClient().send({
      apiKey: 'sk',
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 16,
    });
    expect(text).toBe('Hello world');
  });

  it('stream forwards text deltas and maps usage fields', async () => {
    stream.mockImplementation((): StreamMock => {
      let textCb: (delta: string) => void = () => {};
      return {
        on: (event, cb) => {
          if (event === 'text') textCb = cb;
        },
        finalMessage: () => {
          textCb('Hel');
          textCb('lo');
          return Promise.resolve({
            content: [{ type: 'text', text: 'Hello' }],
            usage: {
              input_tokens: 12,
              output_tokens: 3,
              cache_creation_input_tokens: 1,
              cache_read_input_tokens: 2,
            },
          });
        },
      };
    });
    const deltas: string[] = [];
    const result = await browserClaudeClient().stream(
      {
        apiKey: 'sk',
        model: 'm',
        system: 'sys',
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 16,
      },
      (delta) => deltas.push(delta),
    );
    expect(deltas).toEqual(['Hel', 'lo']);
    expect(result.text).toBe('Hello');
    expect(result.usage).toEqual({
      inputTokens: 12,
      outputTokens: 3,
      cacheWriteTokens: 1,
      cacheReadTokens: 2,
    });
  });

  it('maps an image content block to the SDK base64 image param (45 §5.3)', async () => {
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
    await browserClaudeClient().stream(
      {
        apiKey: 'sk',
        model: 'm',
        system: '',
        maxTokens: 16,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'see this' },
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUFB' } },
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
          { type: 'text', text: 'see this' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUFB' } },
        ],
      },
    ]);
  });

  it('defaults missing cache usage fields to 0', async () => {
    stream.mockImplementation(
      (): StreamMock => ({
        on: () => {},
        finalMessage: () =>
          Promise.resolve({
            content: [{ type: 'text', text: 'ok' }],
            usage: { input_tokens: 5, output_tokens: 1 },
          }),
      }),
    );
    const result = await browserClaudeClient().stream(
      { apiKey: 'sk', model: 'm', system: '', messages: [], maxTokens: 16 },
      () => {},
    );
    expect(result.usage).toEqual({
      inputTokens: 5,
      outputTokens: 1,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    });
  });
});

import Anthropic from '@anthropic-ai/sdk';
import type { ClaudeClient, ClaudeStreamResult } from './claudeService';

/** Real Claude client backed by the official Anthropic SDK. */
export function anthropicClient(): ClaudeClient {
  return {
    async send({ apiKey, model, system, messages, maxTokens }) {
      const client = new Anthropic({ apiKey });
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        ...(system ? { system } : {}),
        messages: messages.map((message) => ({ role: message.role, content: message.content })),
      });

      let text = '';
      for (const block of response.content) {
        if (block.type === 'text') text += block.text;
      }
      return text;
    },

    async stream(
      { apiKey, model, system, messages, maxTokens },
      onDelta,
    ): Promise<ClaudeStreamResult> {
      const client = new Anthropic({ apiKey });
      const stream = client.messages.stream({
        model,
        max_tokens: maxTokens,
        thinking: { type: 'adaptive' },
        // cache_control on the stable system prefix → repeat turns read it at ~0.1× (06 §7).
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: messages.map((message) => ({ role: message.role, content: message.content })),
      });
      stream.on('text', (delta) => onDelta(delta));

      const final = await stream.finalMessage();
      let text = '';
      for (const block of final.content) {
        if (block.type === 'text') text += block.text;
      }
      const usage = final.usage;
      return {
        text,
        usage: {
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
          cacheReadTokens: usage.cache_read_input_tokens ?? 0,
        },
      };
    },
  };
}

/** Offline stub (gated by SELFOS_FAKE_CLAUDE) so chat + the connection test are deterministic. */
export function fakeClaudeClient(): ClaudeClient {
  return {
    send: () => Promise.resolve('ok'),
    stream: (_options, onDelta) => {
      const reply = 'I hear you. What feels most important about that right now?';
      for (const word of reply.split(' ')) onDelta(`${word} `);
      return Promise.resolve({
        text: reply,
        usage: { inputTokens: 120, outputTokens: 18, cacheWriteTokens: 0, cacheReadTokens: 0 },
      });
    },
  };
}

export function defaultClaudeClient(): ClaudeClient {
  return process.env['SELFOS_FAKE_CLAUDE'] ? fakeClaudeClient() : anthropicClient();
}

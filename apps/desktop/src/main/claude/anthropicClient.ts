import Anthropic from '@anthropic-ai/sdk';
import type { ClaudeClient } from './claudeService';

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
  };
}

/** Offline stub used in E2E (gated by SELFOS_FAKE_CLAUDE) so the connection test is deterministic. */
export function fakeClaudeClient(): ClaudeClient {
  return { send: () => Promise.resolve('ok') };
}

export function defaultClaudeClient(): ClaudeClient {
  return process.env['SELFOS_FAKE_CLAUDE'] ? fakeClaudeClient() : anthropicClient();
}

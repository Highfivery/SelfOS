import Anthropic from '@anthropic-ai/sdk';
import type { ClaudeClient, ClaudeStreamResult } from '@selfos/core/host';

/**
 * Real Claude on iOS (07-mobile-platform §5.3/§11.3, slice iii-c2): the Anthropic SDK in **browser
 * mode** (`dangerouslyAllowBrowser`) running inside the WKWebView, so the same chat orchestration
 * (`runChatTurn`) works on the phone. The API key is read from the Keychain and passed per call (the
 * Capacitor host runs in the WebView, so the key is transiently in JS memory during the call — the
 * native-HTTP fallback that keeps it native lands only if WKWebView blocks CORS/SSE, §11.3).
 *
 * Mirrors the Electron `anthropicClient` (adaptive thinking + `cache_control` on the system prefix); the
 * web preview keeps the deterministic fake. Verified on-device (the real SDK isn't network-unit-tested).
 */
export function browserClaudeClient(): ClaudeClient {
  const clientFor = (apiKey: string): Anthropic =>
    new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  return {
    async send({ apiKey, model, system, messages, maxTokens }) {
      const response = await clientFor(apiKey).messages.create({
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
      const stream = clientFor(apiKey).messages.stream({
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

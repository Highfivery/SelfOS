import Anthropic from '@anthropic-ai/sdk';
import type { ClaudeClient, ClaudeStreamResult } from '@selfos/core/host';

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
    stream: (options, onDelta) => {
      const userText = options.messages.map((message) => message.content).join('\n');

      // Compatibility variant personalization (08 §3.6) asks for a JSON array of rewritten prompts, one
      // per question. Echo each numbered prompt back (prefixed) so the count matches deterministically.
      if (userText.includes('rewritten prompts')) {
        const prompts = [...userText.matchAll(/^\d+\.\s(.+)$/gm)].map((m) => `For you: ${m[1]}`);
        return Promise.resolve({
          text: JSON.stringify(prompts),
          usage: { inputTokens: 80, outputTokens: 40, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      }

      // Compatibility alignment (08 §13.5d) asks for a report JSON object. Items are merged by canonicalId
      // in the service, so an empty items array still yields a valid report; supply a summary + facts.
      if (userText.includes('compatibility report JSON')) {
        return Promise.resolve({
          text: JSON.stringify({
            summary: 'You two are largely aligned, with a few differences worth talking through.',
            items: [],
            crisisFlag: false,
            facts: [{ text: 'They share core values but differ on pace.', shareable: true }],
          }),
          usage: { inputTokens: 150, outputTokens: 60, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      }

      // The guided "Suggested for you" turn (16 §3.4) asks which catalog exercises fit. Return a JSON
      // array of real catalog ids so the offline suggest path parses + validates deterministically.
      if (userText.includes('exercises fit them') || userText.includes('starter exercises')) {
        return Promise.resolve({
          text: JSON.stringify([
            { guideId: 'values-clarification', reason: 'A grounding place to start.' },
            { guideId: 'grow-goal-setting', reason: 'You mentioned a goal to move forward.' },
          ]),
          usage: { inputTokens: 120, outputTokens: 50, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      }

      // The session-analysis turn (09 §5) asks to "summarize this session" as a JSON object. Return a
      // valid SessionAnalysisDraft so the offline End & summarize path parses + produces facts/mood.
      if (userText.includes('summarize this session')) {
        return Promise.resolve({
          text: JSON.stringify({
            summary: 'A reflective check-in about a hard day, ending on a calmer note.',
            themes: ['stress at work'],
            goals: ['Take a short walk before bed'],
            followUps: ['See how the week settles'],
            people: [],
            moodValence: -0.2,
            moodEnergy: 0.1,
            crisisFlag: false,
          }),
          usage: { inputTokens: 180, outputTokens: 70, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      }

      // The dream-analysis synthesis turn asks for a single JSON object (12-dreams §3.2). Return a valid
      // DreamAnalysis draft so the offline synthesize path parses deterministically; every other turn is
      // the reflective chat reply.
      if (options.messages.some((message) => message.content.includes('JSON object'))) {
        const draft = JSON.stringify({
          summary: 'A dream of shifting rooms and open skies.',
          emotionalLandscape: 'A mix of unease and quiet wonder.',
          wakingLifeConnections: 'Perhaps something at home feels like it is changing.',
          notableImages:
            'The rearranging house, offered as imaginative reflection rather than fact.',
          reflectiveQuestions: ['What in your life feels like it is rearranging right now?'],
          coachingPrompt: 'Notice one thing that felt steady today.',
          tags: {
            emotions: ['unease', 'wonder'],
            symbols: ['house'],
            settings: ['childhood home'],
            themes: ['change'],
            people: [],
          },
          metrics: { emotionalIntensity: 0.5, valence: 0 },
          crisisFlag: false,
          distressSignal: false,
        });
        return Promise.resolve({
          text: draft,
          usage: { inputTokens: 200, outputTokens: 90, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      }
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

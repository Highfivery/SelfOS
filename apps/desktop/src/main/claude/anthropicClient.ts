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
      { apiKey, model, system, messages, maxTokens, extendedThinking },
      onDelta,
    ): Promise<ClaudeStreamResult> {
      const client = new Anthropic({ apiKey });
      const stream = client.messages.stream({
        model,
        max_tokens: maxTokens,
        // Adaptive thinking shares the token budget; a bounded JSON call disables it so the budget isn't
        // starved (would truncate the JSON to empty — the questionnaire-generation bug, 08 §17.9).
        ...(extendedThinking === false ? {} : { thinking: { type: 'adaptive' } }),
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

      // Compatibility variant personalization (08 §3.6/§17.12/§17.14e) asks for a JSON array of objects
      // { prompt, options } — one per question, prompt + options both personalized. Echo each prompt tagged
      // with the OTHER participant ("experience with Y") so a test can verify each person is asked ABOUT the
      // other; preserve the options (count) so the structure stays aligned.
      if (userText.includes('answer about THEIR experience with')) {
        const about = /experience with (.+?):/.exec(userText)?.[1] ?? 'them';
        const prompts = [...userText.matchAll(/^\d+\.\s*PROMPT:\s*(.+)$/gm)].map((m) => m[1]);
        const optionLines = [...userText.matchAll(/^\s*OPTIONS:\s*(.+)$/gm)].map((m) => m[1]);
        const objs = prompts.map((p, i) => {
          let options: string[] | null = null;
          const ol = optionLines[i];
          if (ol && ol.trim() !== 'none') {
            try {
              options = JSON.parse(ol) as string[];
            } catch {
              options = null;
            }
          }
          return { prompt: `${p} — about ${about}`, options };
        });
        return Promise.resolve({
          text: JSON.stringify(objs),
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

      // Question generation (08 §3.1/§16.4) asks for a {title, questions} JSON object. Return a small,
      // valid set deterministically. Must come BEFORE the generic "JSON object" branch below.
      if (userText.includes('the JSON object with a short')) {
        return Promise.resolve({
          text: JSON.stringify({
            title: 'A gentle weekly check-in',
            questions: [
              { type: 'shortText', prompt: 'What felt hardest this week?', required: false },
              { type: 'yesNo', prompt: 'Do you feel heard lately?', required: true },
            ],
          }),
          usage: { inputTokens: 120, outputTokens: 60, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      }

      // Questionnaire analysis + the context-only distillation (08 §3.7/§13.4/§16.2) ask to "Produce the
      // Insight JSON". Return a valid analysis object so the offline Analyze / contextOnly paths parse.
      if (userText.includes('Produce the Insight JSON')) {
        return Promise.resolve({
          text: JSON.stringify({
            summary: 'They value steady connection and want to feel more appreciated day to day.',
            facts: [{ text: 'Feels most connected through shared time.', shareable: true }],
            confidence: 'medium',
            crisisFlag: false,
          }),
          usage: { inputTokens: 140, outputTokens: 60, cacheWriteTokens: 0, cacheReadTokens: 0 },
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
        // 29 — when the depth-detection env flag is set AND this pass was handed the unexplored-areas context
        // (the §5.2 marker), emit ONE depth invitation for the first listed invited section so an E2E can see
        // the depth card. Gated by SELFOS_FAKE_DEPTH so existing analysis E2E are untouched.
        const system = options.system ?? '';
        const depthInvitations =
          process.env['SELFOS_FAKE_DEPTH'] &&
          system.includes('Profile areas they have not explored yet')
            ? (() => {
                const sectionId = /^\s*-\s+([a-z-]+)\s+\("/m.exec(system)?.[1];
                return sectionId
                  ? [
                      {
                        sectionId,
                        theme: 'your family',
                        rationale: 'It has come up a few times.',
                      },
                    ]
                  : [];
              })()
            : [];
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
            depthInvitations,
          }),
          usage: { inputTokens: 180, outputTokens: 70, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      }

      // Personal onboarding (18-personal-onboarding §5) — the interviewer turns, per-section reflections,
      // and the closing portrait. Detected by the interviewer system addendum so it can't collide with the
      // generic "JSON object" dream/session branches below.
      if (
        (options.system ?? '').includes('getting to know you') ||
        userText.includes('closing portrait')
      ) {
        // The closing portrait → a valid PortraitDraft with one restricted ('weighs') fact (§3.5/§8.4).
        if (userText.includes('closing portrait')) {
          return Promise.resolve({
            text: JSON.stringify({
              portrait:
                'You come across as thoughtful and steady — someone who cares about honesty and shows up for the people you love.',
              facts: [
                { text: 'Works as a nurse', section: 'basics' },
                { text: 'Carries grief from a recent loss', section: 'weighs' },
              ],
              metrics: { valence: 0.1 },
              inferred: { communicationStyle: 'warm and direct' },
              crisisFlag: false,
            }),
            usage: { inputTokens: 200, outputTokens: 90, cacheWriteTokens: 0, cacheReadTokens: 0 },
          });
        }
        // A per-section reflection (§11.3).
        if (userText.includes('brief, warm reflection')) {
          return Promise.resolve({
            text: JSON.stringify({
              reflection: 'Thank you for trusting me with that — it helps me understand you.',
            }),
            usage: { inputTokens: 60, outputTokens: 20, cacheWriteTokens: 0, cacheReadTokens: 0 },
          });
        }
        // An interview turn → a warm reply, with a direct field marker only in the basics section so the
        // owner-only profile fills (the marker is stripped from saved/streamed text).
        const marker = userText.includes('What should I call you')
          ? ' [[SELFOS:FIELD:occupation=nurse]]'
          : '';
        const visible = 'Thank you for sharing that with me.';
        for (const word of visible.split(' ')) onDelta(`${word} `);
        return Promise.resolve({
          text: `${visible}${marker}`,
          usage: { inputTokens: 120, outputTokens: 20, cacheWriteTokens: 0, cacheReadTokens: 0 },
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

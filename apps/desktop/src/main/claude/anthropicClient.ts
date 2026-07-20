import Anthropic from '@anthropic-ai/sdk';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ClaudeClient, ClaudeMessage, ClaudeStreamResult } from '@selfos/core/host';
import { flattenContent } from '@selfos/core/host';
import { CONTINUATION_INSTRUCTION } from '@selfos/core/conversations';

/**
 * Map our `ClaudeMessage.content` union (string | text/image blocks, 45 §5.3) to the Anthropic SDK's
 * content param. A plain string passes through; image blocks become Base64ImageSource params. The mime was
 * already validated against `ALLOWED_IMAGE_MIME` in main, so narrowing it to the SDK's literal union is safe.
 */
function toSdkContent(content: ClaudeMessage['content']): Anthropic.MessageParam['content'] {
  if (typeof content === 'string') return content;
  return content.map((block) =>
    block.type === 'text'
      ? { type: 'text' as const, text: block.text }
      : {
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: block.source.media_type as
              | 'image/png'
              | 'image/jpeg'
              | 'image/gif'
              | 'image/webp',
            data: block.source.data,
          },
        },
  );
}

/** Real Claude client backed by the official Anthropic SDK. */
export function anthropicClient(): ClaudeClient {
  return {
    async send({ apiKey, model, system, messages, maxTokens }) {
      const client = new Anthropic({ apiKey });
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        ...(system ? { system } : {}),
        messages: messages.map((message) => ({
          role: message.role,
          content: toSdkContent(message.content),
        })),
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
        messages: messages.map((message) => ({
          role: message.role,
          content: toSdkContent(message.content),
        })),
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
        // 66 §4 — `max_tokens` here is what makes a cut-off reply detectable; without it a truncated
        // reply is indistinguishable from a finished one. Null (the SDK's "unknown") ⇒ omit, so an
        // absent stop reason is treated as finished rather than falsely continued.
        ...(final.stop_reason ? { stopReason: final.stop_reason } : {}),
      };
    },
  };
}

// E2E fail-safe hook (05-conversations §4.1): whether the one forced-empty chat reply has been served yet.
// Module-level so it persists across turns within a launch, regardless of client re-instantiation.
let fakeChatEmptyServed = false;
// 58-together §10 — whether the one forced-empty COUPLES reply has been served (its own hook; the solo one
// is one-shot + haiku-gated, so Together needs a separate flag).
let fakeTogetherEmptyServed = false;
let togetherPromptSeq = 0;
// 66 §10 — the truncation hook. `SELFOS_FAKE_TRUNCATE=1` truncates the FIRST prose reply once (the
// continuation then completes it); `=always` truncates every call, so a test can drive the continuation
// CAP. Module-level like `fakeChatEmptyServed` so it survives client re-instantiation within a launch.
let fakeTruncateServed = false;

/**
 * 66 §5.1 — is this a continuation call? `streamWithContinuation` re-sends the partial reply as an
 * assistant turn followed by `CONTINUATION_INSTRUCTION` as a user turn, so that instruction is the
 * tell. Lets the fake return the SECOND half on a continuation, making the stitched result one
 * grammatical sentence — an E2E can then assert seamlessness rather than mere concatenation.
 *
 * Matched on the real constant, not a trailing-assistant heuristic. The earlier heuristic encoded the
 * assistant-prefill shape the live API rejects, so the fake happily validated a request that 400'd in
 * production — keying off the shared constant keeps fake and real in lockstep by construction.
 */
function isContinuationCall(messages: ClaudeMessage[]): boolean {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user') return false;
  return flattenContent(last.content).includes(CONTINUATION_INSTRUCTION);
}

/**
 * Serve the truncation hook for a prose reply, or null when it isn't armed. The two halves join into
 * "…it stops mid-sentence — and here is the rest."
 */
function fakeTruncation(
  options: { messages: ClaudeMessage[]; model: string },
  onDelta: (text: string) => void,
): Promise<ClaudeStreamResult> | null {
  const mode = process.env['SELFOS_FAKE_TRUNCATE'];
  if (!mode) return null;
  // The cheap Haiku topic classifier runs BEFORE the chat turn and lands here too — without this it would
  // consume the one-shot, leaving the actual reply untruncated (the same trap SELFOS_FAKE_CHAT_EMPTY hit).
  if (options.model.includes('haiku')) return null;
  const usage = { inputTokens: 120, outputTokens: 20, cacheWriteTokens: 0, cacheReadTokens: 0 };

  if (isContinuationCall(options.messages)) {
    // `always` keeps truncating so the cap is reachable; otherwise the continuation completes the reply.
    const rest = ' and here is the rest.';
    for (const word of rest.split(' ')) onDelta(`${word} `);
    return Promise.resolve({
      text: rest,
      usage,
      stopReason: mode === 'always' ? 'max_tokens' : 'end_turn',
    });
  }

  if (mode !== 'always' && fakeTruncateServed) return null;
  fakeTruncateServed = true;
  const half = 'I hear you. This is the first half and it stops mid-sentence —';
  for (const word of half.split(' ')) onDelta(`${word} `);
  return Promise.resolve({ text: half, usage, stopReason: 'max_tokens' });
}

/**
 * 58-together §10 — the `SELFOS_FAKE_PROMPT_DIR` capture hook (the `SELFOS_FAKE_SAVE_DIR` precedent): the fake
 * writes each couples system prompt + transcript to a file the E2E reads, the mechanism behind every
 * "captured prompt" assert (restricted-absence, register-absence, contract order, deflection phrase). Writes a
 * per-turn numbered file + a stable `-latest.txt`. Best-effort; never throws into the turn.
 */
function captureTogetherPrompt(system: string, transcript: string): void {
  const dir = process.env['SELFOS_FAKE_PROMPT_DIR'];
  if (!dir) return;
  try {
    mkdirSync(dir, { recursive: true });
    const body = `SYSTEM:\n${system}\n\nTRANSCRIPT:\n${transcript}\n`;
    togetherPromptSeq += 1;
    writeFileSync(join(dir, `together-prompt-${togetherPromptSeq}.txt`), body);
    writeFileSync(join(dir, 'together-prompt-latest.txt'), body);
  } catch {
    // Capture is a test aid — never let it break the turn.
  }
}

/**
 * 64-your-story §13.6 — capture a story biographer prompt (system + user) to `SELFOS_FAKE_PROMPT_DIR` so an
 * E2E can prove what actually reached the model (the corpus wiring fix: a photo answer must appear in the
 * gap-pass corpus). `name` disambiguates the pass (e.g. `gap`). Best-effort; never throws into the turn.
 */
function captureStoryPrompt(name: string, system: string, user: string): void {
  const dir = process.env['SELFOS_FAKE_PROMPT_DIR'];
  if (!dir) return;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `story-${name}-prompt.txt`), `SYSTEM:\n${system}\n\nUSER:\n${user}\n`);
  } catch {
    // Capture is a test aid — never let it break the turn.
  }
}

/** Offline stub (gated by SELFOS_FAKE_CLAUDE) so chat + the connection test are deterministic. */
export function fakeClaudeClient(): ClaudeClient {
  return {
    send: () => Promise.resolve('ok'),
    stream: (options, onDelta) => {
      const userText = options.messages
        .map((message) => flattenContent(message.content))
        .join('\n');

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
            summary:
              'You two are largely aligned, with **a few differences** worth talking through.',
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
              // A choice question WITH options so the materialize path (08 §19.4) proves the blank-options bug
              // is gone — a generated multiple-choice question always carries real options.
              {
                type: 'multiChoice',
                prompt: 'Which of these drained you most?',
                required: false,
                options: ['Big social events', 'Conflict', 'Long meetings'],
              },
            ],
          }),
          usage: { inputTokens: 120, outputTokens: 60, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      }

      // The gap-finder "Suggested" turn (08 §3.7) asks to "Suggest up to 3 questionnaires". Return a set
      // that is deliberately imperfect so the offline path exercises the tolerant salvage (37 §10: the fakes
      // must not only return flawless JSON, or they hide live bugs). The imperfections mirror the real
      // failure modes: sample questions OMIT `required` (37 §3.3), and the first suggestion mixes a VALID
      // sample question with an OFF-SPEC `type` ("text") the live model guesses — the inner per-element
      // salvage must drop only the bad question, keeping the suggestion + its good question (the
      // "unexpected shape" bug, where one bad type used to sink the whole suggestion).
      if (userText.includes('Suggest up to 3 questionnaires')) {
        return Promise.resolve({
          text: JSON.stringify([
            {
              title: 'Weekly partner check-in',
              type: 'role-feedback',
              rationale: 'You value quality time together.',
              questions: [
                { type: 'rating', prompt: 'How connected did you feel this week?' },
                { type: 'text', prompt: 'Anything left unsaid this week?' }, // off-spec type → dropped
              ],
            },
            {
              title: 'What we each need',
              type: 'general',
              rationale: 'Surfacing needs early prevents drift.',
              questions: [{ type: 'shortText', prompt: 'One thing you need more of right now?' }],
            },
          ]),
          usage: { inputTokens: 120, outputTokens: 60, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      }

      // Questionnaire analysis + the context-only distillation (08 §3.7/§13.4/§16.2) ask to "Produce the
      // Insight JSON". Return a valid analysis object so the offline Analyze / contextOnly paths parse.
      if (userText.includes('Produce the Insight JSON')) {
        return Promise.resolve({
          text: JSON.stringify({
            summary:
              'They value steady connection and want to feel **more appreciated** day to day.',
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

      // The relationship-insights synthesis (54 §5) — the digest opens "This person and their partner <Name>."
      // and the GUIDANCE asks for a {observations: string[]} object. Echo the partner name so a test can
      // verify the synthesis is ABOUT the relationship (and never the partner's raw answers).
      if (userText.includes('This person and their partner')) {
        const partner = /This person and their partner (\w+)/.exec(userText)?.[1] ?? 'them';
        return Promise.resolve({
          text: JSON.stringify({
            observations: [
              `You and ${partner} both lean on security and quality time.`,
              `You tend to withdraw under conflict while ${partner} pursues — naming it helps.`,
            ],
          }),
          usage: { inputTokens: 90, outputTokens: 40, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      }

      // The owner intimacy-topic suggester (08 §16.5a AI assist) — the brief lists what the owner already
      // has. Return a small {activities, fantasies} set; include one EXISTING topic ('Sensual massage', a
      // built-in) so the post-parse dedupe is exercised in the offline path (37 §10).
      if (userText.includes('Topics the Owner ALREADY has')) {
        return Promise.resolve({
          text: JSON.stringify({
            activities: ['Sensual massage', 'Mutual edging', 'Temperature contrast play'],
            fantasies: ['Rivals-to-lovers roleplay', 'Voyeurism'],
          }),
          usage: { inputTokens: 90, outputTokens: 50, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      }

      // Together wrap-up (58 §3.8): "write the wrap-up for this session between A and B" → a per-partner
      // report JSON. Must come BEFORE the generic "JSON object" dream/session branches below (its
      // instruction also says "single JSON object"). A partner whose attributed line contains "CRISIS" is
      // flagged so the crisis-routing test bites.
      const wrapMatch = /write the wrap-up for this session between (.+?) and (.+?)\./.exec(
        userText,
      );
      if (wrapMatch) {
        const [, nameA, nameB] = wrapMatch;
        const crisisFor = (name: string): boolean =>
          new RegExp(`^${name}: .*CRISIS`, 'm').test(userText);
        return Promise.resolve({
          text: JSON.stringify({
            summary: 'You both showed up honestly and named what you each need.',
            themes: ['connection'],
            workedThrough: ['naming the pattern together'],
            connectionValence: 0.4,
            frictionLevel: 0.2,
            partners: [
              {
                name: nameA,
                reflection: `A reflection for ${nameA}.`,
                facts: ['wants more time'],
                sensitiveFacts: [],
                crisisFlag: crisisFor(nameA ?? ''),
              },
              {
                name: nameB,
                reflection: `A reflection for ${nameB}.`,
                facts: ['values reassurance'],
                sensitiveFacts: [],
                crisisFlag: crisisFor(nameB ?? ''),
              },
            ],
            // A concrete next step → a deduped standing pair agreement (§3.9). Stable across runs so a
            // reflect-then-wrap-up sequence exercises the de-dup (never doubled).
            actionItems: [{ text: 'Plan a weekly date night', timeframe: 'this week' }],
          }),
          usage: { inputTokens: 150, outputTokens: 60, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      }

      // --- Your Story (64) ---------------------------------------------------------------------------
      // Every biographer pass, so the whole feature is drivable end-to-end through the real UI (the
      // coreBridge tests exercise the same passes through the bridge). Each is detected by a distinctive
      // phrase from its prompt builder; the JSON ones MUST precede the generic "JSON object" branch below.
      const STORY_USAGE = {
        inputTokens: 150,
        outputTokens: 70,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
      };

      // Foundations (§5.3): a proposed title + essence + timeline + a small outline (two chapters).
      if (userText.includes('plan a biography of')) {
        return Promise.resolve({
          text: JSON.stringify({
            title: 'The Weight of Quiet',
            essence: 'The story of a quiet man learning to speak up.',
            timeline: [{ label: 'Born in Ohio', date: '1985' }],
            outline: {
              parts: [
                {
                  title: 'Roots',
                  chapters: [
                    {
                      title: 'The Garage',
                      brief: 'He learns a machine obeys.',
                      lifeAreas: ['Family'],
                    },
                    {
                      title: 'What the House Held',
                      brief: 'The quiet that settled over the family.',
                    },
                  ],
                },
              ],
            },
          }),
          usage: STORY_USAGE,
        });
      }

      // A chapter (§5.3): prose with a per-paragraph [[SRC:s0]] citation (s0 resolves when the corpus has
      // ≥1 item; otherwise the marker is harmlessly dropped host-side). SELFOS_FAKE_STORY_SLOW adds a small
      // per-chapter delay so an E2E can catch a draft mid-flight (background-continuation test).
      if (userText.includes('WRITE THIS CHAPTER')) {
        const prose =
          'The garage smelled of cut pine and warm oil. [[SRC:s0]]\n\n' +
          'He watched his father work the lathe, and said nothing.';
        for (const word of prose.split(' ')) onDelta(`${word} `);
        const result = { text: prose, usage: STORY_USAGE };
        return process.env['SELFOS_FAKE_STORY_SLOW']
          ? new Promise((resolve) => setTimeout(() => resolve(result), 600))
          : Promise.resolve(result);
      }

      // A batch-markup revision (§3.3.1): return the FULL revised chapter.
      if (userText.includes('You are REVISING one chapter')) {
        const prose =
          'The garage smelled of cut pine, and for once he spoke up. [[SRC:s0]]\n\n' +
          'His father looked up from the lathe, surprised.';
        return Promise.resolve({ text: prose, usage: STORY_USAGE });
      }

      // The gap pass (§3.7): coverage + one prioritized gap so "Find what's missing" mints a check-in.
      if (userText.includes('the biographer taking stock')) {
        captureStoryPrompt('gap', options.system ?? '', userText);
        return Promise.resolve({
          text: JSON.stringify({
            coverage: {
              chapters: true,
              scenes: {
                highPoint: false,
                lowPoint: false,
                turningPoint: false,
                positiveChildhood: true,
                negativeChildhood: false,
                vividAdult: false,
                spiritual: false,
                wisdom: false,
              },
              challenges: false,
              ideology: false,
              futureScript: false,
            },
            gaps: [
              {
                dimension: 'challenges',
                label: 'Your central struggle',
                focus: 'Ask warmly about the hardest thing they have faced and how they met it.',
              },
            ],
          }),
          usage: STORY_USAGE,
        });
      }

      // The structure pass (§3.4): propose one new chapter, referencing the REAL part id parsed from the
      // prompt (the service re-validates ids against the current outline).
      if (userText.includes('reviewing the SHAPE')) {
        const partId = /\[part ([^\]]+)\]/.exec(userText)?.[1];
        return Promise.resolve({
          text: JSON.stringify({
            proposals: partId
              ? [
                  {
                    kind: 'newChapter',
                    rationale: 'A distinct new era has emerged in the material.',
                    partId,
                    title: 'The Move West',
                    brief: 'Leaving the town that made him.',
                  },
                ]
              : [],
          }),
          usage: STORY_USAGE,
        });
      }

      // Photo vision (§3.7): a gentle caption + questions to draw out the memory.
      if ((options.system ?? '').includes('warm biographer looking at a personal photo')) {
        return Promise.resolve({
          text: JSON.stringify({
            caption: 'A quiet afternoon in the workshop.',
            questions: ['Who took this photo?', 'What do you remember most about that day?'],
          }),
          usage: STORY_USAGE,
        });
      }

      // Image-brief distillation (§3.8): a single symbolic visual prompt (the fake image client renders it).
      if (
        (options.system ?? '').includes('turn a life-story brief into a SINGLE vivid visual prompt')
      ) {
        return Promise.resolve({
          text: 'A dim workshop lit by a single bulb, tools at rest, dust suspended in a shaft of afternoon light — quiet, waiting.',
          usage: STORY_USAGE,
        });
      }

      // Image placement (§3.8): the 0-based paragraph index the image should follow.
      if ((options.system ?? '').includes('You place an image within a book chapter')) {
        return Promise.resolve({ text: '0', usage: STORY_USAGE });
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
              // Markdown-bearing portrait (34 §10): the first paragraph stays plain so the
              // /thoughtful and steady/ assertions match an uninterrupted text run; later prose adds a
              // bold + a list to exercise the renderer.
              portrait:
                'You come across as thoughtful and steady — someone who cares about honesty and shows up for the people you love.\n\n' +
                'A few things that stand out:\n\n' +
                '- You value **honesty** in your closest relationships\n' +
                '- You carry real responsibility at work',
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

      // Memory reconciliation (20-memory-dashboard §3.5 / 39 §3.3) — the system prompt asks to "keep the
      // memory coherent". Echo a confidence op for every input insight (parsed from the digest), proposing no
      // merges, so the auto/manual reconcile seam runs end-to-end. Categories are deliberately OMITTED (an
      // imperfect-but-valid reply, 37 §10) so the tolerant parse path is exercised.
      if (options.system?.includes('keep the memory coherent')) {
        let ids: string[] = [];
        try {
          const digest = JSON.parse(userText) as { id?: string }[];
          ids = digest.map((d) => d.id ?? '').filter(Boolean);
        } catch {
          ids = [];
        }
        return Promise.resolve({
          text: JSON.stringify({
            insights: ids.map((id) => ({ id, confidence: 'medium' })),
            merges: [],
          }),
          usage: { inputTokens: 90, outputTokens: 40, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      }

      // The dream-analysis synthesis turn asks for a single JSON object (12-dreams §3.2). Return a valid
      // DreamAnalysis draft so the offline synthesize path parses deterministically; every other turn is
      // the reflective chat reply.
      if (
        options.messages.some((message) => flattenContent(message.content).includes('JSON object'))
      ) {
        const draft = JSON.stringify({
          summary: 'A dream of shifting rooms and open skies.',
          emotionalLandscape: 'A mix of **unease** and quiet wonder.',
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
          // 66 §3.4 — a voiced commitment becomes a tracked Goal (free; it rides this same pass).
          goals: ['Notice one steady thing each evening'],
          // The SEND is gated behind a flag: minting a real questionnaire on every dream synthesis would
          // perturb unrelated tests that count questionnaires/assignments.
          ...(process.env['SELFOS_FAKE_DREAM_QUESTIONNAIRE']
            ? {
                questionnaires: [
                  {
                    title: 'What home means to you',
                    brief: 'What feels like it is changing at home',
                    for: process.env['SELFOS_FAKE_DREAM_QUESTIONNAIRE'],
                  },
                ],
              }
            : {}),
        });
        return Promise.resolve({
          text: draft,
          usage: { inputTokens: 200, outputTokens: 90, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      }
      // The structured Yes/No/Maybe builder (48 §5.2) — detected by its unique addendum framework phrase
      // so it can't collide with the other structured exercises (e.g. Thought Record). Stream a steering
      // reply and append a [[SELFOS:STEP:n]] marker so the stepper-advance E2E exercises REAL marker
      // stripping (the renderer strips it from the streaming buffer + chatService parses the step). The
      // marker is the last token; advancing to step 1 (the first category) on the first user turn.
      if ((options.system ?? '').includes('Yes/No/Maybe model')) {
        const visible =
          "Great — let's start with sensual and touch: kissing, massage, cuddling. " +
          'For each, tell me Yes, No, or Maybe.';
        for (const word of visible.split(' ')) onDelta(`${word} `);
        const marker = '[[SELFOS:STEP:1]]';
        onDelta(marker);
        return Promise.resolve({
          text: `${visible} ${marker}`,
          usage: { inputTokens: 120, outputTokens: 22, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      }

      // The challenge-coach proposer (52 §3.2) — detected by its unique addendum phrase. It PROPOSES on a
      // turn with no agreement, and on a turn whose last user message reads as agreement it confirms + appends
      // a real [[SELFOS:CHALLENGE:{…}]] marker, so the E2E exercises REAL marker stripping + capture (the
      // renderer strips it from the stream + chatService parses it + the Challenge is created).
      if ((options.system ?? '').includes('helping them take on a small CHALLENGE')) {
        const lastUser = [...options.messages].reverse().find((m) => m.role === 'user');
        const userText =
          typeof lastUser?.content === 'string' ? lastUser.content.toLowerCase() : '';
        const agreed = /\b(yes|yeah|sure|let'?s|deal|sounds good|okay|ok|do it)\b/.test(userText);
        if (agreed) {
          const visible =
            "Love it — here's your challenge: strike up one conversation with a stranger this week.";
          for (const word of visible.split(' ')) onDelta(`${word} `);
          const marker =
            '[[SELFOS:CHALLENGE:{"action":"Strike up one conversation with a stranger this week",' +
            '"comfort":3,"lifeArea":"Relationships","checkInDays":7}]]';
          onDelta(marker);
          return Promise.resolve({
            text: `${visible} ${marker}`,
            usage: { inputTokens: 140, outputTokens: 30, cacheWriteTokens: 0, cacheReadTokens: 0 },
          });
        }
        const visible =
          "Here's one small idea to try this week: strike up a short conversation with a stranger — " +
          'totally fine to tweak it or pick something else. Want to go for it?';
        for (const word of visible.split(' ')) onDelta(`${word} `);
        return Promise.resolve({
          text: visible,
          usage: { inputTokens: 140, outputTokens: 26, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      }
      // The proactive challenge suggester (52 §5.3) — detected by its unique guidance phrase. Returns a
      // valid candidate JSON so the suggest E2E exercises the real tolerant parse + cache.
      if ((options.system ?? '').includes('proposing ONE small')) {
        const draft = JSON.stringify({
          action: 'Take a 10-minute walk after dinner three evenings this week',
          why: 'You mentioned wanting more movement and steadier evenings.',
          comfort: 2,
          lifeArea: 'Health & body',
          domain: 'habit',
        });
        return Promise.resolve({
          text: draft,
          usage: { inputTokens: 160, outputTokens: 60, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      }

      // The couples turn (58 §5.1) — detected by the TOGETHER_ADDENDUM's unique phrase so it can't collide
      // with the solo chat/guided branches. Captures the prompt (for the §10 restricted/register/order/
      // deflection asserts), echoes BOTH participants' names (so content-correctness asserts bite — the
      // #129 lesson), and serves the SELFOS_FAKE_TOGETHER_EMPTY fail-safe once when set.
      if (
        (options.system ?? '').includes('facilitating a shared conversation between two partners')
      ) {
        captureTogetherPrompt(options.system ?? '', userText);
        if (process.env['SELFOS_FAKE_TOGETHER_EMPTY'] && !fakeTogetherEmptyServed) {
          fakeTogetherEmptyServed = true;
          return Promise.resolve({
            text: '',
            usage: { inputTokens: 200, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 },
          });
        }
        const names = [...(options.system ?? '').matchAll(/private background about (\w+)/g)].map(
          (m) => m[1],
        );
        const [a, b] = [names[0] ?? 'you', names[1] ?? 'you both'];
        let reply =
          `I hear you, ${a} and ${b}. Let's slow down and take this one gentle step at a time — ` +
          "I'd like to hear how it lands for each of you.";
        // 58 §6.4: when the pair agree to something (a "screen-free" ask), append the AGREEMENT marker so an
        // E2E can drive agreement capture through the real UI. Stripped from the visible reply by the service.
        if (userText.toLowerCase().includes('screen-free')) {
          reply += ' [[SELFOS:AGREEMENT:{"text":"screen-free dinners","timeframe":"weekdays"}]]';
        }
        // 58 §3.10: a structured guided couples turn declares its step; "step two" → advance the derived step.
        if (/step two/i.test(userText)) {
          reply += ' [[SELFOS:STEP:1]]';
        }
        // 58 §5.6: when the pair take on a shared stretch action (a "challenge" ask), append the CHALLENGE
        // marker so an E2E can drive JOINT-challenge minting through the real UI. Stripped from the reply.
        if (userText.toLowerCase().includes('challenge')) {
          reply +=
            ' [[SELFOS:CHALLENGE:{"action":"Share one appreciation a day","comfort":2,"lifeArea":"Relationships","checkInDays":7}]]';
        }
        // 58 §5.6: when a next step would help (a "suggest"/"idea" ask), append a SUGGEST marker so an E2E can
        // drive the suggestion-card flow. It NEVER auto-acts. Stripped from the reply.
        if (/suggest|idea/i.test(userText)) {
          reply +=
            ' [[SELFOS:SUGGEST:{"kind":"guide","prompt":"Try the Love Maps exercise together","guideId":"love-maps"}]]';
        }
        // 58 §3.14 Part B: when the author asks the coach to check "privately", append a PRIVATE marker
        // addressed to the OTHER partner, so an E2E can drive the private-note flow through the real UI. The
        // marker is stripped from the shared reply; the note is scoped to that partner alone. `a`/`b` are the
        // named participants from the prompt; the author is the leading "Name:" in the transcript text.
        if (/privately/i.test(userText)) {
          const authorName = /^(\w+):/.exec(userText)?.[1];
          const target = [a, b].find((n) => n && n !== authorName) ?? b;
          reply += ` [[SELFOS:PRIVATE:{"to":"${target}","text":"PRIVATECOACHNOTE — a gentle check just for you."}]]`;
        }
        for (const word of reply.split(' ')) onDelta(`${word} `);
        return Promise.resolve({
          text: reply,
          usage: { inputTokens: 220, outputTokens: 30, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      }

      // 66 §10 — the truncation hook, placed after every structured-JSON branch so it can only ever affect
      // PROSE replies (Sessions + the dream chat, which both fall through to the generic reply below).
      // Structured calls must never be truncated by a test hook — they have their own 37 salvage path.
      const truncated = fakeTruncation(options, onDelta);
      if (truncated) return truncated;

      // E2E fail-safe hook (05 §4.1): serve ONE empty chat reply (as adaptive-thinking starvation would) so the
      // "Try again" retry path can be driven through the real UI. Gated by SELFOS_FAKE_CHAT_EMPTY; the retry
      // then gets a normal reply. Skip the topic-classifier call (haiku, which also lands here) so the empty is
      // spent on the actual chat turn, not the classifier that precedes it.
      if (
        process.env['SELFOS_FAKE_CHAT_EMPTY'] &&
        !fakeChatEmptyServed &&
        !options.model.includes('haiku')
      ) {
        fakeChatEmptyServed = true;
        return Promise.resolve({
          text: '',
          usage: { inputTokens: 200, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      }

      // Markdown-bearing reply (34 §10) so streaming + saved rendering exercise the real <Markdown>
      // renderer. "hear you" stays contiguous for the existing /hear you/i assertions.
      const reply =
        'I hear you. A couple of small things that might help:\n\n' +
        '- Name **one** feeling underneath it\n' +
        '- Notice what already helped today';
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

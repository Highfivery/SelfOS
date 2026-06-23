import { describe, expect, it } from 'vitest';
import type { ClaudeClient } from '../host';
import { TOPIC_MODEL, classifyTopic, topicShifted } from './topicClassifier';

const usage = { inputTokens: 20, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 };

/** A fake whose `stream` returns a fixed text (the model's classification reply). */
function fakeClient(text: string): ClaudeClient {
  return {
    send: () => Promise.resolve('ok'),
    stream: (_options, onDelta) => {
      onDelta('');
      return Promise.resolve({ text, usage });
    },
  };
}

/** A fake whose `stream` rejects (a transport error). */
const throwingClient: ClaudeClient = {
  send: () => Promise.resolve('ok'),
  stream: () => Promise.reject(new Error('network')),
};

describe('topicShifted (the cheap re-classify trigger)', () => {
  it('classifies on the first turn (never classified ⇒ topic undefined)', () => {
    expect(topicShifted('anything', undefined)).toBe(true);
  });

  it('does NOT re-classify when the message stays within the cached areas', () => {
    expect(topicShifted('more about my debt and rent', ['Money'])).toBe(false);
  });

  it('re-classifies when the message touches a NEW area outside the cache', () => {
    expect(topicShifted('actually my husband is the real problem', ['Money'])).toBe(true);
  });

  it('keeps the cached topic when the message has no strong keyword signal', () => {
    expect(topicShifted('I am not sure how to put it', ['Money'])).toBe(false);
  });

  it('a cached empty topic ([]) is kept on a vague turn but re-classifies once a subject emerges', () => {
    expect(topicShifted('just thinking out loud', [])).toBe(false); // still no subject → keep []
    expect(topicShifted('actually it is about money', [])).toBe(true); // a subject emerged → re-classify
  });
});

describe('classifyTopic (28 §13.2)', () => {
  it('parses + validates the model labels against LIFE_AREAS, dropping unknowns', async () => {
    const result = await classifyTopic({
      client: fakeClient('{"lifeAreas": ["Money", "Nonsense", "Relationships"]}'),
      apiKey: 'sk',
      userText: 'about my debt and my partner',
    });
    expect(result?.lifeAreas).toEqual(['Relationships', 'Money']); // canonical order, unknown dropped
    expect(result?.usage).toEqual(usage);
  });

  it('uses the small Haiku model, not the chat model', async () => {
    let seenModel = '';
    const spy: ClaudeClient = {
      send: () => Promise.resolve('ok'),
      stream: (options) => {
        seenModel = options.model;
        return Promise.resolve({ text: '{"lifeAreas":[]}', usage });
      },
    };
    await classifyTopic({ client: spy, apiKey: 'sk', userText: 'hi' });
    expect(seenModel).toBe(TOPIC_MODEL);
    expect(TOPIC_MODEL).toBe('claude-haiku-4-5');
  });

  it('fails open to [] (still metered) on unparseable output', async () => {
    const result = await classifyTopic({
      client: fakeClient('I cannot do that'),
      apiKey: 'sk',
      userText: 'hi',
    });
    expect(result?.lifeAreas).toEqual([]);
    expect(result?.usage).toEqual(usage); // the call still spent tokens → metered
  });

  it('returns null (no usage) when the call throws', async () => {
    const result = await classifyTopic({ client: throwingClient, apiKey: 'sk', userText: 'hi' });
    expect(result).toBeNull();
  });
});

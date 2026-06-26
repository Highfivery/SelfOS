import { beforeEach, describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { ClaudeClient, FileSystem } from '../host';
import { queryUsage } from '../usage';
import { type SuggestTopicsDeps, suggestIntimacyTopics } from './suggestService';
import type { IntimacyTopics } from './topics';

const key = generateMasterKey();
const now = new Date('2026-06-26T12:00:00.000Z');
let fs: FileSystem;
beforeEach(() => {
  fs = memFileSystem();
});

/** A fake client capturing the system + the user brief and returning a JSON payload. */
function jsonClient(payload: { activities: string[]; fantasies: string[] }): {
  client: ClaudeClient;
  system: () => string;
  brief: () => string;
} {
  let system = '';
  let brief = '';
  return {
    system: () => system,
    brief: () => brief,
    client: {
      send: () => Promise.resolve(''),
      stream: (options) => {
        system = options.system ?? '';
        brief = options.messages
          .map((m) => (typeof m.content === 'string' ? m.content : ''))
          .join('\n');
        return Promise.resolve({
          text: JSON.stringify(payload),
          usage: { inputTokens: 80, outputTokens: 40, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    },
  };
}

const existing: IntimacyTopics = { activities: ['Sensual massage'], fantasies: ['Domination'] };

function deps(client: ClaudeClient, over: Partial<SuggestTopicsDeps> = {}): SuggestTopicsDeps {
  return {
    fs,
    key,
    client,
    apiKey: 'sk-ant',
    model: 'claude-sonnet-4-6',
    personId: 'owner-1',
    now,
    ...over,
  };
}

describe('suggestIntimacyTopics (08 §16.5a AI assist)', () => {
  it('returns deduped fresh activities + fantasies, meters before parse, and grounds the prompt', async () => {
    const { client, system, brief } = jsonClient({
      activities: ['Sensual massage', 'Wax play', 'WAX PLAY', '  '], // existing dup + in-list dup + blank
      fantasies: ['Voyeurism', 'Domination'], // 2nd is an existing dup
    });
    const res = await suggestIntimacyTopics(deps(client), { subject: 'sensory play', existing });

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.suggestions.activities).toEqual(['Wax play']); // existing + in-list dup + blank dropped
    expect(res.suggestions.fantasies).toEqual(['Voyeurism']); // 'Domination' (existing) dropped

    // The subject + the avoid-list reached the model; the consensual-adult boundary is in the system prompt.
    expect(brief()).toContain('sensory play');
    expect(brief()).toContain('Sensual massage'); // the "already have, do not repeat" list
    expect(system()).toMatch(/consensual ADULTS only/i);

    // Metered as intimacy.suggestTopics (before parse / dedup).
    const usage = await queryUsage(fs, key, {
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-07-01T00:00:00.000Z',
      personId: 'owner-1',
    });
    expect(usage.some((u) => u.type === 'intimacy.suggestTopics')).toBe(true);
  });

  it('with no subject, asks for a varied spread (and still works)', async () => {
    const { client, brief } = jsonClient({ activities: ['Edging together'], fantasies: [] });
    const res = await suggestIntimacyTopics(deps(client), { existing });
    expect(res.ok).toBe(true);
    expect(brief()).toMatch(/No specific subject/i);
  });

  it('NO_KEY without an API key (no spend)', async () => {
    const { client } = jsonClient({ activities: ['x'], fantasies: [] });
    const res = await suggestIntimacyTopics(deps(client, { apiKey: null }), { existing });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected failure');
    expect(res.reason).toBe('NO_KEY');
    const usage = await queryUsage(fs, key, {
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-07-01T00:00:00.000Z',
      personId: 'owner-1',
    });
    expect(usage).toHaveLength(0);
  });

  it('EMPTY when every suggestion already exists (the model only echoed the inventory)', async () => {
    const { client } = jsonClient({ activities: ['sensual massage'], fantasies: ['DOMINATION'] });
    const res = await suggestIntimacyTopics(deps(client), { existing });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected failure');
    expect(res.reason).toBe('EMPTY');
  });
});

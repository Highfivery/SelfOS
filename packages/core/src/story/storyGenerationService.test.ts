import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import type { ClaudeClient, ClaudeUsage } from '../host';
import { memFileSystem } from '../host/memFileSystem';
import { savePerson } from '../people';
import type { AiDeps } from '../questionnaires';
import { BookConfigSchema, type Person } from '../schemas';
import { BIOGRAPHY_BOOK_TYPE } from './bookTypes';
import { generateFoundations } from './storyGenerationService';

const key = generateMasterKey();

const USAGE: ClaudeUsage = {
  inputTokens: 1000,
  outputTokens: 500,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
};

function fakeClient(text: string): ClaudeClient {
  return {
    send: async () => text,
    stream: async () => ({ text, usage: USAGE }),
  };
}

function subject(fs: ReturnType<typeof memFileSystem>): Promise<void> {
  const person: Person = {
    id: 'me',
    schemaVersion: 2,
    displayName: 'Ben',
    isSubject: true,
    tags: [],
    occupation: 'teacher',
    createdAt: 'now',
    updatedAt: 'now',
  };
  return savePerson(fs, key, person);
}

function deps(
  fs: ReturnType<typeof memFileSystem>,
  client: ClaudeClient,
  apiKey: string | null,
): AiDeps {
  return {
    fs,
    key,
    client,
    apiKey,
    model: 'claude-sonnet-4-6',
    personId: 'me',
    now: new Date('2026-07-15T00:00:00.000Z'),
  };
}

const VALID_JSON = JSON.stringify({
  essence: '  A quiet man learning to speak.  ',
  timeline: [
    { label: 'Born in Ohio', date: '1985' },
    { label: 'Moved to Denver', approx: 'mid-2010s' },
  ],
  outline: {
    parts: [
      {
        title: 'Roots',
        chapters: [
          {
            title: 'The Garage',
            brief: 'He learns a machine obeys.',
            eraFrom: '1994',
            lifeAreas: ['Family'],
          },
        ],
      },
    ],
  },
});

const opts = { bookType: BIOGRAPHY_BOOK_TYPE, config: BookConfigSchema.parse({}) };

describe('generateFoundations (64 §5.3)', () => {
  it('parses a valid foundations reply into essence + outline + timeline, minting ids server-side', async () => {
    const fs = memFileSystem();
    await subject(fs);
    const res = await generateFoundations(deps(fs, fakeClient(VALID_JSON), 'sk-test'), opts);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.essence).toBe('A quiet man learning to speak.'); // trimmed
    expect(res.usage.type).toBe('story.outline'); // metered under the right type
    // Outline: one part, one chapter, ids minted here (unique, non-empty), order stamped.
    expect(res.outline.approved).toBe(false);
    expect(res.outline.parts).toHaveLength(1);
    const part = res.outline.parts[0]!;
    expect(part.title).toBe('Roots');
    expect(part.id.length).toBeGreaterThan(0);
    const chapter = part.chapters[0]!;
    expect(chapter.title).toBe('The Garage');
    expect(chapter.brief).toBe('He learns a machine obeys.');
    expect(chapter.eraFrom).toBe('1994');
    expect(chapter.lifeAreas).toEqual(['Family']);
    expect(chapter.order).toBe(0);
    expect(chapter.id.length).toBeGreaterThan(0);
    expect(chapter.id).not.toBe(part.id);
    // Timeline: minted ids, userEdited false.
    expect(res.timeline.events.map((e) => e.label)).toEqual(['Born in Ohio', 'Moved to Denver']);
    expect(res.timeline.events[0]!.date).toBe('1985');
    expect(res.timeline.events[1]!.approx).toBe('mid-2010s');
    expect(res.timeline.events.every((e) => e.id.length > 0 && e.userEdited === false)).toBe(true);
  });

  it('returns NO_KEY without calling the model when there is no API key', async () => {
    const fs = memFileSystem();
    await subject(fs);
    let called = false;
    const client: ClaudeClient = {
      send: async () => '',
      stream: async () => {
        called = true;
        return { text: '', usage: USAGE };
      },
    };
    const res = await generateFoundations(deps(fs, client, null), opts);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('NO_KEY');
    expect(called).toBe(false);
  });

  it('salvages a partly-malformed outline: a bad chapter drops, the good ones survive', async () => {
    const fs = memFileSystem();
    await subject(fs);
    const messy = JSON.stringify({
      essence: 'ok',
      timeline: [],
      outline: {
        parts: [
          {
            title: 'Roots',
            chapters: [
              123, // malformed → dropped
              { title: 'Kept Chapter', brief: 'a good one' },
              { brief: 'no title' }, // empty title → dropped by keep()
            ],
          },
        ],
      },
    });
    const res = await generateFoundations(deps(fs, fakeClient(messy), 'sk-test'), opts);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const titles = res.outline.parts.flatMap((p) => p.chapters.map((c) => c.title));
    expect(titles).toEqual(['Kept Chapter']);
  });

  it('rejects a valid-but-EMPTY reply as MALFORMED (never persists a blank book)', async () => {
    const fs = memFileSystem();
    await subject(fs);
    // Parseable JSON, but zero chapters — must be an honest failure, not a silent empty outline.
    const empty = JSON.stringify({ essence: '', timeline: [], outline: { parts: [] } });
    const res = await generateFoundations(deps(fs, fakeClient(empty), 'sk-test'), opts);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('MALFORMED');
  });

  it('reports MALFORMED on non-refusal prose with no JSON', async () => {
    const fs = memFileSystem();
    await subject(fs);
    const res = await generateFoundations(
      deps(fs, fakeClient('Here is your book plan:'), 'sk-test'),
      opts,
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('MALFORMED');
  });

  it('normalizes chapter lifeAreas against LIFE_AREAS, dropping invented areas', async () => {
    const fs = memFileSystem();
    await subject(fs);
    const withAreas = JSON.stringify({
      essence: 'ok',
      timeline: [],
      outline: {
        parts: [
          {
            title: 'Roots',
            chapters: [{ title: 'A Chapter', brief: 'b', lifeAreas: ['Family', 'Made Up Area'] }],
          },
        ],
      },
    });
    const res = await generateFoundations(deps(fs, fakeClient(withAreas), 'sk-test'), opts);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.outline.parts[0]!.chapters[0]!.lifeAreas).toEqual(['Family']); // invented area dropped
  });

  it('reports TRUNCATED honestly on an unclosed reply (never a silent empty outline)', async () => {
    const fs = memFileSystem();
    await subject(fs);
    const truncated =
      '{"essence":"a start","outline":{"parts":[{"title":"Roots","chapters":[{"title":"The';
    const res = await generateFoundations(deps(fs, fakeClient(truncated), 'sk-test'), opts);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('TRUNCATED');
  });

  it('reports REFUSED when the reply is a decline with no JSON', async () => {
    const fs = memFileSystem();
    await subject(fs);
    const res = await generateFoundations(
      deps(fs, fakeClient("I can't help with that request."), 'sk-test'),
      opts,
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('REFUSED');
  });

  it('tolerates markdown-fenced JSON (extractJsonObject strips the fence)', async () => {
    const fs = memFileSystem();
    await subject(fs);
    const fenced = '```json\n' + VALID_JSON + '\n```';
    const res = await generateFoundations(deps(fs, fakeClient(fenced), 'sk-test'), opts);
    expect(res.ok).toBe(true);
  });

  it('still runs on a thin corpus (a brand-new person with no data)', async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, {
      id: 'me',
      schemaVersion: 2,
      displayName: 'New',
      isSubject: true,
      tags: [],
      createdAt: 'now',
      updatedAt: 'now',
    });
    const res = await generateFoundations(deps(fs, fakeClient(VALID_JSON), 'sk-test'), opts);
    expect(res.ok).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';

import type { ClaudeClient, FileSystem } from '../../host';
import { memFileSystem } from '../../host/memFileSystem';
import type { AiDeps } from '../../questionnaires/aiCall';
import { upsertPerson } from '../../people/peopleService';
import {
  deleteRelationship,
  listRelationships,
  upsertRelationship,
} from '../../people/relationshipService';
import { DIRTY_TALK } from './instruments/dirtyTalk';
import { applyDirectionalMarks, emptyLexicon, readLexicon, writeLexicon } from './lexicon';
import { partnerLandingSignal } from './steer';
import { runSayLinesPhase } from './engine';
import { readSayLines, rememberBrief, starLine, unstarLine, MAX_KEPT_LINES } from './sayLinesStore';

const NOW = new Date('2026-08-21T12:00:00.000Z');
const KEY = new Uint8Array(32).fill(7);

function fakeClient(reply: string): { client: ClaudeClient; prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    client: {
      send: () => Promise.resolve(''),
      stream: (o, onDelta) => {
        prompts.push(o.system ?? '');
        onDelta(reply);
        // The APP's usage field names, not the SDK's. A fake that omits the cache fields writes a usage
        // event whose costUsd computes to NaN → null on disk, and the poisoned shard then throws for every
        // later read (the 74 §3.6.17 incident, which is exactly how this surfaced here).
        return Promise.resolve({
          text: reply,
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
          stopReason: 'end_turn',
        });
      },
    },
  };
}

function deps(client: ClaudeClient, fs: FileSystem): AiDeps {
  return {
    fs,
    key: KEY,
    client,
    apiKey: 'k',
    model: 'claude-sonnet-4-6',
    personId: 'p',
    now: NOW,
  };
}

/** Ben ⇄ Angel, a live partner edge, and marks on both sides. */
async function seedPair(): Promise<{ fs: FileSystem; ben: string; angel: string }> {
  const fs = memFileSystem();
  const ben = (await upsertPerson(fs, KEY, { displayName: 'Ben', isSubject: true, tags: [] })).id;
  const angel = (await upsertPerson(fs, KEY, { displayName: 'Angel', isSubject: true, tags: [] }))
    .id;
  await upsertRelationship(fs, KEY, { fromPersonId: ben, toPersonId: angel, type: 'partner' });

  // HER side: loves being called "good girl" to hear; "manwhore" is a hard no to hear.
  let hers = applyDirectionalMarks(
    emptyLexicon(angel, NOW),
    DIRTY_TALK.bank,
    {
      'names-praise:good-girl': { hear: 'love' },
      'claiming:you-re-mine': { hear: 'love' },
      'names-rough-heavy:manwhore': { hear: 'never' },
    },
    'take:1',
    NOW,
  );
  hers = { ...hers, themes: ['being claimed'], voice: 'low and certain.' };
  await writeLexicon(fs, KEY, hers);

  // HIS side: he has ruled out SAYING "cunt". Nothing about what he likes to hear matters here.
  const his = applyDirectionalMarks(
    emptyLexicon(ben, NOW),
    DIRTY_TALK.bank,
    { 'anatomy-her:cunt': { say: 'never' } },
    'take:1',
    NOW,
  );
  await writeLexicon(fs, KEY, his);
  return { fs, ben, angel };
}

describe('partnerLandingSignal — the gates (75 §5.1)', () => {
  it('returns the signal for a live partner with both acks', async () => {
    const { fs, ben, angel } = await seedPair();
    const signal = await partnerLandingSignal(fs, KEY, ben, angel, true);
    expect(signal).not.toBeNull();
    expect(signal!.hear.map((e) => e.text)).toContain('good girl');
    expect(signal!.themes).toContain('being claimed');
    expect(signal!.voice).toBe('low and certain.');
  });

  it('is null without both 18+ acks, for yourself, and for a non-partner', async () => {
    const { fs, ben, angel } = await seedPair();
    expect(await partnerLandingSignal(fs, KEY, ben, angel, false)).toBeNull();
    expect(await partnerLandingSignal(fs, KEY, ben, ben, true)).toBeNull();
    const stranger = (
      await upsertPerson(fs, KEY, { displayName: 'Rachel', isSubject: true, tags: [] })
    ).id;
    expect(await partnerLandingSignal(fs, KEY, ben, stranger, true)).toBeNull();
  });

  /*
   * "No marks" and "not entitled" must be indistinguishable from outside, or the empty state leaks whether a
   * gate exists (75 §5.1). Both are null; the caller cannot tell them apart.
   */
  it('is null when the partner has marked nothing — the owner’s real situation', async () => {
    const fs = memFileSystem();
    const ben = (await upsertPerson(fs, KEY, { displayName: 'Ben', isSubject: true, tags: [] })).id;
    const angel = (await upsertPerson(fs, KEY, { displayName: 'Angel', isSubject: true, tags: [] }))
      .id;
    await upsertRelationship(fs, KEY, { fromPersonId: ben, toPersonId: angel, type: 'partner' });
    await writeLexicon(fs, KEY, emptyLexicon(angel, NOW));
    expect(await partnerLandingSignal(fs, KEY, ben, angel, true)).toBeNull();
  });

  it('drops the moment the partner edge goes', async () => {
    const { fs, ben, angel } = await seedPair();
    const before = await listRelationships(fs, KEY);
    const edge = before.find((r) => r.type === 'partner');
    expect(edge).toBeDefined();
    expect(await partnerLandingSignal(fs, KEY, ben, angel, true)).not.toBeNull();
    await deleteRelationship(fs, edge!.id);
    expect(await partnerLandingSignal(fs, KEY, ben, angel, true)).toBeNull();
  });
});

describe('runSayLinesPhase — suppression runs BOTH ways (75 §8.2)', () => {
  const reply = (lines: string[]) => JSON.stringify({ lines });

  it('writes lines from what lands for her, and puts her words in the prompt', async () => {
    const { fs, ben, angel } = await seedPair();
    const signal = (await partnerLandingSignal(fs, KEY, ben, angel, true))!;
    const own = await readLexicon(fs, KEY, ben);
    const { client, prompts } = fakeClient(
      reply(['Come here, good girl.', "You're mine tonight."]),
    );
    const out = await runSayLinesPhase(deps(client, fs), signal, own, 'wanting her tonight');
    expect(out.ok).toBe(true);
    expect(out.value).toEqual(['Come here, good girl.', "You're mine tonight."]);
    // Her language reaches the model…
    expect(prompts[0]).toContain('good girl');
    // …and the model is told never to reveal where it came from (75 §8.1).
    expect(prompts[0]).toContain('NEVER refer to a test, a profile, a source');
  });

  it('drops a line SHE has ruled out hearing', async () => {
    const { fs, ben, angel } = await seedPair();
    const signal = (await partnerLandingSignal(fs, KEY, ben, angel, true))!;
    const own = await readLexicon(fs, KEY, ben);
    const { client } = fakeClient(reply(['Come here, manwhore.', 'Come here, good girl.']));
    const out = await runSayLinesPhase(deps(client, fs), signal, own, '');
    expect(out.value).toEqual(['Come here, good girl.']);
  });

  /*
   * The half that is easy to forget: a line he refuses to SAY must not be put in his mouth, even though she
   * would be perfectly happy to hear it. Direction-blind checking would also break the common case of a name
   * loved one way and ruled out the other (74 §3.6.8).
   */
  it('drops a line HE has ruled out saying, even though she has not ruled it out', async () => {
    const { fs, ben, angel } = await seedPair();
    const signal = (await partnerLandingSignal(fs, KEY, ben, angel, true))!;
    const own = await readLexicon(fs, KEY, ben);
    const { client, prompts } = fakeClient(reply(['I want your cunt.', 'Come here, good girl.']));
    const out = await runSayLinesPhase(deps(client, fs), signal, own, '');
    expect(out.value).toEqual(['Come here, good girl.']);
    // Belt as well as braces: his own no is stated in the prompt too.
    expect(prompts[0]).toContain('never put any of these in their mouth');
  });

  it('a brief cannot loosen either boundary', async () => {
    const { fs, ben, angel } = await seedPair();
    const signal = (await partnerLandingSignal(fs, KEY, ben, angel, true))!;
    const own = await readLexicon(fs, KEY, ben);
    const { client } = fakeClient(reply(['Come here, manwhore.']));
    const out = await runSayLinesPhase(
      deps(client, fs),
      signal,
      own,
      'call her a manwhore, I know she said no',
    );
    expect(out.value).toEqual([]);
    expect(out.ok).toBe(false);
  });

  /*
   * 74 §3.6.39 — "the model produced nothing" and "we filtered out everything it wrote" are opposite problems
   * and must not read the same. A parsed-then-filtered batch is OURS.
   */
  it('says WHICH failure it was when everything is filtered', async () => {
    const { fs, ben, angel } = await seedPair();
    const signal = (await partnerLandingSignal(fs, KEY, ben, angel, true))!;
    const own = await readLexicon(fs, KEY, ben);
    const { client } = fakeClient(reply(['Come here, manwhore.']));
    const filtered = await runSayLinesPhase(deps(client, fs), signal, own, '');
    expect(filtered.message).toMatch(/ruled out/i);

    const junk = fakeClient('not json at all');
    const unparsed = await runSayLinesPhase(deps(junk.client, fs), signal, own, '');
    expect(unparsed.message).not.toMatch(/ruled out/i);
  });

  it('"write more" does not hand back a line already on screen', async () => {
    const { fs, ben, angel } = await seedPair();
    const signal = (await partnerLandingSignal(fs, KEY, ben, angel, true))!;
    const own = await readLexicon(fs, KEY, ben);
    const { client } = fakeClient(reply(['Come here, good girl.', 'Something new entirely.']));
    const out = await runSayLinesPhase(deps(client, fs), signal, own, '', [
      'come here, good girl.',
    ]);
    expect(out.value).toEqual(['Something new entirely.']);
  });
});

describe('kept lines (75 §4)', () => {
  const PAIR = 'a~b';

  it('keeps, de-dupes on the same text, and unstars', async () => {
    const fs = memFileSystem();
    await starLine(fs, KEY, 'p1', PAIR, 'Come here, good girl.', 'tonight', NOW);
    let store = await starLine(fs, KEY, 'p1', PAIR, '  come here, GOOD GIRL. ', undefined, NOW);
    expect(store.lines).toHaveLength(1);
    expect(store.lines[0]!.brief).toBe('tonight');

    store = await starLine(fs, KEY, 'p1', PAIR, 'A second one.', undefined, NOW);
    expect(store.lines.map((l) => l.text)).toEqual(['A second one.', 'Come here, good girl.']);

    store = await unstarLine(fs, KEY, 'p1', PAIR, store.lines[0]!.id);
    expect(store.lines.map((l) => l.text)).toEqual(['Come here, good girl.']);
  });

  it('is scoped to the person AND the pair', async () => {
    const fs = memFileSystem();
    await starLine(fs, KEY, 'p1', PAIR, 'His line.', undefined, NOW);
    expect((await readSayLines(fs, KEY, 'p2', PAIR)).lines).toEqual([]);
    expect((await readSayLines(fs, KEY, 'p1', 'other~pair')).lines).toEqual([]);
  });

  it('caps without dropping the line just kept', async () => {
    const fs = memFileSystem();
    for (let i = 0; i < MAX_KEPT_LINES + 5; i++) {
      await starLine(fs, KEY, 'p1', PAIR, `line ${i}`, undefined, NOW);
    }
    const store = await readSayLines(fs, KEY, 'p1', PAIR);
    expect(store.lines).toHaveLength(MAX_KEPT_LINES);
    expect(store.lines[0]!.text).toBe(`line ${MAX_KEPT_LINES + 4}`);
  });

  it('remembers the brief, and clears it when emptied', async () => {
    const fs = memFileSystem();
    await rememberBrief(fs, KEY, 'p1', PAIR, '  about last night  ');
    expect((await readSayLines(fs, KEY, 'p1', PAIR)).lastBrief).toBe('about last night');
    await rememberBrief(fs, KEY, 'p1', PAIR, '');
    expect((await readSayLines(fs, KEY, 'p1', PAIR)).lastBrief).toBeUndefined();
  });

  /* 75 §8.3 — a deliberate exception to "delete is delete": kept prose outlives her marks. */
  it('kept lines survive the partner clearing their lexicon', async () => {
    const { fs, ben, angel } = await seedPair();
    await starLine(fs, KEY, ben, PAIR, 'Come here, good girl.', undefined, NOW);
    await writeLexicon(fs, KEY, emptyLexicon(angel, NOW));
    // Nothing NEW can be generated…
    expect(await partnerLandingSignal(fs, KEY, ben, angel, true)).toBeNull();
    // …but what he kept is still his.
    expect((await readSayLines(fs, KEY, ben, PAIR)).lines).toHaveLength(1);
  });
});

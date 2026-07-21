import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import type { ClaudeClient, ClaudeUsage } from '../host';
import { memFileSystem } from '../host/memFileSystem';
import { getInsight, listInsightsForPerson } from '../insights';
import { savePerson } from '../people';
import type { BookChapter, ExclusionItem, Person } from '../schemas';
import { queryUsage } from '../usage';
import { createBook, saveChapter } from './storyService';
import { buildStoryCorpus, corpusText } from './storyCorpus';
import {
  MEMORY_READY_MARKER,
  deleteMemory,
  getMemory,
  getMemoryAttachment,
  getMemoryConversation,
  isMemoryAttachmentPath,
  listMemoryViews,
  openMemoryChat,
  patchMemory,
  runMemoryTurn,
  saveMemory,
  storeMemoryAttachment,
  synthesizeMemory,
} from './storyMemoryService';

const key = generateMasterKey();
const now = new Date('2026-07-20T00:00:00.000Z');

const USAGE: ClaudeUsage = {
  inputTokens: 10,
  outputTokens: 20,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
};

/** A fake client that streams `text` and returns it (with usage) for every call. */
function fakeClient(text: string): ClaudeClient {
  return {
    send: () => Promise.resolve(text),
    stream: (_options, onDelta) => {
      onDelta(text);
      return Promise.resolve({ text, usage: USAGE });
    },
  };
}

/**
 * A fake that returns `title` for the auto-working-title call and `chat` for the biographer reply — a memory
 * turn makes TWO stream calls, and the title call is identifiable by the `short working title` instruction in
 * its messages (the DISTINCTIVE guidance the service appends). `chat` is streamed as the reply (marker-free, so
 * the memory stays `gathering` and the title guard can fire).
 */
function titleAwareClient(map: { title: string; chat: string }): ClaudeClient {
  const isTitleCall = (opts: { messages: { content: unknown }[] }): boolean =>
    opts.messages.some(
      (m) => typeof m.content === 'string' && m.content.includes('short working title'),
    );
  return {
    send: () => Promise.resolve(map.chat),
    stream: (options, onDelta) => {
      const text = isTitleCall(options) ? map.title : map.chat;
      onDelta(text);
      return Promise.resolve({ text, usage: USAGE });
    },
  };
}

const person: Person = {
  id: 'me',
  schemaVersion: 2,
  displayName: 'Ben',
  isSubject: true,
  tags: [],
  createdAt: 'now',
  updatedAt: 'now',
};

async function fresh(): Promise<ReturnType<typeof memFileSystem>> {
  const fs = memFileSystem();
  await savePerson(fs, key, person);
  return fs;
}

/** The deps every memory op takes (a superset; each op reads only what it needs). */
function deps<T extends object>(
  fs: ReturnType<typeof memFileSystem>,
  client: ClaudeClient,
  memoryId: string,
  over: T = {} as T,
) {
  return {
    fs,
    key,
    client,
    apiKey: 'sk' as string | null,
    model: 'claude-sonnet-4-6',
    personId: 'me',
    personName: 'Ben',
    memoryId,
    onDelta: () => {},
    now,
    ...over,
  };
}

/** A valid synthesis reply — note the whitespace-only + off-taxonomy entries the service must filter out. */
function memoryJson(over: { sensitive?: boolean; scene?: string } = {}): string {
  return JSON.stringify({
    title: 'The kitchen that morning',
    narrative: 'I stood at the counter while the rain came down and my mother hummed a tune.',
    approxDate: '1994',
    places: ['the kitchen', '   '],
    people: [{ name: 'my mother' }, { name: '   ' }],
    lifeAreas: ['Family', 'not-a-real-area'],
    emotionalTexture: 'Warm then, bittersweet now.',
    pullQuotes: ["You'll be fine, kiddo.", '  '],
    scene: over.scene ?? 'positiveChildhood',
    ...(over.sensitive ? { sensitive: true } : {}),
  });
}

/** Open a chat then synthesize a ready memory (the common precondition for save/corpus/delete/link tests). */
async function readyMemory(
  fs: ReturnType<typeof memFileSystem>,
  memoryId: string,
  over: { sensitive?: boolean; scene?: string } = {},
): Promise<void> {
  await openMemoryChat(deps(fs, fakeClient('opener'), memoryId));
  const synth = await synthesizeMemory(deps(fs, fakeClient(memoryJson(over)), memoryId));
  if (!synth.ok) throw new Error('synthesis precondition failed');
}

// A. openMemoryChat ---------------------------------------------------------------------------------------

describe('openMemoryChat (64 §14)', () => {
  it('creates a gathering memory with a biographer opener as the first message', async () => {
    const fs = await fresh();
    const res = await openMemoryChat(deps(fs, fakeClient('Take me back to it.'), 'm1'));
    expect(res.ok).toBe(true);
    expect(res.memory.status).toBe('gathering');
    expect(res.conversation.messages).toHaveLength(1);
    expect(res.conversation.messages[0]?.role).toBe('assistant');
    expect(res.conversation.messages[0]?.content).toContain('Take me back to it.');
    // The record is persisted.
    expect(await getMemory(fs, key, 'me', 'm1')).toMatchObject({ id: 'm1', status: 'gathering' });
  });

  it('is idempotent — re-opening a chat with messages resumes without spending', async () => {
    const fs = await fresh();
    await openMemoryChat(deps(fs, fakeClient('First opener.'), 'm1'));
    let called = false;
    const spy: ClaudeClient = {
      send: () => {
        called = true;
        return Promise.resolve('');
      },
      stream: () => {
        called = true;
        return Promise.resolve({ text: '', usage: USAGE });
      },
    };
    const again = await openMemoryChat(deps(fs, spy, 'm1'));
    expect(called).toBe(false); // no second model call
    expect(again.conversation.messages).toHaveLength(1);
    expect(again.conversation.messages[0]?.content).toContain('First opener.');
  });

  it('falls back to a warm static opener with no key (still creates the memory)', async () => {
    const fs = await fresh();
    const res = await openMemoryChat(deps(fs, fakeClient('unused'), 'm1', { apiKey: null }));
    expect(res.ok).toBe(true);
    expect(res.conversation.messages[0]?.content.length).toBeGreaterThan(0);
    expect(await getMemory(fs, key, 'me', 'm1')).toBeTruthy();
    // No key → no spend.
    expect(await queryUsage(fs, key, { from: '2000', to: '2100', type: 'story.memory' })).toEqual(
      [],
    );
  });
});

// B. runMemoryTurn ----------------------------------------------------------------------------------------

describe('runMemoryTurn (66 §3.2)', () => {
  it('persists the person’s message BEFORE the reply — an empty reply is an honest EMPTY failure', async () => {
    const fs = await fresh();
    await openMemoryChat(deps(fs, fakeClient('opener'), 'm1'));
    const res = await runMemoryTurn(
      deps(fs, fakeClient(''), 'm1', { userText: 'It was raining.' }),
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('EMPTY');
    // …but the user's message survived — the persist-user-first fail-safe.
    const convo = await getMemoryConversation(fs, key, 'me', 'm1');
    expect(convo?.messages.some((m) => m.role === 'user' && m.content === 'It was raining.')).toBe(
      true,
    );
  });

  it('appends the assistant reply on a normal turn', async () => {
    const fs = await fresh();
    await openMemoryChat(deps(fs, fakeClient('opener'), 'm1'));
    const res = await runMemoryTurn(
      deps(fs, fakeClient('What did the kitchen smell like?'), 'm1', { userText: 'A memory.' }),
    );
    expect(res.ok).toBe(true);
    const convo = await getMemoryConversation(fs, key, 'me', 'm1');
    const last = convo?.messages.at(-1);
    expect(last?.role).toBe('assistant');
    expect(last?.content).toBe('What did the kitchen smell like?');
  });

  it('a MEMORY_READY marker flips the memory to ready (readyAt) and is STRIPPED from the saved text', async () => {
    const fs = await fresh();
    await openMemoryChat(deps(fs, fakeClient('opener'), 'm1'));
    const reply = `It feels like there's a whole memory here now. ${MEMORY_READY_MARKER}`;
    const res = await runMemoryTurn(deps(fs, fakeClient(reply), 'm1', { userText: 'That’s all.' }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.analysisReady).toBe(true);
    const memory = await getMemory(fs, key, 'me', 'm1');
    expect(memory?.status).toBe('ready');
    expect(memory?.readyAt).toBeTruthy();
    // The marker never persists to the visible transcript.
    const convo = await getMemoryConversation(fs, key, 'me', 'm1');
    const last = convo?.messages.at(-1);
    expect(last?.content).not.toContain(MEMORY_READY_MARKER);
    expect(last?.content).toContain('whole memory here now');
  });
});

// B2. auto working title (§14) ----------------------------------------------------------------------------

describe('auto working title (64 §14)', () => {
  async function usageCount(fs: ReturnType<typeof memFileSystem>): Promise<number> {
    return (await queryUsage(fs, key, { from: '2000', to: '2100', type: 'story.memory' })).length;
  }

  it('a first turn on an untitled gathering draft generates + patches a working title (the second stream call)', async () => {
    const fs = await fresh();
    await openMemoryChat(deps(fs, fakeClient('opener'), 'm1')); // opener records one story.memory event
    const before = await usageCount(fs);
    const res = await runMemoryTurn(
      deps(
        fs,
        titleAwareClient({ title: 'A Working Title', chat: 'What did the kitchen smell like?' }),
        'm1',
        {
          userText: 'A memory about a bicycle in summer.',
        },
      ),
    );
    expect(res.ok).toBe(true);
    const memory = await getMemory(fs, key, 'me', 'm1');
    // No readiness marker → the draft is still gathering, and the title call named it.
    expect(memory?.status).toBe('gathering');
    expect(memory?.title).toBe('A Working Title');
    // The turn metered BOTH the chat reply AND the title call (two story.memory events this turn).
    expect((await usageCount(fs)) - before).toBe(2);
  });

  it('leaves the title empty when the working-title call comes back empty (best-effort — the turn still succeeds)', async () => {
    const fs = await fresh();
    await openMemoryChat(deps(fs, fakeClient('opener'), 'm1'));
    const res = await runMemoryTurn(
      deps(fs, titleAwareClient({ title: '   ', chat: 'What did you see first?' }), 'm1', {
        userText: 'A memory.',
      }),
    );
    expect(res.ok).toBe(true); // a failed title never breaks the turn
    const memory = await getMemory(fs, key, 'me', 'm1');
    expect(memory?.title).toBe(''); // no usable title → left empty (the list shows "New memory")
  });

  it('does NOT overwrite a title that already exists (only untitled gathering drafts get one)', async () => {
    const fs = await fresh();
    await openMemoryChat(deps(fs, fakeClient('opener'), 'm1'));
    await patchMemory(fs, key, 'me', 'm1', { title: 'Preset Title' });
    const before = await usageCount(fs);
    const res = await runMemoryTurn(
      deps(fs, titleAwareClient({ title: 'SHOULD NOT BE USED', chat: 'And then?' }), 'm1', {
        userText: 'More of the memory.',
      }),
    );
    expect(res.ok).toBe(true);
    const memory = await getMemory(fs, key, 'me', 'm1');
    expect(memory?.title).toBe('Preset Title'); // the guard skips an already-titled draft
    // Only the chat turn was metered — NO title call was made (one event, not two).
    expect((await usageCount(fs)) - before).toBe(1);
  });

  it('listMemoryViews returns an untitled gathering draft with a RAW empty title (no fallback)', async () => {
    const fs = await fresh();
    await openMemoryChat(deps(fs, fakeClient('opener'), 'm1'));
    const views = await listMemoryViews(fs, key, 'me');
    const m1 = views.find((v) => v.id === 'm1');
    expect(m1?.status).toBe('gathering');
    expect(m1?.title).toBe(''); // the renderer shows the "New memory" fallback, not the service
  });
});

// C. synthesizeMemory -------------------------------------------------------------------------------------

describe('synthesizeMemory (64 §14)', () => {
  it('parses a valid reply → ready memory with normalized fields (lifeAreas + scene validated)', async () => {
    const fs = await fresh();
    await openMemoryChat(deps(fs, fakeClient('opener'), 'm1'));
    const res = await synthesizeMemory(deps(fs, fakeClient(memoryJson()), 'm1'));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const m = res.memory;
    expect(m.status).toBe('ready');
    expect(m.title).toBe('The kitchen that morning');
    expect(m.narrative).toContain('the rain came down');
    expect(m.approxDate).toBe('1994');
    // Whitespace-only entries filtered out.
    expect(m.places).toEqual(['the kitchen']);
    expect(m.people).toEqual([{ name: 'my mother' }]);
    expect(m.pullQuotes).toEqual(["You'll be fine, kiddo."]);
    // lifeAreas filtered to valid LIFE_AREAS only.
    expect(m.lifeAreas).toEqual(['Family']);
    // A real McAdams scene key is kept.
    expect(m.scene).toBe('positiveChildhood');
  });

  it('drops an invented scene key (never trusts the model raw)', async () => {
    const fs = await fresh();
    await openMemoryChat(deps(fs, fakeClient('opener'), 'm1'));
    const res = await synthesizeMemory(
      deps(fs, fakeClient(memoryJson({ scene: 'notARealScene' })), 'm1'),
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.memory.scene).toBeUndefined();
  });

  it('an empty-narrative reply is an honest failure that overwrites nothing, yet is still metered', async () => {
    const fs = await fresh();
    await openMemoryChat(deps(fs, fakeClient('opener'), 'm1'));
    const res = await synthesizeMemory(
      deps(fs, fakeClient(JSON.stringify({ title: 'x', narrative: '   ' })), 'm1'),
    );
    expect(res.ok).toBe(false);
    // The memory record is untouched (still gathering — no partial write).
    expect((await getMemory(fs, key, 'me', 'm1'))?.status).toBe('gathering');
    // Metered BEFORE the parse — a billed-but-unparseable call is still recorded (the meter-first rule).
    const events = await queryUsage(fs, key, { from: '2000', to: '2100', type: 'story.memory' });
    expect(events.length).toBeGreaterThan(0);
  });
});

// D. saveMemory -------------------------------------------------------------------------------------------

describe('saveMemory (64 §14)', () => {
  it('commits a ready memory → saved + a partner-shared source:"memory" Insight', async () => {
    const fs = await fresh();
    await readyMemory(fs, 'm1');
    const res = await saveMemory({
      fs,
      key,
      personId: 'me',
      memoryId: 'm1',
      memoryEnabled: true,
      now,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.memory.status).toBe('saved');
    expect(res.memory.insightId).toBeTruthy();

    const insights = await listInsightsForPerson(fs, key, 'me');
    const insight = insights.find((i) => i.source === 'memory');
    expect(insight).toBeTruthy();
    expect(insight?.subjectPersonId).toBe('me');
    expect(insight?.approved).toBe(true);
    // A fact carries the narrative, partner-shared by default (the standing owner rule).
    const narrativeFact = insight?.facts.find((f) => f.text.includes('the rain came down'));
    expect(narrativeFact).toBeTruthy();
    expect(narrativeFact?.shareableTypes).toContain('partner');
    expect(narrativeFact?.restricted).toBeUndefined();
  });

  it('a SENSITIVE memory’s facts are restricted (no partner share) + tagged Intimacy', async () => {
    const fs = await fresh();
    await readyMemory(fs, 'm1', { sensitive: true });
    const res = await saveMemory({
      fs,
      key,
      personId: 'me',
      memoryId: 'm1',
      memoryEnabled: true,
      now,
    });
    expect(res.ok).toBe(true);
    const insight = (await listInsightsForPerson(fs, key, 'me')).find((i) => i.source === 'memory');
    expect(insight).toBeTruthy();
    for (const fact of insight!.facts) {
      expect(fact.restricted).toBe(true);
      expect(fact.shareableTypes).toBeUndefined();
      expect(fact.lifeArea).toBe('Intimacy');
    }
  });

  it('memoryEnabled:false saves the memory but writes NO Insight', async () => {
    const fs = await fresh();
    await readyMemory(fs, 'm1');
    const res = await saveMemory({
      fs,
      key,
      personId: 'me',
      memoryId: 'm1',
      memoryEnabled: false,
      now,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.memory.status).toBe('saved');
      expect(res.memory.insightId).toBeUndefined();
    }
    expect(await listInsightsForPerson(fs, key, 'me')).toEqual([]);
  });

  it('re-saving reuses the same Insight id (no duplicate) and applies edits', async () => {
    const fs = await fresh();
    await readyMemory(fs, 'm1');
    const first = await saveMemory({
      fs,
      key,
      personId: 'me',
      memoryId: 'm1',
      memoryEnabled: true,
      now,
    });
    if (!first.ok) throw new Error('first save failed');
    const insightId = first.memory.insightId!;

    const second = await saveMemory({
      fs,
      key,
      personId: 'me',
      memoryId: 'm1',
      memoryEnabled: true,
      edits: { title: 'A renamed memory', narrative: 'A revised account of that morning.' },
      now,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.memory.insightId).toBe(insightId); // stable id, not a new one
    expect(second.memory.title).toBe('A renamed memory');
    expect(second.memory.narrative).toBe('A revised account of that morning.');
    // Exactly one memory insight remains.
    expect(
      (await listInsightsForPerson(fs, key, 'me')).filter((i) => i.source === 'memory'),
    ).toHaveLength(1);
  });

  it('refuses to save a memory still gathering', async () => {
    const fs = await fresh();
    await openMemoryChat(deps(fs, fakeClient('opener'), 'm1')); // gathering, never synthesized
    const res = await saveMemory({
      fs,
      key,
      personId: 'me',
      memoryId: 'm1',
      memoryEnabled: true,
      now,
    });
    expect(res.ok).toBe(false);
  });
});

// E. corpus -----------------------------------------------------------------------------------------------

describe('buildStoryCorpus — saved memories feed the biographer (64 §14 / §5.1)', () => {
  it('includes a SAVED memory as a {kind:"memory"} source; excludes unsaved; a source exclusion drops it', async () => {
    const fs = await fresh();
    await readyMemory(fs, 'm1');
    await saveMemory({ fs, key, personId: 'me', memoryId: 'm1', memoryEnabled: true, now });
    // A second memory left ready-but-unsaved must contribute nothing.
    await readyMemory(fs, 'm2');

    const corpus = await buildStoryCorpus(fs, key, 'me', 'b1');
    const memoryItems = corpus.items.filter((i) => i.sourceRef.kind === 'memory');
    expect(memoryItems.map((i) => i.sourceRef.id)).toEqual(['m1']); // only the saved one
    expect(corpusText(corpus)).toContain('the rain came down');

    // A `source` exclusion on the memory id drops it from the corpus (§3.3).
    const exclusions: ExclusionItem[] = [
      { id: 'e1', kind: 'source', value: 'm1', createdAt: 'now' },
    ];
    const filtered = await buildStoryCorpus(fs, key, 'me', 'b1', exclusions);
    expect(filtered.items.some((i) => i.sourceRef.kind === 'memory')).toBe(false);
  });
});

// F. deleteMemory -----------------------------------------------------------------------------------------

describe('deleteMemory (64 §14)', () => {
  it('purges the folder AND the derived Insight — a deleted memory truly forgets', async () => {
    const fs = await fresh();
    await readyMemory(fs, 'm1');
    const saved = await saveMemory({
      fs,
      key,
      personId: 'me',
      memoryId: 'm1',
      memoryEnabled: true,
      now,
    });
    if (!saved.ok) throw new Error('save failed');
    const insightId = saved.memory.insightId!;
    expect(await getInsight(fs, key, 'me', insightId)).toBeTruthy();

    await deleteMemory(fs, key, 'me', 'm1');
    expect(await getMemory(fs, key, 'me', 'm1')).toBeNull();
    expect(await getInsight(fs, key, 'me', insightId)).toBeNull();
    expect(await listInsightsForPerson(fs, key, 'me')).toEqual([]);
  });
});

// G. listMemoryViews --------------------------------------------------------------------------------------

function chapter(over: Partial<BookChapter> & { id: string }): BookChapter {
  return {
    schemaVersion: 1,
    partId: 'p1',
    order: 0,
    title: 'A Chapter',
    markdown: 'prose',
    revision: 1,
    status: 'reviewed',
    sourceSignature: '',
    provenance: [],
    protectedBlocks: [],
    pinnedQuotes: [],
    imagePlacements: [],
    ...over,
  };
}

describe('listMemoryViews — the "wove into <chapter>" linkage (64 §14)', () => {
  it('links a saved memory to the chapter whose provenance cites its Insight; leaves an uncited one blank', async () => {
    const fs = await fresh();
    // A saved memory that a chapter will cite.
    await readyMemory(fs, 'm1');
    const saved = await saveMemory({
      fs,
      key,
      personId: 'me',
      memoryId: 'm1',
      memoryEnabled: true,
      now,
    });
    if (!saved.ok) throw new Error('save failed');
    const insightId = saved.memory.insightId!;
    // A second saved memory that NO chapter cites.
    await readyMemory(fs, 'm2');
    await saveMemory({ fs, key, personId: 'me', memoryId: 'm2', memoryEnabled: true, now });

    const book = await createBook(fs, key, {
      personId: 'me',
      type: 'biography',
      title: 'The Story of Ben',
      config: { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true },
      now,
    });
    await saveChapter(
      fs,
      key,
      'me',
      book.id,
      chapter({
        id: 'c1',
        title: 'First Words',
        provenance: [{ anchor: 'p0', refs: [{ kind: 'insight', id: insightId }] }],
      }),
    );

    const views = await listMemoryViews(fs, key, 'me');
    const byId = new Map(views.map((v) => [v.id, v]));
    expect(byId.get('m1')?.wroteIntoChapterTitle).toBe('First Words');
    expect(byId.get('m2')?.wroteIntoChapterTitle).toBeUndefined();
  });
});

// H. attachments ------------------------------------------------------------------------------------------

describe('memory attachments (64 §14 — the Sessions precedent)', () => {
  it('isMemoryAttachmentPath guards the memory-attachments subtree', () => {
    expect(isMemoryAttachmentPath('people/me/story/memories/m1/attachments/a1.enc')).toBe(true);
    expect(isMemoryAttachmentPath('people/me/story/memories/m1/memory.enc')).toBe(false);
    expect(
      isMemoryAttachmentPath('people/me/story/memories/m1/attachments/../../secrets.enc'),
    ).toBe(false);
    expect(isMemoryAttachmentPath('config/recovery.enc')).toBe(false);
  });

  it('stores + reads back a valid image; rejects a non-image mime and an oversized file', async () => {
    const fs = await fresh();
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG magic
    const stored = await storeMemoryAttachment(fs, key, 'me', 'm1', bytes, 'image/png', {
      width: 4,
      height: 2,
    });
    expect('id' in stored && stored.kind === 'image').toBe(true);
    if (!('id' in stored)) throw new Error('store failed');
    expect(stored.mime).toBe('image/png');
    expect(stored.width).toBe(4);
    expect(isMemoryAttachmentPath(stored.path)).toBe(true);
    const back = await getMemoryAttachment(fs, key, stored.path);
    expect(back && Array.from(back)).toEqual(Array.from(bytes)); // round-trips through encryption

    const badMime = await storeMemoryAttachment(fs, key, 'me', 'm1', bytes, 'application/pdf');
    expect('ok' in badMime && badMime.reason).toBe('UNSUPPORTED');

    const tooBig = await storeMemoryAttachment(
      fs,
      key,
      'me',
      'm1',
      new Uint8Array(5 * 1024 * 1024 + 1),
      'image/png',
    );
    expect('ok' in tooBig && tooBig.reason).toBe('TOO_LARGE');
  });
});

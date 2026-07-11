import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { ClaudeClient, FileSystem } from '../host';
import type { Person, TogetherSession } from '../schemas';
import { savePerson, saveRelationship } from '../people';
import { TOGETHER_CATALOG, getTogetherGuide, togetherCatalogFor } from './togetherCatalog';
import { createSession, guideStepFor, listMessages, togetherGuideView } from './togetherService';
import { runTogetherTurn } from './togetherChatService';
import { buildTogetherSystemPrompt } from './togetherPromptBuilder';

const key = generateMasterKey();
const BEN = 'ben';
const ANGEL = 'angel';
const NOW = new Date('2026-07-11T12:00:00.000Z');

function person(id: string, displayName: string): Person {
  return {
    id,
    schemaVersion: 1,
    displayName,
    isSubject: true,
    tags: [],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}

async function seed(fs: FileSystem, guideId?: string): Promise<TogetherSession> {
  await savePerson(fs, key, person(BEN, 'Ben'));
  await savePerson(fs, key, person(ANGEL, 'Angel'));
  await saveRelationship(fs, key, {
    id: 'rel-partner',
    schemaVersion: 2,
    fromPersonId: BEN,
    toPersonId: ANGEL,
    type: 'partner',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  });
  return createSession(
    fs,
    key,
    { initiatorPersonId: BEN, participantIds: [BEN, ANGEL], ...(guideId ? { guideId } : {}) },
    NOW,
  );
}

function replyClient(reply: string): ClaudeClient {
  return {
    send: () => Promise.resolve('ok'),
    stream: (_opts, onDelta) => {
      onDelta(reply);
      return Promise.resolve({
        text: reply,
        usage: { inputTokens: 10, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 },
      });
    },
  };
}

describe('togetherCatalog (§3.10)', () => {
  it('holds the adult invariant: adult === (group === together-desire)', () => {
    for (const guide of TOGETHER_CATALOG) {
      expect(Boolean(guide.adult)).toBe(guide.group === 'together-desire');
    }
  });

  it('every entry has unique id, an opener, an addendum leading with the not-therapy frame, and steps iff structured', () => {
    const ids = new Set<string>();
    for (const g of TOGETHER_CATALOG) {
      expect(ids.has(g.id)).toBe(false);
      ids.add(g.id);
      expect(g.openingMessage.length).toBeGreaterThan(0);
      expect(g.systemPromptAddendum).toContain('NOT');
      expect(g.systemPromptAddendum.toLowerCase()).toContain('not couples therapy');
      if (g.kind === 'structured') expect((g.steps ?? []).length).toBeGreaterThan(0);
      else expect(g.steps).toBeUndefined();
    }
  });

  it('withholds the 18+ desire group unless allowAdult (host-side, Phase E)', () => {
    const noAdult = togetherCatalogFor({ allowAdult: false });
    expect(noAdult.every((e) => !e.adult)).toBe(true);
    // Phase E has no desire entries yet, but the filter is the host-side gate F relies on.
    const withAdult = togetherCatalogFor({ allowAdult: true });
    expect(withAdult.length).toBeGreaterThanOrEqual(noAdult.length);
  });

  it('resolves a guide + its renderer view', () => {
    expect(getTogetherGuide('love-maps')?.title).toBe('Love Maps');
    expect(getTogetherGuide('nope')).toBeUndefined();
    const view = togetherGuideView('love-maps');
    expect(view?.kind).toBe('structured');
    expect((view?.steps ?? []).length).toBeGreaterThan(0);
    expect(togetherGuideView(undefined)).toBeUndefined();
  });
});

describe('guided couples session wiring (§3.10)', () => {
  it('seeds the guide’s STATIC opener as a shared coach message (no model call)', async () => {
    const fs = memFileSystem();
    const session = await seed(fs, 'love-maps');
    const messages = await listMessages(fs, key, session.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe('assistant');
    expect(messages[0]?.content).toContain('Love Maps');
    expect(messages[0]?.privateAside).toBeUndefined();
  });

  it('appends the guide addendum + the step convention AFTER context, only for a structured guide', async () => {
    const fs = memFileSystem();
    const session = await seed(fs, 'love-maps');
    const prompt = await buildTogetherSystemPrompt(fs, key, session);
    expect(prompt).toContain('Love Maps'); // the addendum
    expect(prompt).toContain('[[SELFOS:STEP:'); // the step convention (structured)
    // Order: the facilitator addendum precedes the guide addendum precedes FORMATTING.
    expect(prompt.indexOf('facilitating a shared conversation')).toBeLessThan(
      prompt.indexOf('turn-taking exchange'),
    );

    // A chat guide gets the addendum but NO step convention.
    const chatSession = await seed(memFileSystem(), 'appreciation-exchange');
    const chatPrompt = await buildTogetherSystemPrompt(memFileSystem(), key, chatSession);
    expect(chatPrompt).not.toContain('[[SELFOS:STEP:');
  });

  it('derives the current step from the newest coach message’s stamped step (never stored on the session)', async () => {
    const fs = memFileSystem();
    const session = await seed(fs, 'love-maps');
    // A couples turn whose coach reply declares step 1 → the message is stamped guideStep 1.
    await runTogetherTurn({
      fs,
      key,
      client: replyClient('Let’s begin. [[SELFOS:STEP:1]]'),
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      session,
      authorPersonId: BEN,
      userText: 'ready',
      onDelta: () => {},
      now: NOW,
    });
    const messages = await listMessages(fs, key, session.id);
    // The step marker is stripped from the visible text but stamped on the message.
    expect(JSON.stringify(messages)).not.toContain('SELFOS:STEP');
    const coach = messages.filter((m) => m.role === 'assistant');
    expect(coach[coach.length - 1]?.guideStep).toBe(1);
    expect(guideStepFor(messages)).toBe(1);
  });

  it('never stamps a step from a PRIVATE aside reply (§3.6)', async () => {
    const fs = memFileSystem();
    const session = await seed(fs, 'love-maps');
    await runTogetherTurn({
      fs,
      key,
      client: replyClient('Just between us. [[SELFOS:STEP:2]]'),
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      session,
      authorPersonId: BEN,
      userText: 'a private thought',
      privateAside: true,
      onDelta: () => {},
      now: NOW,
    });
    const messages = await listMessages(fs, key, session.id);
    expect(messages.every((m) => m.guideStep === undefined)).toBe(true);
    expect(guideStepFor(messages)).toBe(0);
  });
});

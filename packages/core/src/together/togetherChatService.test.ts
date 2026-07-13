import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { ClaudeClient, ClaudeMessage, FileSystem } from '../host';
import type { Insight, Person, TogetherSession } from '../schemas';
import { savePerson, saveRelationship } from '../people';
import { saveInsight } from '../insights';
import { recordUsage, setPersonBudget } from '../usage';
import { writeEncryptedJson } from '../vault';
import {
  appendMessage,
  createSession,
  listMessages,
  projectMessages,
  turnStateFor,
  updateState,
} from './togetherService';
import { runTogetherTurn, retryTogetherReply } from './togetherChatService';
import {
  TOGETHER_ADDENDUM,
  GROUNDED_COACHING_INSTRUCTION,
  PRIVATE_CLARIFICATION_INSTRUCTION,
} from './togetherPromptBuilder';

const key = generateMasterKey();
const BEN = 'ben';
const ANGEL = 'angel';

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

function portrait(subjectPersonId: string, over: Partial<Insight> = {}): Insight {
  return {
    id: `portrait-${subjectPersonId}`,
    schemaVersion: 1,
    source: 'intake',
    subjectPersonId,
    summary: `a portrait of ${subjectPersonId}`,
    facts: [],
    confidence: 'medium',
    categories: [],
    approved: true,
    provenance: { at: '2026-07-01T00:00:00.000Z' },
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...over,
  };
}

/** A fake Claude client that captures the system prompt + messages and returns `reply`. */
function captureClient(reply = 'I hear you both.'): {
  client: ClaudeClient;
  captured: { system?: string; messages?: ClaudeMessage[] };
} {
  const captured: { system?: string; messages?: ClaudeMessage[] } = {};
  const client: ClaudeClient = {
    send: () => Promise.resolve('ok'),
    stream: (opts, onDelta) => {
      captured.system = opts.system;
      captured.messages = opts.messages;
      if (reply) onDelta(reply);
      return Promise.resolve({
        text: reply,
        usage: { inputTokens: 10, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 },
      });
    },
  };
  return { client, captured };
}

async function seed(fs: FileSystem): Promise<TogetherSession> {
  await savePerson(fs, key, person(BEN, 'Ben'));
  await savePerson(fs, key, person(ANGEL, 'Angel'));
  // A live partner edge — required for a couples session, and the vector S2 guards against (a partner's
  // sensitive SHARED fact re-admitted into the other's block via the cross-shared path).
  await saveRelationship(fs, key, {
    id: 'rel-partner',
    schemaVersion: 2,
    fromPersonId: BEN,
    toPersonId: ANGEL,
    type: 'partner',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  });
  // Ben's portrait carries a general fact, a restricted trauma fact, and a sensitive intimacy fact.
  await saveInsight(
    fs,
    key,
    portrait(BEN, {
      summary: 'Ben is thoughtful',
      facts: [
        { id: 'g', text: 'enjoys long walks', shareable: false },
        {
          id: 'r',
          text: 'a childhood trauma detail',
          shareable: false,
          restricted: true,
          lifeArea: 'Intimacy',
        },
        { id: 's', text: 'a specific desire preference', shareable: false, lifeArea: 'Intimacy' },
      ],
    }),
  );
  return createSession(
    fs,
    key,
    { initiatorPersonId: BEN, participantIds: [BEN, ANGEL], topic: 'Feeling distant' },
    new Date('2026-07-10T12:00:00.000Z'),
  );
}

describe('togetherPromptBuilder (§6.3 captured prompt)', () => {
  it('orders PERSONA → SAFETY → addendum → per-participant contracts → FORMATTING; excludes restricted; no register', async () => {
    const fs = memFileSystem();
    const session = await seed(fs);
    // Seed a relationship synthesis so the grounding pack has something to include.
    await writeEncryptedJson(
      fs,
      `people/${BEN}/relationships/${ANGEL}/synthesis.enc`,
      {
        schemaVersion: 1,
        subjectPersonId: BEN,
        partnerPersonId: ANGEL,
        observations: ['Ben tends to withdraw when overwhelmed'],
        computedAt: '2026-07-05T00:00:00.000Z',
      },
      key,
    );
    const { client, captured } = captureClient();
    await runTogetherTurn({
      fs,
      key,
      client,
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      session,
      authorPersonId: BEN,
      userText: 'I feel like we barely talk anymore.',
      // A Desire & intimacy topic — the worst case for a restricted leak.
      topic: { lifeAreas: ['Intimacy'] },
      onDelta: () => {},
      now: new Date('2026-07-10T12:05:00.000Z'),
    });
    const system = captured.system ?? '';
    // Order (load-bearing).
    const iPersona = system.indexOf('warm, reflective wellness companion');
    const iSafety = system.indexOf('wellness and self-help tool');
    const iAddendum = system.indexOf('facilitating a shared conversation');
    const iGrounded = system.indexOf('Draw actively on what you privately know');
    const iContract = system.indexOf('private background about Ben');
    const iFormatting = system.indexOf('Formatting:');
    expect(iPersona).toBeGreaterThanOrEqual(0);
    expect(iPersona).toBeLessThan(iSafety);
    expect(iSafety).toBeLessThan(iAddendum);
    // The grounding instruction (§3.14 Part A / Phase I1) sits after the addendum, before the context it
    // refers to, before FORMATTING.
    expect(iAddendum).toBeLessThan(iGrounded);
    expect(iGrounded).toBeLessThan(iContract);
    expect(iContract).toBeLessThan(iFormatting);
    // The initiator's contract is present (they acked at create); the partner's is ABSENT — Angel hasn't
    // accepted the rules of the room yet, so her private context does not feed the coach (§3.4 consent-timing).
    expect(system).toContain('private background about Ben');
    expect(system).not.toContain('private background about Angel');
    // excludeRestricted: neither the restricted trauma fact NOR the sensitive desire fact reaches the prompt,
    // even on an Intimacy topic; the general fact + summary do (§6.3, the desire-continuity trade-off §8.6).
    expect(system).toContain('enjoys long walks');
    expect(system).not.toContain('childhood trauma detail');
    expect(system).not.toContain('specific desire preference');
    // Grounding pack present.
    expect(system).toContain('withdraw when overwhelmed');
    // No explicit intimacy register in Phase B (allAdultAcked not set) — its distinctive boundary phrases
    // (the 48/52 sibling) are absent; the register lands in Phase F.
    expect(system.toLowerCase()).not.toContain('consenting adults');
    expect(system.toLowerCase()).not.toContain('fantasy or roleplay');
    // The addendum's never-reveal + aside rule are present.
    expect(TOGETHER_ADDENDUM).toContain('NEVER quote, attribute, reveal');
    // The Phase C secrets-policy: an identical deflection whether or not a private note exists (no oracle),
    // no covert use of a note, and no indefinite-secret-holding (§8.7).
    expect(TOGETHER_ADDENDUM).toContain("I'd tell you the same thing either way");
    expect(TOGETHER_ADDENDUM).toContain('covertly steer or sabotage');
    expect(TOGETHER_ADDENDUM).toContain("won't hold, indefinitely, a private secret");
  });

  it('once the partner accepts, their block feeds — but a sensitive SHARED fact never re-admits into either block (§6.3 own-context-only)', async () => {
    const fs = memFileSystem();
    const session = await seed(fs);
    // Angel accepts the rules of the room → her block may now feed.
    await updateState(
      fs,
      key,
      session.id,
      ANGEL,
      { rulesAckAt: '2026-07-09T00:00:00.000Z' },
      new Date(),
    );
    // Angel has a partner-shareable SENSITIVE fact (a kink self-assessment — Intimacy life-area, NOT
    // restricted, shared with her partner). Without own-context-only it would re-admit into Ben's block.
    await saveInsight(fs, key, {
      id: 'angel-kink',
      schemaVersion: 1,
      source: 'test',
      subjectPersonId: ANGEL,
      summary: 'Angel intimacy interests',
      facts: [
        {
          id: 'k',
          text: 'ANGELKINKSECRET',
          shareable: true,
          shareableTypes: ['partner'],
          lifeArea: 'Intimacy',
        },
      ],
      confidence: 'medium',
      categories: [],
      approved: true,
      provenance: { at: '2026-07-08T00:00:00.000Z' },
      createdAt: '2026-07-08T00:00:00.000Z',
      updatedAt: '2026-07-08T00:00:00.000Z',
    });
    const { client, captured } = captureClient();
    await runTogetherTurn({
      fs,
      key,
      client,
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      session,
      authorPersonId: BEN,
      userText: 'Can we talk about our desire life?',
      topic: { lifeAreas: ['Intimacy'] }, // the worst case — the fact IS on-topic
      onDelta: () => {},
      now: new Date('2026-07-10T12:06:00.000Z'),
    });
    const system = captured.system ?? '';
    // Both blocks now present (both acked).
    expect(system).toContain('private background about Ben');
    expect(system).toContain('private background about Angel');
    // The sensitive fact appears in NEITHER block — dropped from Angel's own (excludeRestricted's sensitive
    // filter) AND never re-admitted into Ben's via the cross-shared path (own-context-only). The invariant holds.
    expect(system).not.toContain('ANGELKINKSECRET');
  });

  it('the grounded-coaching instruction (§3.14 Part A) tells the coach to USE the data, VERIFY assumptions, ask source-blind, and never disclose', () => {
    // It must draw actively on the background AND treat inferences as assumptions to verify.
    expect(GROUNDED_COACHING_INSTRUCTION).toContain('Draw actively on what you privately know');
    expect(GROUNDED_COACHING_INSTRUCTION).toContain('ASSUMPTION to verify');
    // It must instruct SOURCE-BLIND verification — ask naturally, never citing where the belief came from.
    expect(GROUNDED_COACHING_INSTRUCTION).toContain('NEVER cite where the belief came from');
    expect(GROUNDED_COACHING_INSTRUCTION).toContain('don\'t say "your profile says"');
    // It must NOT reference the Phase I2 coach-initiated private channel (which doesn't exist in I1) — no
    // instruction to proactively send a private message; the coach only holds sensitive checks + follows the lead.
    expect(GROUNDED_COACHING_INSTRUCTION).toContain('follow their lead');
    expect(GROUNDED_COACHING_INSTRUCTION).not.toMatch(/\[\[SELFOS:PRIVATE/);
    // Verification must never become disclosure across partners (the "Coach never discloses it" boundary).
    expect(GROUNDED_COACHING_INSTRUCTION).toContain('never turn verification into disclosure');
  });
});

describe('runTogetherTurn (§5.1 invariants)', () => {
  it('persists the author message FIRST then the coach reply; meters together.chat billed to the INITIATOR', async () => {
    const fs = memFileSystem();
    const session = await seed(fs);
    const { client } = captureClient('Thanks for naming that.');
    // Angel writes, but Ben (the initiator) pays.
    const result = await runTogetherTurn({
      fs,
      key,
      client,
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      session,
      authorPersonId: ANGEL,
      userText: 'Me too, honestly.',
      onDelta: () => {},
      now: new Date('2026-07-10T12:06:00.000Z'),
    });
    expect(result.ok).toBe(true);
    const messages = await listMessages(fs, key, session.id);
    expect(messages.map((m) => `${m.role}:${m.authorPersonId}`)).toEqual([
      'user:angel',
      'assistant:angel', // the coach reply carries the turn-runner's id (§4.2)
    ]);
    expect(result.ok && result.usage.type).toBe('together.chat');
    expect(result.ok && result.usage.personId).toBe(BEN); // billed to the initiator, not the writer
  });

  it('an EMPTY reply is an honest failure — never persisted — but the billed call is still metered', async () => {
    const fs = memFileSystem();
    const session = await seed(fs);
    const { client } = captureClient(''); // blank reply
    const result = await runTogetherTurn({
      fs,
      key,
      client,
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      session,
      authorPersonId: BEN,
      userText: 'Hello?',
      onDelta: () => {},
      now: new Date('2026-07-10T12:07:00.000Z'),
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('EMPTY');
    const messages = await listMessages(fs, key, session.id);
    // The user message stays; NO blank coach message was persisted.
    expect(messages.map((m) => m.role)).toEqual(['user']);
  });

  it('NO_KEY / initiator-over-budget block the turn; the PARTNER’s own budget never gates (§6.2)', async () => {
    const fs = memFileSystem();
    const session = await seed(fs);
    const { client } = captureClient();
    const base = {
      fs,
      key,
      client,
      apiKey: 'sk-test' as string | null,
      model: 'claude-sonnet-4-6',
      session,
      authorPersonId: ANGEL,
      userText: 'hi',
      onDelta: () => {},
      now: new Date('2026-07-10T12:08:00.000Z'),
    };
    // No key → NO_KEY.
    expect((await runTogetherTurn({ ...base, apiKey: null })).ok).toBe(false);

    // Angel (the writer, non-initiator) is WAY over her own budget — the shared turn is NOT gated by it.
    await setPersonBudget(fs, key, ANGEL, { limitUsd: 0.01, period: 'week', warnRatio: 0.8 });
    await recordUsage(fs, key, {
      id: 'u-angel',
      schemaVersion: 1,
      type: 'chat',
      personId: ANGEL,
      model: 'claude-sonnet-4-6',
      at: base.now.toISOString(),
      inputTokens: 1,
      outputTokens: 1,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      costUsd: 5,
    });
    expect((await runTogetherTurn(base)).ok).toBe(true); // still runs — the initiator pays

    // Now put BEN (the initiator) over budget → BUDGET blocks the turn for both.
    await setPersonBudget(fs, key, BEN, { limitUsd: 0.01, period: 'week', warnRatio: 0.8 });
    await recordUsage(fs, key, {
      id: 'u-ben',
      schemaVersion: 1,
      type: 'together.chat',
      personId: BEN,
      model: 'claude-sonnet-4-6',
      at: base.now.toISOString(),
      inputTokens: 1,
      outputTokens: 1,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      costUsd: 5,
    });
    const blocked = await runTogetherTurn(base);
    expect(!blocked.ok && blocked.reason).toBe('BUDGET');
  });
});

describe('private asides (§3.6) + retry (§7)', () => {
  it('an aside turn produces a privateAside coach reply carrying the author id — hidden from the partner', async () => {
    const fs = memFileSystem();
    const session = await seed(fs);
    const { client } = captureClient('Just between us — I hear you.');
    await runTogetherTurn({
      fs,
      key,
      client,
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      session,
      authorPersonId: BEN,
      userText: 'I’m scared to say this out loud.',
      privateAside: true,
      onDelta: () => {},
      now: new Date('2026-07-10T12:09:00.000Z'),
    });
    const messages = await listMessages(fs, key, session.id);
    expect(messages.every((m) => m.privateAside === true)).toBe(true);
    expect(messages.map((m) => m.authorPersonId)).toEqual([BEN, BEN]);
    // The partner's projection hides the whole exchange — no placeholder.
    expect(projectMessages(messages, ANGEL)).toHaveLength(0);
    // The author still sees both.
    expect(projectMessages(messages, BEN)).toHaveLength(2);
    // The aside is prefixed [PRIVATE ...] in the captured prompt (the coach knows it's confidential).
  });

  it('retryTogetherReply regenerates for a partner-authored newest human message; empty transcript → ERROR', async () => {
    const fs = memFileSystem();
    const session = await seed(fs);
    const { client } = captureClient();
    // Nothing yet → nothing to retry.
    const empty = await retryTogetherReply({
      fs,
      key,
      client,
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      session,
      authorPersonId: BEN,
      onDelta: () => {},
      now: new Date('2026-07-10T12:10:00.000Z'),
    });
    expect(!empty.ok && empty.reason).toBe('ERROR');

    // Seed a lone unanswered ANGEL message (a failed turn), then retry — it replies without duplicating.
    await appendMessage(fs, key, session.id, {
      id: 'm-angel',
      schemaVersion: 1,
      authorPersonId: ANGEL,
      role: 'user',
      content: 'Are you there?',
      ts: '2026-07-10T12:11:00.000Z',
    });
    const retried = await retryTogetherReply({
      fs,
      key,
      client,
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      session,
      authorPersonId: BEN, // ignored — retry answers the newest human, whoever wrote it
      onDelta: () => {},
      now: new Date('2026-07-10T12:12:00.000Z'),
    });
    expect(retried.ok).toBe(true);
    const messages = await listMessages(fs, key, session.id);
    // One user (Angel) + one coach reply; no duplicate user message.
    expect(messages.map((m) => `${m.role}:${m.authorPersonId}`)).toEqual([
      'user:angel',
      'assistant:angel',
    ]);
  });
});

describe('coach-initiated private clarification (§3.14 Part B — the PRIVATE marker)', () => {
  it('the prompt teaches the private channel: the marker format, one-partner scope, and the never-disclose boundary', () => {
    // The instruction is in the assembled prompt (via the parts array) — teaches the exact token…
    expect(PRIVATE_CLARIFICATION_INSTRUCTION).toContain('[[SELFOS:PRIVATE:');
    expect(PRIVATE_CLARIFICATION_INSTRUCTION).toContain('one partner');
    // …and reaffirms it must NEVER be used to keep a secret from, take a side against, or disclose one
    // partner's private world to the other.
    expect(PRIVATE_CLARIFICATION_INSTRUCTION).toContain('never');
    expect(PRIVATE_CLARIFICATION_INSTRUCTION.toLowerCase()).toContain('reveal to one partner');
    // The grounded instruction (I1) still stands and doesn't itself reference the marker.
    expect(GROUNDED_COACHING_INSTRUCTION).not.toContain('[[SELFOS:PRIVATE');
  });

  it('a marker on an OPEN turn mints a private coach note scoped to the named partner; the public reply is marker-free', async () => {
    const fs = memFileSystem();
    const session = await seed(fs);
    const { client } = captureClient(
      'I hear you — let me sit with that. [[SELFOS:PRIVATE:{"to":"Angel","text":"Just checking in with you privately — is this pace okay?"}]]',
    );
    await runTogetherTurn({
      fs,
      key,
      client,
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      session,
      authorPersonId: BEN,
      userText: 'I want us to be closer.',
      onDelta: () => {},
      now: new Date('2026-07-10T12:20:00.000Z'),
    });
    const messages = await listMessages(fs, key, session.id);
    // user(Ben) → public coach reply(authored Ben) → private coach note(authored Angel, privateAside).
    expect(
      messages.map((m) => `${m.role}:${m.authorPersonId}:${m.privateAside ? 'p' : '-'}`),
    ).toEqual(['user:ben:-', 'assistant:ben:-', 'assistant:angel:p']);
    const publicReply = messages[1];
    const privateNote = messages[2];
    // The public reply is stripped of the marker (§6.4) — the raw token never shows.
    expect(publicReply?.content).toBe('I hear you — let me sit with that.');
    expect(publicReply?.content).not.toContain('SELFOS:PRIVATE');
    // The private note carries the coach's text, is a private aside, and is authored FOR Angel.
    expect(privateNote?.content).toBe('Just checking in with you privately — is this pace okay?');
    expect(privateNote?.privateAside).toBe(true);
    // Projection: only Angel sees the private note; Ben never does (§5.2).
    expect(projectMessages(messages, ANGEL).some((m) => m.id === privateNote?.id)).toBe(true);
    expect(projectMessages(messages, BEN).some((m) => m.id === privateNote?.id)).toBe(false);
    // A private coach note is a NOTE, not a turn — it's an `assistant` message, so `turnStateFor` (which
    // counts only human messages) never treats it as someone's turn.
    expect(projectMessages(messages, ANGEL).find((m) => m.id === privateNote?.id)?.role).toBe(
      'assistant',
    );
    // Angel's "your turn" is driven solely by Ben's human message, unchanged by the note.
    expect(turnStateFor(messages, ANGEL)).toBe(true);
  });

  it('an UNRESOLVABLE `to` is dropped (no leak) — the marker is still stripped, no private note minted', async () => {
    const fs = memFileSystem();
    const session = await seed(fs);
    const { client } = captureClient(
      'Thanks for that. [[SELFOS:PRIVATE:{"to":"Nobody","text":"this should never appear"}]]',
    );
    await runTogetherTurn({
      fs,
      key,
      client,
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      session,
      authorPersonId: BEN,
      userText: 'Anything you noticed?',
      onDelta: () => {},
      now: new Date('2026-07-10T12:21:00.000Z'),
    });
    const messages = await listMessages(fs, key, session.id);
    // No private note — just the user message + the public coach reply.
    expect(messages.map((m) => `${m.role}:${m.privateAside ? 'p' : '-'}`)).toEqual([
      'user:-',
      'assistant:-',
    ]);
    // The dropped marker's text NEVER lands anywhere.
    expect(messages.some((m) => m.content.includes('this should never appear'))).toBe(false);
    expect(messages.some((m) => m.content.includes('SELFOS:PRIVATE'))).toBe(false);
  });

  it('a marker on an ASIDE turn mints NO extra private note (an aside reply is already private)', async () => {
    const fs = memFileSystem();
    const session = await seed(fs);
    const { client } = captureClient(
      'Got it. [[SELFOS:PRIVATE:{"to":"Angel","text":"should be ignored on an aside turn"}]]',
    );
    await runTogetherTurn({
      fs,
      key,
      client,
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      session,
      authorPersonId: BEN,
      userText: 'Something just for you, coach.',
      privateAside: true,
      onDelta: () => {},
      now: new Date('2026-07-10T12:22:00.000Z'),
    });
    const messages = await listMessages(fs, key, session.id);
    // The aside user message + one aside coach reply — no SECOND private note minted from the marker.
    expect(
      messages.map((m) => `${m.role}:${m.authorPersonId}:${m.privateAside ? 'p' : '-'}`),
    ).toEqual(['user:ben:p', 'assistant:ben:p']);
    expect(messages.some((m) => m.content.includes('should be ignored'))).toBe(false);
  });
});

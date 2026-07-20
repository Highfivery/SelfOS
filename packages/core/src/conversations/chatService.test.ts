import { beforeEach, describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { toBase64 } from '../encoding';
import type { ClaudeClient, ClaudeMessage } from '../host';
import { memFileSystem } from '../host/memFileSystem';
import type { AttachmentRef, Person } from '../schemas';
import { savePerson } from '../people';
import { queryUsage, recordUsage, setPersonBudget } from '../usage';
import { saveInsight } from '../insights';
import type { Insight } from '../schemas';
import { listChallenges } from '../challenges/challengeService';
import {
  getConversation,
  listConversations,
  saveConversation,
  storeConversationAttachment,
} from './conversationService';
import { retryReply, runChatTurn } from './chatService';

const key = generateMasterKey();
const now = new Date('2026-06-15T12:00:00.000Z');
let fs: ReturnType<typeof memFileSystem>;
beforeEach(() => {
  fs = memFileSystem();
});

const fakeClient: ClaudeClient = {
  send: () => Promise.resolve('ok'),
  stream: (_options, onDelta) => {
    onDelta('I ');
    onDelta('hear you.');
    return Promise.resolve({
      text: 'I hear you.',
      usage: { inputTokens: 100, outputTokens: 10, cacheWriteTokens: 0, cacheReadTokens: 0 },
    });
  },
};

function person(id: string, name: string): Person {
  return {
    id,
    schemaVersion: 1,
    displayName: name,
    isSubject: true,
    tags: [],
    createdAt: 'now',
    updatedAt: 'now',
  };
}

async function base(): Promise<void> {
  await savePerson(fs, key, person('p1', 'Alex'));
}

describe('runChatTurn', () => {
  it('streams a reply, persists the transcript, and records usage', async () => {
    await base();
    const chunks: string[] = [];
    const result = await runChatTurn({
      fs,
      key,
      client: fakeClient,
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      personId: 'p1',
      conversationId: 'c1',
      userText: 'I had a hard day',
      onDelta: (t) => chunks.push(t),
      now,
    });

    expect(result.ok).toBe(true);
    expect(chunks.join('')).toBe('I hear you.');

    const conversation = await getConversation(fs, key, 'p1', 'c1');
    expect(conversation?.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(conversation?.messages[1]?.content).toBe('I hear you.');
    expect(conversation?.title).toBe('I had a hard day');

    if (result.ok) {
      expect(result.usage.type).toBe('chat');
      expect(result.usage.costUsd).toBeGreaterThan(0);
    }
  });

  it('sends a generous max_tokens budget (a small ceiling starved replies to empty)', async () => {
    await base();
    let sentMax: number | undefined;
    const capture: ClaudeClient = {
      send: () => Promise.resolve('ok'),
      stream: (options, onDelta) => {
        sentMax = options.maxTokens;
        onDelta('Hi.');
        return Promise.resolve({
          text: 'Hi.',
          usage: { inputTokens: 5, outputTokens: 2, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    await runChatTurn({
      fs,
      key,
      client: capture,
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      personId: 'p1',
      conversationId: 'c1',
      userText: 'Hello',
      onDelta: () => {},
      now,
    });
    expect(sentMax).toBeGreaterThanOrEqual(4096);
  });

  it('treats an empty/whitespace reply as EMPTY — never persists it, but still meters the billed call', async () => {
    await base();
    for (const [label, blank] of [
      ['empty', ''],
      ['whitespace', '   \n  '],
    ] as const) {
      const emptyClient: ClaudeClient = {
        send: () => Promise.resolve(''),
        stream: () =>
          Promise.resolve({
            text: blank,
            usage: { inputTokens: 200, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 },
          }),
      };
      const cid = `c-${label}`;
      const result = await runChatTurn({
        fs,
        key,
        client: emptyClient,
        apiKey: 'sk-test',
        model: 'claude-sonnet-4-6',
        personId: 'p1',
        conversationId: cid,
        userText: 'A long, hard message',
        onDelta: () => {},
        now,
      });
      // It's an honest failure the user can retry — NOT a silently-saved blank assistant turn.
      expect(result).toMatchObject({ ok: false, reason: 'EMPTY' });
      // The USER's message IS persisted (saved on send, 05 §4.1) so it's never lost + can be retried; only the
      // empty ASSISTANT reply is withheld → the transcript ends on the user's message.
      const conversation = await getConversation(fs, key, 'p1', cid);
      expect(conversation?.messages.map((m) => m.role)).toEqual(['user']);
      expect(conversation?.messages[0]?.content).toBe('A long, hard message');
    }
    // The billed calls were still metered (input + thinking tokens were consumed).
    const usage = await queryUsage(fs, key, { from: '2026-01-01', to: '2027-01-01', type: 'chat' });
    expect(usage.length).toBe(2);
  });

  it('retryReply REOPENS a wrapped-up session, and the re-read write preserves that (09 §14.4)', async () => {
    await base();
    // A turn fails, so the transcript ends on the user's message…
    const empty: ClaudeClient = {
      send: () => Promise.resolve(''),
      stream: () =>
        Promise.resolve({
          text: '',
          usage: { inputTokens: 200, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 },
        }),
    };
    const turnDeps = {
      fs,
      key,
      client: empty,
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      personId: 'p1',
      conversationId: 'c1',
      onDelta: () => {},
      now,
    };
    await runChatTurn({ ...turnDeps, userText: 'Please help' });

    // …then the person wraps the session up (status complete + an Insight).
    const wrapped = await getConversation(fs, key, 'p1', 'c1');
    await saveConversation(fs, key, {
      ...wrapped!,
      status: 'complete',
      endedAt: now.toISOString(),
      insightId: 'ins-1',
    });

    // Retrying must REOPEN it. The write re-reads the record, so the reopen has to be derived from the
    // live copy — otherwise `...live` reinstates 'complete' and the Insight silently stops matching.
    const result = await retryReply({ ...turnDeps, client: fakeClient });
    expect(result.ok).toBe(true);
    const after = await getConversation(fs, key, 'p1', 'c1');
    expect(after?.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(after?.status).toBe('inProgress');
    expect(after?.endedAt).toBeUndefined();
    expect(after?.insightStale).toBe(true);
  });

  it('retryReply re-generates a reply for an unanswered turn without duplicating the user message (05 §4.1)', async () => {
    await base();
    // First turn comes back empty → the user's message is persisted, no reply.
    const empty: ClaudeClient = {
      send: () => Promise.resolve(''),
      stream: () =>
        Promise.resolve({
          text: '',
          usage: { inputTokens: 200, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 },
        }),
    };
    await runChatTurn({
      fs,
      key,
      client: empty,
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      personId: 'p1',
      conversationId: 'c1',
      userText: 'Please help',
      onDelta: () => {},
      now,
    });

    // Retry → a reply is generated for the EXISTING transcript (no second user message).
    const result = await retryReply({
      fs,
      key,
      client: fakeClient,
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      personId: 'p1',
      conversationId: 'c1',
      onDelta: () => {},
      now,
    });
    expect(result.ok).toBe(true);
    const conversation = await getConversation(fs, key, 'p1', 'c1');
    // Exactly one user message (not duplicated) + the reply.
    expect(conversation?.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(conversation?.messages[0]?.content).toBe('Please help');
    expect(conversation?.messages[1]?.content).toBe('I hear you.');
  });

  it('retryReply is a no-op failure when the last message already has a reply', async () => {
    await base();
    await runChatTurn({
      fs,
      key,
      client: fakeClient,
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      personId: 'p1',
      conversationId: 'c1',
      userText: 'Hi',
      onDelta: () => {},
      now,
    });
    // The turn already produced a reply → nothing to retry.
    const result = await retryReply({
      fs,
      key,
      client: fakeClient,
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      personId: 'p1',
      conversationId: 'c1',
      onDelta: () => {},
      now,
    });
    expect(result).toMatchObject({ ok: false, reason: 'ERROR' });
  });

  it('retryReply recovers a LEGACY session that dead-ended on a blank assistant reply (pre-05 §4.1)', async () => {
    await base();
    // The pre-fail-safe code persisted an empty assistant bubble when a reply came back empty. Seed that exact
    // ghost state: the transcript ends on a blank assistant message, so the old retry (last === 'user') never
    // fired. Retry must strip the ghost, answer the user's message, and leave a clean [user, assistant] pair.
    await saveConversation(fs, key, {
      id: 'c1',
      schemaVersion: 1,
      personId: 'p1',
      title: 'A hard week',
      status: 'inProgress',
      messages: [
        { role: 'user', content: 'I have been feeling distant', ts: now.toISOString() },
        { role: 'assistant', content: '', ts: now.toISOString() },
      ],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });

    const result = await retryReply({
      fs,
      key,
      client: fakeClient,
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      personId: 'p1',
      conversationId: 'c1',
      onDelta: () => {},
      now,
    });
    expect(result.ok).toBe(true);
    const conversation = await getConversation(fs, key, 'p1', 'c1');
    // The ghost is gone; the user's message keeps its place and now has a real reply.
    expect(conversation?.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(conversation?.messages[0]?.content).toBe('I have been feeling distant');
    expect(conversation?.messages[1]?.content).toBe('I hear you.');
  });

  it('refuses to start with no API key', async () => {
    await base();
    const result = await runChatTurn({
      fs,
      key,
      client: fakeClient,
      apiKey: null,
      model: 'claude-sonnet-4-6',
      personId: 'p1',
      conversationId: 'c1',
      userText: 'hi',
      onDelta: () => {},
      now,
    });
    expect(result).toMatchObject({ ok: false, reason: 'NO_KEY' });
  });

  it('blocks when the person is over budget, unless the owner overrides', async () => {
    await base();
    await setPersonBudget(fs, key, 'p1', { limitUsd: 0.01, period: 'month', warnRatio: 0.8 });
    await recordUsage(fs, key, {
      id: 'prior',
      schemaVersion: 1,
      type: 'chat',
      personId: 'p1',
      model: 'claude-sonnet-4-6',
      at: '2026-06-10T00:00:00.000Z',
      inputTokens: 0,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      costUsd: 0.02, // already over the $0.01 limit
    });

    const blocked = await runChatTurn({
      fs,
      key,
      client: fakeClient,
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      personId: 'p1',
      conversationId: 'c1',
      userText: 'hi',
      onDelta: () => {},
      now,
    });
    expect(blocked).toMatchObject({ ok: false, reason: 'BUDGET' });

    const overridden = await runChatTurn({
      fs,
      key,
      client: fakeClient,
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      personId: 'p1',
      conversationId: 'c1',
      userText: 'hi',
      onDelta: () => {},
      now,
      override: true,
    });
    expect(overridden.ok).toBe(true);
  });

  it('detects + strips the wrap-up marker, surfacing wrapUpSuggested without persisting the token', async () => {
    await base();
    const wrapClient: ClaudeClient = {
      send: () => Promise.resolve('ok'),
      stream: () =>
        Promise.resolve({
          text: 'It sounds like you found some peace. [[SELFOS:WRAPUP]]',
          usage: { inputTokens: 100, outputTokens: 10, cacheWriteTokens: 0, cacheReadTokens: 0 },
        }),
    };
    const result = await runChatTurn({
      fs,
      key,
      client: wrapClient,
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      personId: 'p1',
      conversationId: 'c1',
      userText: 'thanks, that helped',
      onDelta: () => {},
      now,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.wrapUpSuggested).toBe(true);
    const conversation = await getConversation(fs, key, 'p1', 'c1');
    expect(conversation?.messages[1]?.content).toBe('It sounds like you found some peace.');
    expect(conversation?.messages[1]?.content).not.toContain('SELFOS:WRAPUP');
  });

  it('does not set wrapUpSuggested for an ordinary reply', async () => {
    await base();
    const result = await runChatTurn({
      fs,
      key,
      client: fakeClient,
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      personId: 'p1',
      conversationId: 'c1',
      userText: 'hi',
      onDelta: () => {},
      now,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.wrapUpSuggested).toBeUndefined();
  });

  it('reopens a completed session on a new turn → inProgress + marks its insight stale', async () => {
    await base();
    await saveConversation(fs, key, {
      id: 'c1',
      schemaVersion: 1,
      personId: 'p1',
      title: 'Done one',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      messages: [{ role: 'user', content: 'earlier', ts: now.toISOString() }],
      status: 'complete',
      endedAt: now.toISOString(),
      insightId: 'ins-1',
      insightStale: false,
    });
    const result = await runChatTurn({
      fs,
      key,
      client: fakeClient,
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      personId: 'p1',
      conversationId: 'c1',
      userText: 'actually one more thing',
      onDelta: () => {},
      now,
    });
    expect(result.ok).toBe(true);
    const conversation = await getConversation(fs, key, 'p1', 'c1');
    expect(conversation?.status).toBe('inProgress');
    expect(conversation?.endedAt).toBeUndefined();
    expect(conversation?.insightStale).toBe(true);
  });

  it('continues an existing conversation across turns', async () => {
    await base();
    const deps = {
      fs,
      key,
      client: fakeClient,
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      personId: 'p1',
      conversationId: 'c1',
      onDelta: () => {},
      now,
    };
    await runChatTurn({ ...deps, userText: 'first' });
    await runChatTurn({ ...deps, userText: 'second' });
    const conversation = await getConversation(fs, key, 'p1', 'c1');
    expect(conversation?.messages.length).toBe(4); // 2 user + 2 assistant
    expect((await listConversations(fs, key, 'p1')).length).toBe(1);
  });
});

describe('runChatTurn — guided sessions (16)', () => {
  function markerClient(text: string): ClaudeClient {
    return {
      send: () => Promise.resolve('ok'),
      stream: (_options, onDelta) => {
        onDelta('');
        return Promise.resolve({
          text,
          usage: { inputTokens: 80, outputTokens: 12, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
  }

  it('advances guideStep from the coach marker and strips it from the saved reply (structured)', async () => {
    await base();
    await saveConversation(fs, key, {
      id: 'g1',
      schemaVersion: 1,
      personId: 'p1',
      title: 'Thought Record',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      status: 'inProgress',
      guideId: 'cbt-thought-record',
      guideStep: 0,
      messages: [{ role: 'assistant', content: 'opener', ts: now.toISOString() }],
    });
    const result = await runChatTurn({
      fs,
      key,
      client: markerClient("Let's look at the evidence. [[SELFOS:STEP:3]]"),
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      personId: 'p1',
      conversationId: 'g1',
      userText: 'here is my situation',
      onDelta: () => {},
      now,
    });
    expect(result.ok).toBe(true);
    const conversation = await getConversation(fs, key, 'p1', 'g1');
    expect(conversation?.guideStep).toBe(3);
    const lastMessage = conversation?.messages.at(-1)?.content;
    expect(lastMessage).toBe("Let's look at the evidence.");
    expect(lastMessage).not.toContain('SELFOS:STEP');
  });

  it('clamps an out-of-range step to the exercise step count', async () => {
    await base();
    await saveConversation(fs, key, {
      id: 'g2',
      schemaVersion: 1,
      personId: 'p1',
      title: 'GROW',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      guideId: 'grow-goal-setting',
      guideStep: 0,
      messages: [],
    });
    await runChatTurn({
      fs,
      key,
      client: markerClient('Way ahead. [[SELFOS:STEP:99]]'),
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      personId: 'p1',
      conversationId: 'g2',
      userText: 'go',
      onDelta: () => {},
      now,
    });
    const conversation = await getConversation(fs, key, 'p1', 'g2');
    // GROW has 4 steps → max index 3.
    expect(conversation?.guideStep).toBe(3);
  });

  it('captures a Challenge from a marker in a challenge-coach session + strips it (52 §3.2)', async () => {
    await base();
    await saveConversation(fs, key, {
      id: 'ch1',
      schemaVersion: 1,
      personId: 'p1',
      title: 'Take on a challenge',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      status: 'inProgress',
      guideId: 'challenge-coach',
      messages: [{ role: 'assistant', content: 'opener', ts: now.toISOString() }],
    });
    const result = await runChatTurn({
      fs,
      key,
      client: markerClient(
        'Set — go for it. [[SELFOS:CHALLENGE:{"action":"Call one friend","comfort":2,"lifeArea":"Relationships","checkInDays":7}]]',
      ),
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      personId: 'p1',
      conversationId: 'ch1',
      userText: "yes let's do it",
      onDelta: () => {},
      now,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.challengeCreated?.action).toBe('Call one friend');
    // the marker never persists in the visible transcript
    const conversation = await getConversation(fs, key, 'p1', 'ch1');
    expect(conversation?.messages.at(-1)?.content).toBe('Set — go for it.');
    expect(conversation?.messages.at(-1)?.content).not.toContain('SELFOS:CHALLENGE');
    // a real Challenge entity exists, active, back-linked to the conversation
    const challenges = await listChallenges(fs, key, 'p1');
    expect(challenges).toHaveLength(1);
    expect(challenges[0]!.status).toBe('active');
    expect(challenges[0]!.action).toBe('Call one friend');
    expect(challenges[0]!.conversationId).toBe('ch1');
    expect(challenges[0]!.provenance.conversationId).toBe('ch1');
  });

  it('does NOT capture a challenge from a marker in a NON-challenge session', async () => {
    await base();
    await saveConversation(fs, key, {
      id: 'free1',
      schemaVersion: 1,
      personId: 'p1',
      title: 'free',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      messages: [],
    });
    const result = await runChatTurn({
      fs,
      key,
      client: markerClient('Sure. [[SELFOS:CHALLENGE:{"action":"sneaky"}]]'),
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      personId: 'p1',
      conversationId: 'free1',
      userText: 'hi',
      onDelta: () => {},
      now,
    });
    expect(result.ok && result.challengeCreated).toBeUndefined();
    expect(await listChallenges(fs, key, 'p1')).toHaveLength(0);
  });
});

// --- Free-form session topic classifier (28 §13.2) ---

const TOPIC_MODEL = 'claude-haiku-4-5';

/** A client that returns life-area JSON for the Haiku classifier call and a normal reply otherwise; counts
 *  how many times the classifier (Haiku) ran. */
function topicAwareClient(lifeAreas: string[]): {
  client: ClaudeClient;
  classifyCalls: () => number;
} {
  let calls = 0;
  const client: ClaudeClient = {
    send: () => Promise.resolve('ok'),
    stream: (options, onDelta) => {
      if (options.model === TOPIC_MODEL) {
        calls += 1;
        return Promise.resolve({
          text: JSON.stringify({ lifeAreas }),
          usage: { inputTokens: 15, outputTokens: 4, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      }
      onDelta('Tell me more.');
      return Promise.resolve({
        text: 'Tell me more.',
        usage: { inputTokens: 100, outputTokens: 10, cacheWriteTokens: 0, cacheReadTokens: 0 },
      });
    },
  };
  return { client, classifyCalls: () => calls };
}

function turn(over: Partial<Parameters<typeof runChatTurn>[0]>): Parameters<typeof runChatTurn>[0] {
  return {
    fs,
    key,
    client: fakeClient,
    apiKey: 'sk-test',
    model: 'claude-sonnet-4-6',
    personId: 'p1',
    conversationId: 'c1',
    userText: 'hello',
    onDelta: () => {},
    now,
    ...over,
  };
}

describe('runChatTurn — free-form topic classifier (28 §13.2)', () => {
  it('classifies a free-form turn, caches the topic, and meters a session.topic event', async () => {
    await base();
    const { client, classifyCalls } = topicAwareClient(['Money']);
    await runChatTurn(turn({ client, userText: 'I am drowning in debt and rent' }));
    expect(classifyCalls()).toBe(1);

    expect((await getConversation(fs, key, 'p1', 'c1'))?.topicLifeAreas).toEqual(['Money']);

    const topicEvents = await queryUsage(fs, key, {
      from: '2026-01-01',
      to: '2027-01-01',
      personId: 'p1',
      type: 'session.topic',
    });
    expect(topicEvents).toHaveLength(1);
    expect(topicEvents[0]?.model).toBe(TOPIC_MODEL);
  });

  it('reuses the cached topic on a follow-up that stays on subject (no second classify)', async () => {
    await base();
    const { client, classifyCalls } = topicAwareClient(['Money']);
    await runChatTurn(turn({ client, userText: 'I am drowning in debt' }));
    await runChatTurn(turn({ client, userText: 'more about my savings and the rent' }));
    expect(classifyCalls()).toBe(1); // stayed within Money → no re-classify
  });

  it('re-classifies when the subject shifts to a new area', async () => {
    await base();
    const { client, classifyCalls } = topicAwareClient(['Money']);
    await runChatTurn(turn({ client, userText: 'I am drowning in debt' }));
    await runChatTurn(turn({ client, userText: 'actually my husband is the real issue' }));
    expect(classifyCalls()).toBe(2); // Relationships is outside cached Money → re-classify
  });

  it('a guided session never runs the classifier', async () => {
    await base();
    const { client, classifyCalls } = topicAwareClient(['Money']);
    await saveConversation(fs, key, {
      id: 'g3',
      schemaVersion: 1,
      personId: 'p1',
      title: 'GROW',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      guideId: 'grow-goal-setting',
      guideStep: 0,
      messages: [],
    });
    await runChatTurn(turn({ client, conversationId: 'g3', userText: 'I want to save money' }));
    expect(classifyCalls()).toBe(0);
    expect((await getConversation(fs, key, 'p1', 'g3'))?.topicLifeAreas).toBeUndefined();
  });

  it('the classified topic changes which portrait facts feed the session (end-to-end)', async () => {
    await base();
    // 45 untagged (⇒ core) filler facts EXHAUST the per-call budget, then a single topical Money fact last —
    // so the Money fact only survives selection when the classified topic actually pulls it in (28b §pillar-2).
    const filler = Array.from({ length: 45 }, (_, i) => ({
      id: `u${i}`,
      text: `Filler fact ${i}`,
      shareable: false,
    }));
    const portrait: Insight = {
      id: 'intake-1',
      schemaVersion: 1,
      source: 'intake',
      subjectPersonId: 'p1',
      summary: 'A thoughtful, steady person.',
      facts: [
        ...filler,
        {
          id: 'f-money',
          text: 'A debt from a failed business',
          shareable: false,
          lifeArea: 'Money',
        },
      ],
      confidence: 'medium',
      categories: [],
      approved: true,
      provenance: { at: now.toISOString() },
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    await saveInsight(fs, key, portrait);

    // A capturing client that returns the GIVEN classifier topic and records the chat system prompt.
    const capturing = (lifeAreas: string[]): { client: ClaudeClient; system: () => string } => {
      let system = '';
      return {
        system: () => system,
        client: {
          send: () => Promise.resolve('ok'),
          stream: (options, onDelta) => {
            if (options.model === TOPIC_MODEL) {
              return Promise.resolve({
                text: JSON.stringify({ lifeAreas }),
                usage: {
                  inputTokens: 15,
                  outputTokens: 4,
                  cacheWriteTokens: 0,
                  cacheReadTokens: 0,
                },
              });
            }
            system = options.system;
            onDelta('ok');
            return Promise.resolve({
              text: 'ok',
              usage: {
                inputTokens: 100,
                outputTokens: 10,
                cacheWriteTokens: 0,
                cacheReadTokens: 0,
              },
            });
          },
        },
      };
    };

    // A Money-classified turn pulls the Money fact into the prompt...
    const money = capturing(['Money']);
    await runChatTurn(
      turn({ client: money.client, conversationId: 'cm', userText: 'I am drowning in debt' }),
    );
    expect(money.system()).toContain('A debt from a failed business');
    expect(money.system()).toContain('A thoughtful, steady person.'); // the summary always feeds

    // ...while a neutral-classified turn (no Money area) leaves it out — the off-topic fact is narrowed away.
    const neutral = capturing([]);
    await runChatTurn(
      turn({ client: neutral.client, conversationId: 'cn', userText: 'just thinking out loud' }),
    );
    expect(neutral.system()).not.toContain('A debt from a failed business');
    expect(neutral.system()).toContain('A thoughtful, steady person.'); // summary still feeds
  });

  it('fails open — a classifier transport error never blocks the reply', async () => {
    await base();
    const client: ClaudeClient = {
      send: () => Promise.resolve('ok'),
      stream: (options, onDelta) => {
        if (options.model === TOPIC_MODEL) return Promise.reject(new Error('network'));
        onDelta('I hear you.');
        return Promise.resolve({
          text: 'I hear you.',
          usage: { inputTokens: 100, outputTokens: 10, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    const result = await runChatTurn(turn({ client, userText: 'I am stressed about money' }));
    expect(result.ok).toBe(true); // the reply still lands
    expect((await getConversation(fs, key, 'p1', 'c1'))?.topicLifeAreas).toBeUndefined();
  });
});

describe('runChatTurn — image attachments (45 §6.1 vision)', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 42]);

  async function storeRef(conversationId: string): Promise<AttachmentRef> {
    const ref = await storeConversationAttachment(fs, key, 'p1', conversationId, png, 'image/png');
    if ('ok' in ref) throw new Error('store failed');
    return ref;
  }

  function capturing(captured: { messages: ClaudeMessage[] }): ClaudeClient {
    return {
      send: () => Promise.resolve('ok'),
      stream: (options, onDelta) => {
        captured.messages = options.messages;
        onDelta('I see it.');
        return Promise.resolve({
          text: 'I see it.',
          usage: { inputTokens: 200, outputTokens: 10, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
  }

  it('assembles a vision content-block array with the re-read base64 + meters as a chat event', async () => {
    await base();
    const ref = await storeRef('c1');
    const captured = { messages: [] as ClaudeMessage[] };
    const result = await runChatTurn({
      fs,
      key,
      client: capturing(captured),
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      personId: 'p1',
      conversationId: 'c1',
      userText: 'what do you make of this?',
      attachments: [ref],
      onDelta: () => {},
      now,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.usage.type).toBe('chat'); // no new usage type

    // The (only) user message went to Claude as text + an image block carrying the stored bytes' base64.
    const userMsg = captured.messages.find((m) => m.role === 'user');
    expect(Array.isArray(userMsg?.content)).toBe(true);
    const blocks = userMsg?.content as Exclude<ClaudeMessage['content'], string>;
    expect(blocks[0]).toEqual({ type: 'text', text: 'what do you make of this?' });
    expect(blocks[1]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: toBase64(png) },
    });

    // Persisted on the transcript.
    const saved = await getConversation(fs, key, 'p1', 'c1');
    expect(saved?.messages[0]?.attachments?.[0]?.id).toBe(ref.id);
  });

  it('re-reads an earlier message’s attachment on a later turn (stateless re-supply)', async () => {
    await base();
    const ref = await storeRef('c1');
    await runChatTurn({
      fs,
      key,
      client: capturing({ messages: [] }),
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      personId: 'p1',
      conversationId: 'c1',
      userText: 'look at this',
      attachments: [ref],
      onDelta: () => {},
      now,
    });
    // A later, text-only turn must STILL re-supply the earlier image (Claude is stateless).
    const captured = { messages: [] as ClaudeMessage[] };
    await runChatTurn({
      fs,
      key,
      client: capturing(captured),
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      personId: 'p1',
      conversationId: 'c1',
      userText: 'and now?',
      onDelta: () => {},
      now,
    });
    const firstUser = captured.messages[0];
    expect(Array.isArray(firstUser?.content)).toBe(true);
    const blocks = firstUser?.content as Exclude<ClaudeMessage['content'], string>;
    expect(blocks.some((b) => b.type === 'image')).toBe(true);
  });

  it('skips a missing/corrupt attachment so the turn still completes', async () => {
    await base();
    const ghost: AttachmentRef = {
      id: 'gone',
      kind: 'image',
      mime: 'image/png',
      path: 'people/p1/conversations/c1/attachments/gone.enc', // never stored
    };
    const captured = { messages: [] as ClaudeMessage[] };
    const result = await runChatTurn({
      fs,
      key,
      client: capturing(captured),
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      personId: 'p1',
      conversationId: 'c1',
      userText: 'this should still send',
      attachments: [ghost],
      onDelta: () => {},
      now,
    });
    expect(result.ok).toBe(true); // degrades to text, never throws
    // No image block survived; the user message fell back to plain text.
    const userMsg = captured.messages.find((m) => m.role === 'user');
    expect(userMsg?.content).toBe('this should still send');
  });
});

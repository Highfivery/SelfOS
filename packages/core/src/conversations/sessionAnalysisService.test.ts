import { beforeEach, describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import type { ClaudeClient } from '../host';
import { memFileSystem } from '../host/memFileSystem';
import type { Conversation, IntakeSession, Person } from '../schemas';
import { savePerson } from '../people';
import { buildContext } from '../people';
import { getInsight, listInsightsForPerson, summarizeForContext } from '../insights';
import { listProfileSuggestions } from '../profile';
import { queryUsage, recordUsage, setPersonBudget } from '../usage';
import { listGoals } from '../goals';
import { getConversation, saveConversation } from './conversationService';
import { endAndSummarize, setSessionStatus } from './sessionAnalysisService';

const key = generateMasterKey();
const now = new Date('2026-06-15T12:00:00.000Z');
let fs: ReturnType<typeof memFileSystem>;
beforeEach(() => {
  fs = memFileSystem();
});

const ANALYSIS_JSON = JSON.stringify({
  summary: 'Alex worked through stress about a deadline at work.',
  themes: ['work stress', 'deadlines'],
  goals: ['Ask the manager for an extension'],
  followUps: ['Check how the conversation with the manager went'],
  people: ['Sam'],
  moodValence: -0.4,
  moodEnergy: 0.2,
  crisisFlag: false,
});

function analysisClient(text = ANALYSIS_JSON): ClaudeClient {
  return {
    send: () => Promise.resolve('ok'),
    stream: (_options, onDelta) => {
      onDelta('');
      return Promise.resolve({
        text,
        usage: { inputTokens: 200, outputTokens: 50, cacheWriteTokens: 0, cacheReadTokens: 0 },
      });
    },
  };
}

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

function conversation(
  id: string,
  personId: string,
  overrides: Partial<Conversation> = {},
): Conversation {
  return {
    id,
    schemaVersion: 1,
    personId,
    title: 'Hard day',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    messages: [
      { role: 'user', content: 'I had a hard day at work', ts: now.toISOString() },
      { role: 'assistant', content: 'Tell me more about it.', ts: now.toISOString() },
    ],
    ...overrides,
  };
}

const deps = (overrides: Record<string, unknown> = {}) => ({
  fs,
  key,
  client: analysisClient(),
  apiKey: 'sk-test',
  model: 'claude-sonnet-4-6',
  personId: 'p1',
  conversationId: 'c1',
  memoryEnabled: true,
  now,
  ...overrides,
});

describe('setSessionStatus', () => {
  it('completes a session and stamps endedAt; reverting clears it', async () => {
    await savePerson(fs, key, person('p1', 'Alex'));
    await saveConversation(fs, key, conversation('c1', 'p1'));

    const completed = await setSessionStatus({
      fs,
      key,
      personId: 'p1',
      conversationId: 'c1',
      status: 'complete',
      now,
    });
    expect(completed?.status).toBe('complete');
    expect(completed?.endedAt).toBe(now.toISOString());

    const onHold = await setSessionStatus({
      fs,
      key,
      personId: 'p1',
      conversationId: 'c1',
      status: 'onHold',
      now,
    });
    expect(onHold?.status).toBe('onHold');
    expect(onHold?.endedAt).toBeUndefined();
  });

  it('returns null for a missing conversation', async () => {
    await savePerson(fs, key, person('p1', 'Alex'));
    expect(
      await setSessionStatus({
        fs,
        key,
        personId: 'p1',
        conversationId: 'nope',
        status: 'onHold',
        now,
      }),
    ).toBeNull();
  });
});

describe('endAndSummarize', () => {
  beforeEach(async () => {
    await savePerson(fs, key, person('p1', 'Alex'));
    await saveConversation(fs, key, conversation('c1', 'p1'));
  });

  it('notes the guided exercise on the Insight (provenance + a leading Exercise fact) (16 §3.5)', async () => {
    await saveConversation(fs, key, conversation('g1', 'p1', { guideId: 'cbt-thought-record' }));
    const result = await endAndSummarize(deps({ conversationId: 'g1' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.insight.provenance.guideId).toBe('cbt-thought-record');
    expect(result.insight.facts[0]?.text).toBe('Exercise: Thought Record (CBT)');
  });

  it('produces an auto-approved SessionInsight with mood metrics + completes the session', async () => {
    const result = await endAndSummarize(deps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.insight.source).toBe('session');
    expect(result.insight.approved).toBe(true);
    expect(result.insight.subjectPersonId).toBe('p1');
    expect(result.insight.provenance.conversationId).toBe('c1');
    expect(result.insight.metrics?.moodValence).toBeCloseTo(-0.4);
    expect(result.insight.metrics?.moodEnergy).toBeCloseTo(0.2);
    expect(result.insight.facts.map((f) => f.text)).toEqual([
      'Theme: work stress',
      'Theme: deadlines',
      'Goal: Ask the manager for an extension',
      'Follow-up: Check how the conversation with the manager went',
      'Person mentioned: Sam',
    ]);

    const conv = await getConversation(fs, key, 'p1', 'c1');
    expect(conv?.status).toBe('complete');
    expect(conv?.insightId).toBe(result.insight.id);
    expect(conv?.insightStale).toBe(false);
    expect(conv?.endedAt).toBe(now.toISOString());
  });

  it('extracts the session’s goals into tracked Goal entities (39 §4.1, no extra spend)', async () => {
    const result = await endAndSummarize(deps());
    expect(result.ok).toBe(true);
    const goals = await listGoals(fs, key, 'p1');
    expect(goals.map((g) => g.text)).toEqual(['Ask the manager for an extension']);
    expect(goals[0]?.status).toBe('open');
    expect(goals[0]?.provenance.conversationId).toBe('c1');
    expect(goals[0]?.insightId).toBe(result.ok ? result.insight.id : undefined);
  });

  it('records a session.analyze usage event', async () => {
    const result = await endAndSummarize(deps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.usage.type).toBe('session.analyze');
    expect(result.usage.sessionId).toBe('c1');
    expect(result.usage.costUsd).toBeGreaterThan(0);
  });

  it('feeds the subject’s own buildContext after summarizing', async () => {
    await endAndSummarize(deps());
    const context = await buildContext(fs, key, 'p1');
    expect(context).toContain('Ask the manager for an extension');
    const ownSummary = await summarizeForContext(fs, key, 'p1', []);
    expect(ownSummary).toContain('worked through stress');
  });

  it('clamps out-of-range mood values into -1..1', async () => {
    const result = await endAndSummarize(
      deps({
        client: analysisClient(
          JSON.stringify({
            summary: 's',
            themes: [],
            goals: [],
            followUps: [],
            people: [],
            moodValence: -5,
            moodEnergy: 9,
          }),
        ),
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.insight.metrics?.moodValence).toBe(-1);
    expect(result.insight.metrics?.moodEnergy).toBe(1);
  });

  it('short-circuits when memory is disabled (no Insight, no spend)', async () => {
    const result = await endAndSummarize(deps({ memoryEnabled: false }));
    expect(result).toMatchObject({ ok: false, reason: 'MEMORY_DISABLED' });
    expect(await listInsightsForPerson(fs, key, 'p1')).toHaveLength(0);
  });

  it('refuses without an API key', async () => {
    const result = await endAndSummarize(deps({ apiKey: null }));
    expect(result).toMatchObject({ ok: false, reason: 'NO_KEY' });
  });

  it('refuses an empty / missing conversation', async () => {
    await saveConversation(fs, key, conversation('empty', 'p1', { messages: [] }));
    expect(await endAndSummarize(deps({ conversationId: 'empty' }))).toMatchObject({
      ok: false,
      reason: 'NOT_FOUND',
    });
  });

  it('blocks when over budget', async () => {
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
      costUsd: 0.02,
    });
    expect(await endAndSummarize(deps())).toMatchObject({ ok: false, reason: 'BUDGET' });
  });

  it('meters even when the JSON fails to validate (tokens were spent)', async () => {
    const result = await endAndSummarize(deps({ client: analysisClient('not json at all') }));
    // 37 §3.2: a no-JSON reply is MALFORMED ("unexpected shape"), distinct from a transport ERROR.
    expect(result).toMatchObject({ ok: false, reason: 'MALFORMED' });
    expect(await listInsightsForPerson(fs, key, 'p1')).toHaveLength(0); // no insight
    // but a usage event WAS recorded (the tokens were spent)
    const billed = await queryUsage(fs, key, {
      from: '0000',
      to: '9999',
      personId: 'p1',
      type: 'session.analyze',
    });
    expect(billed).toHaveLength(1);
    const conv = await getConversation(fs, key, 'p1', 'c1');
    expect(conv?.status).not.toBe('complete'); // a failed parse doesn't complete the session
  });

  it('salvages the summary from a complete-but-malformed reply (37 §3.1) into a usable insight', async () => {
    await savePerson(fs, key, person('p1', 'Alex'));
    await saveConversation(fs, key, conversation('c1', 'p1'));
    // Bracket-balanced but unparseable (a trailing comma) — NOT truncated, so the leading summary is salvaged.
    const malformed = '{"summary":"A calmer end to a hard day.","themes":"x",}';
    const result = await endAndSummarize(deps({ client: analysisClient(malformed) }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.insight.summary).toBe('A calmer end to a hard day.');
  });

  it('reports TRUNCATED (not a silent partial) when the crisis tail is cut off (§8 safety)', async () => {
    await savePerson(fs, key, person('p1', 'Alex'));
    await saveConversation(fs, key, conversation('c1', 'p1'));
    // The summary is complete, but the object is cut off BEFORE `crisisFlag` (the last key). Salvaging just
    // the summary would silently default crisisFlag→false and lose a possible crisis signal — so this must be
    // reported TRUNCATED (a retry) so the flag can surface, matching the dream-synthesis path.
    const truncated = '{"summary":"A calmer end to a hard day.","themes":["work str';
    const result = await endAndSummarize(deps({ client: analysisClient(truncated) }));
    expect(result).toMatchObject({ ok: false, reason: 'TRUNCATED' });
    // The session is NOT marked complete on a truncated reply, so re-running can still surface the flag.
    const conv = await getConversation(fs, key, 'p1', 'c1');
    expect(conv?.status).not.toBe('complete');
  });

  it('preserves the crisis flag even when a list element is malformed (§8)', async () => {
    await savePerson(fs, key, person('p1', 'Alex'));
    await saveConversation(fs, key, conversation('c1', 'p1'));
    // One theme is a non-string (drops), but crisisFlag must survive the per-element salvage.
    const text =
      '{"summary":"Concerning session.","themes":["ok",123],"crisisFlag":true,"goals":[],"followUps":[],"people":[]}';
    const result = await endAndSummarize(deps({ client: analysisClient(text) }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.insight.crisisFlag).toBe(true);
  });

  it('reports TRUNCATED distinctly from MALFORMED (37 §3.2)', async () => {
    await savePerson(fs, key, person('p1', 'Alex'));
    await saveConversation(fs, key, conversation('c1', 'p1'));
    // Cut off before the summary string even closes → nothing salvageable → TRUNCATED.
    const cutOff = await endAndSummarize(
      deps({ client: analysisClient('{"summary":"a calmer end to a ') }),
    );
    expect(cutOff).toMatchObject({ ok: false, reason: 'TRUNCATED' });
    await saveConversation(fs, key, conversation('c1', 'p1')); // reset status
    const junk = await endAndSummarize(deps({ client: analysisClient('totally not json') }));
    expect(junk).toMatchObject({ ok: false, reason: 'MALFORMED' });
  });

  it('re-runs on the stale path: reuses the insight id + carries per-fact sharing forward', async () => {
    // First summary, then share a fact, then re-run with new text → the share carries by matching text.
    const first = await endAndSummarize(deps());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const insightId = first.insight.id;

    // Promote the "Goal" fact to be shared with p2 (simulate the Memory surface edit).
    const stored = await getInsight(fs, key, 'p1', insightId);
    expect(stored).not.toBeNull();
    if (!stored) return;
    const goalFact = stored.facts.find((f) => f.text.startsWith('Goal:'));
    expect(goalFact).toBeDefined();
    const { saveInsight } = await import('../insights');
    await saveInsight(fs, key, {
      ...stored,
      facts: stored.facts.map((f) => (f.id === goalFact?.id ? { ...f, shareableWith: ['p2'] } : f)),
    });

    // Reopen + re-summarize: same conversation, now linking insightId + marked stale.
    const conv = await getConversation(fs, key, 'p1', 'c1');
    await saveConversation(fs, key, {
      ...conv!,
      insightId,
      insightStale: true,
      status: 'inProgress',
    });

    const second = await endAndSummarize(deps());
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.insight.id).toBe(insightId); // reused, not a new insight
    const carried = second.insight.facts.find(
      (f) => f.text === 'Goal: Ask the manager for an extension',
    );
    expect(carried?.shareableWith).toEqual(['p2']);

    // Still exactly one insight for the person (overwrote, didn't duplicate).
    expect(await listInsightsForPerson(fs, key, 'p1')).toHaveLength(1);
  });

  it('carries a crisis flag through to the Insight', async () => {
    const result = await endAndSummarize(
      deps({
        client: analysisClient(
          JSON.stringify({
            summary: 's',
            themes: [],
            goals: [],
            followUps: [],
            people: [],
            moodValence: -0.9,
            moodEnergy: -0.5,
            crisisFlag: true,
          }),
        ),
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.insight.crisisFlag).toBe(true);
  });
});

describe('endAndSummarize — depth invitations (29, the free by-product)', () => {
  const withDepth = (sectionId: string): string =>
    JSON.stringify({
      summary: 'A reflective check-in that kept returning to family.',
      themes: ['family'],
      goals: [],
      followUps: [],
      people: [],
      moodValence: 0,
      moodEnergy: 0,
      crisisFlag: false,
      depthInvitations: [{ sectionId, theme: 'your father', rationale: 'family came up a lot' }],
    });

  const intake = (sections: IntakeSession['sections']): IntakeSession => ({
    id: 's1',
    schemaVersion: 1,
    personId: 'p1',
    status: 'complete',
    sections,
    completedAt: now.toISOString(),
    startedAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });

  it('records a depth invitation for an unexplored area — and meters NO extra event', async () => {
    await savePerson(fs, key, person('p1', 'Alex'));
    await saveConversation(fs, key, conversation('c1', 'p1'));
    const result = await endAndSummarize(
      deps({ client: analysisClient(withDepth('family')), intakeSession: intake([]) }),
    );
    expect(result.ok).toBe(true);
    const depth = (await listProfileSuggestions(fs, key, 'p1')).filter((s) => s.kind === 'depth');
    expect(depth).toHaveLength(1);
    expect(depth[0]?.sectionId).toBe('family');
    // The same paid pass produced it — exactly ONE usage event, no separate depth-detection spend.
    const events = await queryUsage(fs, key, {
      from: '0000',
      to: '9999',
      personId: 'p1',
      type: 'session.analyze',
    });
    expect(events).toHaveLength(1);
  });

  it('records none when the target area is already filled', async () => {
    await savePerson(fs, key, person('p1', 'Alex'));
    await saveConversation(fs, key, conversation('c1', 'p1'));
    await endAndSummarize(
      deps({
        client: analysisClient(withDepth('family')),
        intakeSession: intake([
          { id: 'family', status: 'complete', restricted: false, messages: [], answers: {} },
        ]),
      }),
    );
    const depth = (await listProfileSuggestions(fs, key, 'p1')).filter((s) => s.kind === 'depth');
    expect(depth).toHaveLength(0);
  });
});

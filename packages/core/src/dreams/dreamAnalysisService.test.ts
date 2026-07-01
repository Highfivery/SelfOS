import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { ClaudeClient } from '../host';
import { flattenContent } from '../host';
import type { Dream } from '../schemas';
import { listConversations } from '../conversations';
import { getInsight, listInsightsForPerson, saveInsight, summarizeForContext } from '../insights';
import { savePerson, saveRelationship } from '../people';
import { queryUsage, setPersonBudget } from '../usage';
import {
  deleteDream,
  getAnalysis,
  getDream,
  getDreamConversation,
  saveDream,
} from './dreamService';
import {
  DREAM_READY_MARKER,
  approveAnalysis,
  openReflection,
  removeFromContext,
  runAnalysisTurn,
  stripDreamMarkers,
  synthesizeAnalysis,
  updateAnalysis,
} from './dreamAnalysisService';

const key = generateMasterKey();

const VALID_DRAFT = {
  summary: 'A search through a shifting childhood house.',
  emotionalLandscape: 'Unease and urgency over a nostalgic undertone.',
  wakingLifeConnections: 'Something steady may feel like it is changing right now.',
  notableImages: 'A childhood home, held lightly as reflection rather than fact.',
  reflectiveQuestions: ['What in your life feels like it is rearranging?'],
  coachingPrompt: 'Notice what shifted this week.',
  tags: {
    emotions: ['unease'],
    symbols: ['house'],
    settings: ['childhood home'],
    themes: ['searching'],
    people: ['brother'],
  },
  metrics: { emotionalIntensity: 0.7 },
  crisisFlag: false,
  distressSignal: false,
};

/** A fake client: returns JSON for the synthesis turn (its last message asks for a JSON object), else a reply. */
function fakeClient(over: { synthesisText?: string; reply?: string } = {}): ClaudeClient {
  const usage = { inputTokens: 10, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 };
  return {
    send: () => Promise.resolve(''),
    stream: (options, onDelta) => {
      const last = flattenContent(options.messages.at(-1)?.content ?? '');
      const text = last.includes('JSON object')
        ? (over.synthesisText ?? JSON.stringify(VALID_DRAFT))
        : (over.reply ?? 'What feeling stayed with you from the dream?');
      onDelta(text);
      return Promise.resolve({ text, usage });
    },
  };
}

function dream(over: Partial<Dream> & { id: string; personId: string }): Dream {
  return {
    schemaVersion: 1,
    narrative: `dream-${over.id}`,
    lucid: false,
    nightmare: false,
    tags: [],
    people: [],
    sensitivity: 'standard',
    status: 'captured',
    createdAt: '2026-06-11T00:00:00.000Z',
    updatedAt: '2026-06-11T00:00:00.000Z',
    ...over,
  };
}

function deps(fs: ReturnType<typeof memFileSystem>, client: ClaudeClient) {
  return {
    fs,
    key,
    client,
    apiKey: 'sk-test' as string | null,
    model: 'claude-sonnet-4-6',
    personId: 'p1',
    dreamId: 'd1',
    now: new Date('2026-06-11T10:00:00.000Z'),
  };
}

describe('dreamAnalysisService', () => {
  it('runs a guided turn under the dream — not in the Sessions list — and meters dream.analyze', async () => {
    const fs = memFileSystem();
    await saveDream(fs, key, dream({ id: 'd1', personId: 'p1' }));

    const res = await runAnalysisTurn({
      ...deps(fs, fakeClient()),
      userText: 'I’d like to reflect on this dream.',
      onDelta: () => {},
    });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.usage.type).toBe('dream.analyze');
    const convo = await getDreamConversation(fs, key, 'p1', 'd1');
    expect(convo?.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    // The transcript lives UNDER the dream — the Sessions surface never sees it.
    expect(await listConversations(fs, key, 'p1')).toEqual([]);
    expect((await getDream(fs, key, 'p1', 'd1'))?.status).toBe('analyzing');
  });

  it('synthesizes a structured analysis and marks the dream analyzed', async () => {
    const fs = memFileSystem();
    await saveDream(fs, key, dream({ id: 'd1', personId: 'p1' }));

    const res = await synthesizeAnalysis(deps(fs, fakeClient()));
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('synthesis failed');
    expect(res.analysis.summary).toBe(VALID_DRAFT.summary);
    expect(res.analysis.tags.symbols).toContain('house');
    expect(res.analysis.lensesApplied).toContain('symbolic');
    expect(res.usage.type).toBe('dream.analyze');

    const stored = await getAnalysis(fs, key, 'p1', 'd1');
    expect(stored?.summary).toBe(VALID_DRAFT.summary);
    const d = await getDream(fs, key, 'p1', 'd1');
    expect(d?.status).toBe('analyzed');
    expect(d?.analysisId).toBe(res.analysis.id);
  });

  it('saves edits to a section, marks it edited, and leaves AI-owned coding intact', async () => {
    const fs = memFileSystem();
    await saveDream(fs, key, dream({ id: 'd1', personId: 'p1' }));
    await synthesizeAnalysis(deps(fs, fakeClient()));

    const updated = await updateAnalysis({
      fs,
      key,
      personId: 'p1',
      dreamId: 'd1',
      edits: { summary: 'My own retelling.' },
      now: new Date('2026-06-11T12:00:00.000Z'),
    });
    expect(updated?.summary).toBe('My own retelling.');
    expect(updated?.edited).toBe(true);
    // Untouched sections + the AI-owned structured tags are preserved.
    expect(updated?.emotionalLandscape).toBe(VALID_DRAFT.emotionalLandscape);
    expect(updated?.tags.symbols).toContain('house');
    expect((await getAnalysis(fs, key, 'p1', 'd1'))?.summary).toBe('My own retelling.');
  });

  it('updateAnalysis is a no-op (null) when there is no analysis yet', async () => {
    const fs = memFileSystem();
    await saveDream(fs, key, dream({ id: 'd1', personId: 'p1' }));
    const res = await updateAnalysis({
      fs,
      key,
      personId: 'p1',
      dreamId: 'd1',
      edits: { summary: 'x' },
      now: new Date('2026-06-11T12:00:00.000Z'),
    });
    expect(res).toBeNull();
  });

  it('returns an honest MALFORMED when the synthesis output is not valid JSON', async () => {
    const fs = memFileSystem();
    await saveDream(fs, key, dream({ id: 'd1', personId: 'p1' }));
    const res = await synthesizeAnalysis(
      deps(fs, fakeClient({ synthesisText: 'sorry, no json here' })),
    );
    expect(res.ok).toBe(false);
    // 37 §3.2: a no-JSON reply is MALFORMED ("unexpected shape"), distinct from a transport ERROR.
    if (!res.ok) expect(res.reason).toBe('MALFORMED');
  });

  it('reports TRUNCATED on a cut-off reply (37 §3.2)', async () => {
    const fs = memFileSystem();
    await saveDream(fs, key, dream({ id: 'd1', personId: 'p1' }));
    const res = await synthesizeAnalysis(
      deps(fs, fakeClient({ synthesisText: '{"summary":"A dream of shifting roo' })),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('TRUNCATED');
      expect(res.message).toMatch(/cut off/i);
    }
  });

  it('tolerates an off-spec optional field — salvages the analysis (37 §3.1)', async () => {
    const fs = memFileSystem();
    await saveDream(fs, key, dream({ id: 'd1', personId: 'p1' }));
    // `metrics` is a non-object (off-spec) and one reflectiveQuestion is a non-string — both salvage away,
    // the analysis still completes from `summary` + the prose fields.
    const text = JSON.stringify({
      summary: 'A vivid dream.',
      emotionalLandscape: 'Unsettled.',
      wakingLifeConnections: 'Maybe work.',
      notableImages: 'A long hallway.',
      reflectiveQuestions: ['What felt unfinished?', 42],
      tags: { emotions: [], symbols: [], settings: [], themes: [], people: [] },
      metrics: 'not-an-object',
      crisisFlag: true,
    });
    const res = await synthesizeAnalysis(deps(fs, fakeClient({ synthesisText: text })));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.analysis.summary).toBe('A vivid dream.');
      expect(res.analysis.reflectiveQuestions).toEqual(['What felt unfinished?']); // bad element dropped
      expect(res.analysis.crisisFlag).toBe(true); // crisis signal preserved (§8)
    }
  });

  it('requires an API key', async () => {
    const fs = memFileSystem();
    await saveDream(fs, key, dream({ id: 'd1', personId: 'p1' }));
    const res = await synthesizeAnalysis({ ...deps(fs, fakeClient()), apiKey: null });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('NO_KEY');
  });

  it('approves an analysis into a dream Insight that feeds context (memory on)', async () => {
    const fs = memFileSystem();
    await saveDream(fs, key, dream({ id: 'd1', personId: 'p1' }));
    await synthesizeAnalysis(deps(fs, fakeClient()));

    const res = await approveAnalysis({
      fs,
      key,
      personId: 'p1',
      dreamId: 'd1',
      memoryEnabled: true,
      now: new Date('2026-06-11T11:00:00.000Z'),
    });
    expect(res.ok).toBe(true);

    const insights = await listInsightsForPerson(fs, key, 'p1');
    expect(insights).toHaveLength(1);
    expect(insights[0]?.source).toBe('dream');
    expect(insights[0]?.provenance.dreamId).toBe('d1');
    expect(insights[0]?.approved).toBe(true);
    // The approved dream insight now feeds the coach's context.
    expect(await summarizeForContext(fs, key, 'p1', [])).toContain(VALID_DRAFT.summary);
    if (res.ok) expect((await getAnalysis(fs, key, 'p1', 'd1'))?.insightId).toBe(res.insightId);
  });

  it('preserves a fact’s per-person sharing across a re-approval (an edit keeps who it’s shared with)', async () => {
    const fs = memFileSystem();
    await saveDream(fs, key, dream({ id: 'd1', personId: 'p1' }));
    await synthesizeAnalysis(deps(fs, fakeClient()));
    const first = await approveAnalysis({
      fs,
      key,
      personId: 'p1',
      dreamId: 'd1',
      memoryEnabled: true,
      now: new Date('2026-06-11T11:00:00.000Z'),
    });
    if (!first.ok) throw new Error('approve failed');

    // Share the first fact with someone, then re-approve (as an edit would) — the share must survive.
    const insight = await getInsight(fs, key, 'p1', first.insightId);
    if (!insight) throw new Error('expected an insight');
    const factId = insight.facts[0]?.id;
    if (!factId) throw new Error('expected a fact');
    await saveInsight(fs, key, {
      ...insight,
      facts: insight.facts.map((fact) =>
        fact.id === factId ? { ...fact, shareableWith: ['p2'] } : fact,
      ),
    });

    await approveAnalysis({
      fs,
      key,
      personId: 'p1',
      dreamId: 'd1',
      memoryEnabled: true,
      now: new Date('2026-06-11T12:00:00.000Z'),
    });
    const after = await getInsight(fs, key, 'p1', first.insightId);
    expect(after?.facts.find((fact) => fact.id === factId)?.shareableWith).toEqual(['p2']);
  });

  it('refuses to approve when dream memory is disabled', async () => {
    const fs = memFileSystem();
    await saveDream(fs, key, dream({ id: 'd1', personId: 'p1' }));
    await synthesizeAnalysis(deps(fs, fakeClient()));

    const res = await approveAnalysis({
      fs,
      key,
      personId: 'p1',
      dreamId: 'd1',
      memoryEnabled: false,
      now: new Date('2026-06-11T11:00:00.000Z'),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('MEMORY_DISABLED');
    expect(await listInsightsForPerson(fs, key, 'p1')).toEqual([]);
  });

  it('removes a dream analysis from context (deletes the insight + unlinks)', async () => {
    const fs = memFileSystem();
    await saveDream(fs, key, dream({ id: 'd1', personId: 'p1' }));
    await synthesizeAnalysis(deps(fs, fakeClient()));
    await approveAnalysis({
      fs,
      key,
      personId: 'p1',
      dreamId: 'd1',
      memoryEnabled: true,
      now: new Date('2026-06-11T11:00:00.000Z'),
    });

    await removeFromContext({
      fs,
      key,
      personId: 'p1',
      dreamId: 'd1',
      now: new Date('2026-06-11T12:00:00.000Z'),
    });
    expect(await listInsightsForPerson(fs, key, 'p1')).toEqual([]);
    expect((await getAnalysis(fs, key, 'p1', 'd1'))?.insightId).toBeUndefined();
  });

  it('re-synthesizing drops the prior approved insight (it must be re-approved)', async () => {
    const fs = memFileSystem();
    await saveDream(fs, key, dream({ id: 'd1', personId: 'p1' }));
    await synthesizeAnalysis(deps(fs, fakeClient()));
    await approveAnalysis({
      fs,
      key,
      personId: 'p1',
      dreamId: 'd1',
      memoryEnabled: true,
      now: new Date('2026-06-11T11:00:00.000Z'),
    });
    expect(await listInsightsForPerson(fs, key, 'p1')).toHaveLength(1);

    await synthesizeAnalysis(deps(fs, fakeClient()));
    expect(await listInsightsForPerson(fs, key, 'p1')).toEqual([]);
    expect((await getAnalysis(fs, key, 'p1', 'd1'))?.insightId).toBeUndefined();
  });

  it('meters the paid synthesis call even when the output fails to parse', async () => {
    const fs = memFileSystem();
    await saveDream(fs, key, dream({ id: 'd1', personId: 'p1' }));
    const res = await synthesizeAnalysis(deps(fs, fakeClient({ synthesisText: 'no json here' })));
    expect(res.ok).toBe(false);
    const events = await queryUsage(fs, key, {
      from: '2026-01-01T00:00:00.000Z',
      to: '2027-01-01T00:00:00.000Z',
      personId: 'p1',
      type: 'dream.analyze',
    });
    expect(events).toHaveLength(1); // the tokens were spent, so the call is metered regardless of parse
  });

  it('deleting a dream KEEPS its linked insight (the coach’s memory persists, spec 20 §3.7)', async () => {
    const fs = memFileSystem();
    await saveDream(fs, key, dream({ id: 'd1', personId: 'p1' }));
    await synthesizeAnalysis(deps(fs, fakeClient()));
    await approveAnalysis({
      fs,
      key,
      personId: 'p1',
      dreamId: 'd1',
      memoryEnabled: true,
      now: new Date('2026-06-11T11:00:00.000Z'),
    });
    expect(await listInsightsForPerson(fs, key, 'p1')).toHaveLength(1);

    // Deleting the dream removes the dream itself but leaves the insight intact — it's the coach's memory.
    await deleteDream(fs, 'p1', 'd1');
    expect(await getDream(fs, key, 'p1', 'd1')).toBeNull();
    expect(await listInsightsForPerson(fs, key, 'p1')).toHaveLength(1);
  });

  it("feeds a People-graph-linked dream person's shareable context to the prompt, never their private notes", async () => {
    const fs = memFileSystem();
    // The dreamer + a linked person who appeared in the dream.
    await savePerson(fs, key, {
      id: 'p1',
      schemaVersion: 1,
      displayName: 'Alex',
      isSubject: true,
      tags: [],
      createdAt: 'now',
      updatedAt: 'now',
    });
    await savePerson(fs, key, {
      id: 'sis',
      schemaVersion: 1,
      displayName: 'Robin',
      isSubject: true,
      tags: [],
      notes: 'Alex’s sister, a teacher', // shared by default → reaches the linked-people context
      healthNotes: 'ROBIN-PRIVATE-NOTE',
      privateFields: ['healthNotes'], // locked → must never reach a related person's prompt (15 §5)
      createdAt: 'now',
      updatedAt: 'now',
    });
    await saveRelationship(fs, key, {
      id: 'r1',
      schemaVersion: 1,
      fromPersonId: 'p1',
      toPersonId: 'sis',
      type: 'sibling',
      createdAt: 'now',
      updatedAt: 'now',
    });
    await saveDream(
      fs,
      key,
      dream({ id: 'd1', personId: 'p1', people: [{ personId: 'sis' }, { name: 'a stranger' }] }),
    );

    let captured = '';
    const recordingClient: ClaudeClient = {
      send: () => Promise.resolve(''),
      stream: (options) => {
        captured = options.system ?? '';
        return Promise.resolve({
          text: JSON.stringify(VALID_DRAFT),
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };

    await synthesizeAnalysis(deps(fs, recordingClient));
    expect(captured).toContain('appeared in this dream');
    expect(captured).toContain('Robin');
    expect(captured).toContain('(sibling)');
    expect(captured).toContain('Alex’s sister, a teacher'); // shared notes reach the prompt
    expect(captured).not.toContain('ROBIN-PRIVATE-NOTE'); // a LOCKED field never reaches the prompt
  });

  // --- §15.4: the coach-first opener + the DREAM_READY readiness marker ---

  it('opens the reflection coach-first (assistant speaks first), meters dream.analyze, and stays out of Sessions', async () => {
    const fs = memFileSystem();
    await saveDream(fs, key, dream({ id: 'd1', personId: 'p1' }));

    const res = await openReflection({
      ...deps(
        fs,
        fakeClient({ reply: 'You were back in your childhood home. What stood out most?' }),
      ),
      onDelta: () => {},
    });

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('opener failed');
    // The coach speaks FIRST — a single assistant message, no synthetic user instruction persisted.
    expect(res.conversation.messages.map((m) => m.role)).toEqual(['assistant']);
    expect(res.conversation.messages[0]?.content).toContain('childhood home');
    expect(res.usage?.type).toBe('dream.analyze');
    expect((await getDream(fs, key, 'p1', 'd1'))?.status).toBe('analyzing');
    // Persisted under the dream — never in the Sessions list.
    expect(await listConversations(fs, key, 'p1')).toEqual([]);
    const stored = await getDreamConversation(fs, key, 'p1', 'd1');
    expect(stored?.messages).toHaveLength(1);
  });

  it('is idempotent — an already-opened reflection resumes with no extra spend', async () => {
    const fs = memFileSystem();
    await saveDream(fs, key, dream({ id: 'd1', personId: 'p1' }));
    await openReflection({ ...deps(fs, fakeClient()), onDelta: () => {} });

    let calls = 0;
    const counting: ClaudeClient = {
      send: () => Promise.resolve(''),
      stream: (_options, onDelta) => {
        calls += 1;
        onDelta('again');
        return Promise.resolve({
          text: 'again',
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    const res = await openReflection({ ...deps(fs, counting), onDelta: () => {} });

    expect(calls).toBe(0); // no second model call
    expect(res.ok && res.conversation.messages).toHaveLength(1);
    expect(res.ok && res.usage).toBeUndefined();
  });

  it('falls back to a warm static opener (no spend) when there is no key', async () => {
    const fs = memFileSystem();
    await saveDream(fs, key, dream({ id: 'd1', personId: 'p1' }));

    const res = await openReflection({
      ...deps(fs, fakeClient()),
      apiKey: null,
      onDelta: () => {},
    });

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('opener failed');
    expect(res.conversation.messages).toHaveLength(1);
    expect(res.conversation.messages[0]?.role).toBe('assistant');
    expect(res.usage).toBeUndefined();
    expect(
      await queryUsage(fs, key, {
        from: '2000-01-01T00:00:00.000Z',
        to: '2100-01-01T00:00:00.000Z',
      }),
    ).toEqual([]); // nothing metered
  });

  it('falls back to a static opener (no spend) when over budget', async () => {
    const fs = memFileSystem();
    await saveDream(fs, key, dream({ id: 'd1', personId: 'p1' }));
    await setPersonBudget(fs, key, 'p1', { limitUsd: 0, period: 'week', warnRatio: 0.8 });

    const res = await openReflection({ ...deps(fs, fakeClient()), onDelta: () => {} });

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('opener failed');
    expect(res.conversation.messages).toHaveLength(1);
    expect(res.usage).toBeUndefined();
    expect(
      await queryUsage(fs, key, {
        from: '2000-01-01T00:00:00.000Z',
        to: '2100-01-01T00:00:00.000Z',
      }),
    ).toEqual([]);
  });

  it('surfaces analysisReady + strips the marker when the coach signals it has enough', async () => {
    const fs = memFileSystem();
    await saveDream(fs, key, dream({ id: 'd1', personId: 'p1' }));

    const res = await runAnalysisTurn({
      ...deps(
        fs,
        fakeClient({ reply: `Thank you for sharing all of that. ${DREAM_READY_MARKER}` }),
      ),
      userText: 'That is everything I remember.',
      onDelta: () => {},
    });

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('turn failed');
    expect(res.analysisReady).toBe(true);
    // The marker never persists or shows.
    const saved = res.conversation.messages.at(-1)?.content ?? '';
    expect(saved).not.toContain(DREAM_READY_MARKER);
    expect(saved).toBe('Thank you for sharing all of that.');
  });

  it('leaves analysisReady unset on an ordinary turn (no marker)', async () => {
    const fs = memFileSystem();
    await saveDream(fs, key, dream({ id: 'd1', personId: 'p1' }));

    const res = await runAnalysisTurn({
      ...deps(fs, fakeClient({ reply: 'Tell me more about how it felt.' })),
      userText: 'It was strange.',
      onDelta: () => {},
    });

    expect(res.ok && res.analysisReady).toBeUndefined();
  });

  it('stripDreamMarkers removes the full token and a mid-stream partial', () => {
    expect(stripDreamMarkers(`A reflection. ${DREAM_READY_MARKER}`)).toBe('A reflection.');
    // A partial marker still arriving mid-stream is trimmed too (no flash).
    expect(stripDreamMarkers('A reflection. [[SELFOS:DREAM_RE')).toBe('A reflection.');
    expect(stripDreamMarkers('Nothing to strip here')).toBe('Nothing to strip here');
  });
});

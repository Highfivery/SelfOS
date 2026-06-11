import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { ClaudeClient } from '../host';
import type { Dream } from '../schemas';
import { listConversations } from '../conversations';
import { listInsightsForPerson, summarizeForContext } from '../insights';
import { queryUsage } from '../usage';
import { getAnalysis, getDream, getDreamConversation, saveDream } from './dreamService';
import {
  approveAnalysis,
  purgeDream,
  removeFromContext,
  runAnalysisTurn,
  synthesizeAnalysis,
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
      const last = options.messages.at(-1)?.content ?? '';
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

  it('returns ERROR when the synthesis output is not valid JSON', async () => {
    const fs = memFileSystem();
    await saveDream(fs, key, dream({ id: 'd1', personId: 'p1' }));
    const res = await synthesizeAnalysis(
      deps(fs, fakeClient({ synthesisText: 'sorry, no json here' })),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('ERROR');
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

  it('purgeDream deletes the dream AND its linked insight (no orphan feeding the coach)', async () => {
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

    await purgeDream(fs, key, 'p1', 'd1');
    expect(await getDream(fs, key, 'p1', 'd1')).toBeNull();
    expect(await listInsightsForPerson(fs, key, 'p1')).toEqual([]);
  });
});

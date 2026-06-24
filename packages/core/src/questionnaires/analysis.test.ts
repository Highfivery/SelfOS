import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { ClaudeClient, FileSystem } from '../host';
import { listAllInsights, updateInsight } from '../insights';
import { createAssignment } from './assignmentService';
import { saveQuestionnaire } from './questionnaireService';
import { saveResponse } from './responseService';
import { analyzeAssignment, extractJsonObject } from './analysisService';
import type { AiDeps } from './generationService';

const key = generateMasterKey();
const now = new Date('2026-06-11T12:00:00.000Z');

function fakeClient(text: string): ClaudeClient {
  return {
    send: () => Promise.resolve(text),
    stream: (_options, onDelta) => {
      onDelta(text);
      return Promise.resolve({
        text,
        usage: { inputTokens: 10, outputTokens: 20, cacheWriteTokens: 0, cacheReadTokens: 0 },
      });
    },
  };
}

function deps(fs: FileSystem, client: ClaudeClient): AiDeps {
  return { fs, key, client, apiKey: 'sk-x', model: 'claude-sonnet-4-6', personId: 'p1', now };
}

const ANALYSIS = JSON.stringify({
  summary: 'They want more connection and protected time together.',
  facts: [
    { text: 'Wants more regular date nights', shareable: true },
    { text: 'Has been feeling distant lately', shareable: false },
  ],
  confidence: 'high',
  crisisFlag: false,
});

async function seedAnswered(fs: FileSystem): Promise<string> {
  const q = await saveQuestionnaire(fs, key, {
    title: 'Weekly check-in',
    type: 'role-feedback',
    sensitivity: 'standard',
    questions: [{ id: 'q1', type: 'shortText', prompt: 'How are we doing?', required: true }],
  });
  const a = await createAssignment(fs, key, {
    questionnaireId: q.id,
    senderPersonId: 'p1',
    recipient: { kind: 'person', personId: 'p2' },
    channel: 'inApp',
    privacy: 'standard',
    senderVisibleToRecipient: true,
  });
  await saveResponse(fs, key, {
    id: 'r1',
    schemaVersion: 1,
    assignmentId: a.id,
    answers: [{ questionId: 'q1', value: 'Really well, but I’d love more date nights.' }],
    submittedAt: now.toISOString(),
  });
  return a.id;
}

describe('extractJsonObject', () => {
  it('pulls a JSON object out of fenced / prose-wrapped text', () => {
    expect(extractJsonObject('Here:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJsonObject('no object')).toBeNull();
  });
});

describe('analyzeAssignment', () => {
  it('turns answers into a saved, UNapproved Insight for the sender', async () => {
    const fs = memFileSystem();
    const assignmentId = await seedAnswered(fs);
    const result = await analyzeAssignment(deps(fs, fakeClient(ANALYSIS)), { assignmentId });

    expect(result.ok).toBe(true);
    expect(result.insight?.subjectPersonId).toBe('p1'); // informs the SENDER's coaching
    expect(result.insight?.approved).toBe(false); // needs the approve-step first
    expect(result.insight?.source).toBe('questionnaire');
    expect(result.insight?.provenance.assignmentId).toBe(assignmentId);
    expect(result.insight?.facts.map((f) => f.shareable)).toEqual([true, false]);
    expect(result.usage?.type).toBe('questionnaire.analyze');

    // It's persisted and shows up in the Memory surface (listAllInsights).
    const all = await listAllInsights(fs, key);
    expect(all.map((i) => i.id)).toContain(result.insight?.id);
    // …but it does NOT yet feed buildContext (unapproved) — proven by listInsightsForPerson approval state.
    expect(all.find((i) => i.id === result.insight?.id)?.approved).toBe(false);
  });

  it('carries a model crisis flag through to the Insight', async () => {
    const fs = memFileSystem();
    const assignmentId = await seedAnswered(fs);
    const crisis = JSON.stringify({
      summary: 'They mention feeling hopeless.',
      facts: [{ text: 'Expressed hopelessness', shareable: false }],
      confidence: 'medium',
      crisisFlag: true,
    });
    const result = await analyzeAssignment(deps(fs, fakeClient(crisis)), { assignmentId });
    expect(result.insight?.crisisFlag).toBe(true);
  });

  it('returns NO_RESPONSE when the assignment has no answers', async () => {
    const fs = memFileSystem();
    const q = await saveQuestionnaire(fs, key, {
      title: 'Unanswered',
      type: 'role-feedback',
      sensitivity: 'standard',
      questions: [{ id: 'q1', type: 'shortText', prompt: 'Hi?', required: true }],
    });
    const a = await createAssignment(fs, key, {
      questionnaireId: q.id,
      senderPersonId: 'p1',
      recipient: { kind: 'person', personId: 'p2' },
      channel: 'inApp',
      privacy: 'standard',
      senderVisibleToRecipient: true,
    });
    expect(
      await analyzeAssignment(deps(fs, fakeClient(ANALYSIS)), { assignmentId: a.id }),
    ).toMatchObject({
      ok: false,
      reason: 'NO_RESPONSE',
    });
  });

  it('refuses to analyze an unsubmitted draft (saved progress, no submittedAt)', async () => {
    const fs = memFileSystem();
    const assignmentId = await seedAnswered(fs);
    // Overwrite the seeded (submitted) response with a draft — a saved-but-unsubmitted ResponseSet.
    await saveResponse(fs, key, {
      id: 'r1',
      schemaVersion: 1,
      assignmentId,
      answers: [{ questionId: 'q1', value: 'still thinking…' }],
    });
    expect(await analyzeAssignment(deps(fs, fakeClient(ANALYSIS)), { assignmentId })).toMatchObject(
      { ok: false, reason: 'NO_RESPONSE' },
    );
  });

  it('re-analyzing the same assignment overwrites its Insight (no duplicate)', async () => {
    const fs = memFileSystem();
    const assignmentId = await seedAnswered(fs);
    const first = await analyzeAssignment(deps(fs, fakeClient(ANALYSIS)), { assignmentId });
    const second = await analyzeAssignment(deps(fs, fakeClient(ANALYSIS)), { assignmentId });
    expect(second.insight?.id).toBe(first.insight?.id); // same id reused
    expect((await listAllInsights(fs, key)).length).toBe(1); // not duplicated
  });

  it('degrades to REFUSED on a refusal-shaped reply', async () => {
    const fs = memFileSystem();
    const assignmentId = await seedAnswered(fs);
    expect(
      await analyzeAssignment(deps(fs, fakeClient('I cannot help.')), { assignmentId }),
    ).toMatchObject({ ok: false, reason: 'REFUSED' });
  });

  it('returns an honest MALFORMED (not a data blame) on no-JSON junk', async () => {
    const fs = memFileSystem();
    const assignmentId = await seedAnswered(fs);
    expect(
      await analyzeAssignment(deps(fs, fakeClient('just some prose, no json')), { assignmentId }),
    ).toMatchObject({ ok: false, reason: 'MALFORMED' });
  });

  it('salvages the good facts, dropping a malformed one (per-element, 37 §3.1)', async () => {
    const fs = memFileSystem();
    const assignmentId = await seedAnswered(fs);
    // The 2nd fact is missing `shareable` → it drops; the 1st survives.
    const text = JSON.stringify({
      summary: 'A useful summary.',
      facts: [{ text: 'Good fact', shareable: true }, { text: 'No shareable flag' }],
    });
    const result = await analyzeAssignment(deps(fs, fakeClient(text)), { assignmentId });
    expect(result.ok).toBe(true);
    expect(result.insight?.facts.map((f) => f.text)).toEqual(['Good fact']);
  });

  it('salvages the summary from a TRUNCATED reply (produces a partial Insight)', async () => {
    const fs = memFileSystem();
    const assignmentId = await seedAnswered(fs);
    const truncated = '{"summary":"They want more connection.","facts":[{"text":"incomp';
    const result = await analyzeAssignment(deps(fs, fakeClient(truncated)), { assignmentId });
    expect(result.ok).toBe(true);
    expect(result.insight?.summary).toBe('They want more connection.');
    expect(result.insight?.facts).toEqual([]); // the cut-off fact is dropped
  });
});

describe('insightStore — approve-step + Memory', () => {
  it('approves an Insight (it then enters context) and updates its shareable facts', async () => {
    const fs = memFileSystem();
    const assignmentId = await seedAnswered(fs);
    const { insight } = await analyzeAssignment(deps(fs, fakeClient(ANALYSIS)), { assignmentId });
    if (!insight) throw new Error('expected an insight');

    const approved = await updateInsight(fs, key, insight.subjectPersonId, insight.id, {
      approved: true,
      summary: 'Edited: wants more protected time together.',
      facts: insight.facts.map((f) => ({ ...f, shareable: true })),
    });
    expect(approved?.approved).toBe(true);
    expect(approved?.summary).toContain('Edited');
    expect(approved?.facts.every((f) => f.shareable)).toBe(true);
    expect(approved?.updatedAt).not.toBe(insight.updatedAt); // bumped
  });
});

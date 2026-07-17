import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { ClaudeClient, FileSystem } from '../host';
import { listAllInsights, updateInsight } from '../insights';
import { createAssignment } from './assignmentService';
import { saveQuestionnaire } from './questionnaireService';
import { getResponse, saveResponse } from './responseService';
import {
  analyzeAssignment,
  extractJsonObject,
  isAnalysisStale,
  responseRevision,
} from './analysisService';
import type { Insight, ResponseSet } from '../schemas';
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
    // Stamped WHO it's about (#129) — the recipient (p2), not the sender (p1) — so Memory groups it as a
    // response, never mislabels it "about you."
    expect(result.insight?.provenance.aboutPersonId).toBe('p2');
    expect(result.insight?.provenance.aboutName).toBeUndefined();
    expect(result.insight?.facts.map((f) => f.shareable)).toEqual([true, false]);
    expect(result.usage?.type).toBe('questionnaire.analyze');

    // It's persisted and shows up in the Memory surface (listAllInsights).
    const all = await listAllInsights(fs, key);
    expect(all.map((i) => i.id)).toContain(result.insight?.id);
    // …but it does NOT yet feed buildContext (unapproved) — proven by listInsightsForPerson approval state.
    expect(all.find((i) => i.id === result.insight?.id)?.approved).toBe(false);
  });

  it('EXCLUDES a per-question decline from the analyzed answers (a skip is not signal — §25.5)', async () => {
    const fs = memFileSystem();
    const q = await saveQuestionnaire(fs, key, {
      title: 'Check-in',
      type: 'role-feedback',
      sensitivity: 'standard',
      questions: [
        { id: 'q1', type: 'shortText', prompt: 'How are we doing?', required: true },
        { id: 'q2', type: 'shortText', prompt: 'What secretly worries you most?', required: false },
      ],
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
      answers: [
        { questionId: 'q1', value: 'Pretty well.' },
        // q2 was SKIPPED with a reason — it must never reach the model as an answer, nor its prompt.
        { questionId: 'q2', value: { declined: true, reason: 'Prefer not to say' } },
      ],
      submittedAt: now.toISOString(),
    });

    // Capture the exact user message sent to Claude.
    const seen: string[] = [];
    const client: ClaudeClient = {
      send: () => Promise.resolve(ANALYSIS),
      stream: (options, onDelta) => {
        seen.push(JSON.stringify(options));
        onDelta(ANALYSIS);
        return Promise.resolve({
          text: ANALYSIS,
          usage: { inputTokens: 10, outputTokens: 20, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    const result = await analyzeAssignment(deps(fs, client), { assignmentId: a.id });
    expect(result.ok).toBe(true);
    const prompt = seen.join('\n');
    expect(prompt).toContain('How are we doing?'); // the answered question IS analyzed
    expect(prompt).toContain('Pretty well.');
    expect(prompt).not.toContain('What secretly worries you most?'); // the skipped question is NOT
    expect(prompt).not.toContain('Prefer not to say'); // and the skip reason never leaks to the model
    expect(prompt).not.toContain('Skipped');
  });

  it('stamps NO about-person for a self check-in (recipient === sender) — it stays "about you"', async () => {
    const fs = memFileSystem();
    const q = await saveQuestionnaire(fs, key, {
      title: 'Self check-in',
      type: 'role-feedback',
      sensitivity: 'standard',
      questions: [{ id: 'q1', type: 'shortText', prompt: 'How am I?', required: true }],
    });
    const a = await createAssignment(fs, key, {
      questionnaireId: q.id,
      senderPersonId: 'p1',
      recipient: { kind: 'person', personId: 'p1' }, // sending to yourself
      channel: 'inApp',
      privacy: 'standard',
      senderVisibleToRecipient: true,
    });
    await saveResponse(fs, key, {
      id: 'r-self',
      schemaVersion: 1,
      assignmentId: a.id,
      answers: [{ questionId: 'q1', value: 'Doing okay.' }],
      submittedAt: now.toISOString(),
    });
    const result = await analyzeAssignment(deps(fs, fakeClient(ANALYSIS)), { assignmentId: a.id });
    expect(result.insight?.provenance.aboutPersonId).toBeUndefined();
    expect(result.insight?.provenance.aboutName).toBeUndefined();
  });

  it('stamps an external recipient by name', async () => {
    const fs = memFileSystem();
    const q = await saveQuestionnaire(fs, key, {
      title: 'External send',
      type: 'role-feedback',
      sensitivity: 'standard',
      questions: [{ id: 'q1', type: 'shortText', prompt: 'Hi?', required: true }],
    });
    const a = await createAssignment(fs, key, {
      questionnaireId: q.id,
      senderPersonId: 'p1',
      recipient: { kind: 'external', displayName: 'Sam Rivers' },
      channel: 'relay',
      privacy: 'standard',
      senderVisibleToRecipient: true,
    });
    await saveResponse(fs, key, {
      id: 'r-ext',
      schemaVersion: 1,
      assignmentId: a.id,
      answers: [{ questionId: 'q1', value: 'Good.' }],
      submittedAt: now.toISOString(),
    });
    const result = await analyzeAssignment(deps(fs, fakeClient(ANALYSIS)), { assignmentId: a.id });
    expect(result.insight?.provenance.aboutPersonId).toBeUndefined();
    expect(result.insight?.provenance.aboutName).toBe('Sam Rivers');
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

  it('drops a branch-hidden orphan answer from analysis (47 §3.3/§7)', async () => {
    const fs = memFileSystem();
    const q = await saveQuestionnaire(fs, key, {
      title: 'Branchy',
      type: 'role-feedback',
      sensitivity: 'standard',
      questions: [
        {
          id: 'gate',
          type: 'singleChoice',
          prompt: 'Any concerns?',
          required: false,
          options: ['Yes', 'No'],
        },
        {
          id: 'detail',
          type: 'shortText',
          prompt: 'Tell me more',
          required: false,
          branch: { whenQuestionId: 'gate', equals: 'Yes', action: 'show' },
        },
      ],
    });
    const a = await createAssignment(fs, key, {
      questionnaireId: q.id,
      senderPersonId: 'p1',
      recipient: { kind: 'person', personId: 'p2' },
      channel: 'inApp',
      privacy: 'standard',
      senderVisibleToRecipient: true,
    });
    // The gate is "No" (so `detail` is hidden), but a stale orphan `detail` answer persists (a draft from
    // before the submit-side fix). Analysis must not feed it to the model as if it were chosen.
    await saveResponse(fs, key, {
      id: 'r1',
      schemaVersion: 1,
      assignmentId: a.id,
      answers: [
        { questionId: 'gate', value: 'No' },
        { questionId: 'detail', value: 'ORPHAN-SECRET' },
      ],
      submittedAt: now.toISOString(),
    });
    let userMsg = '';
    const client: ClaudeClient = {
      send: () => Promise.resolve(ANALYSIS),
      stream: (options, onDelta) => {
        userMsg = String(options.messages.at(-1)?.content ?? '');
        onDelta(ANALYSIS);
        return Promise.resolve({
          text: ANALYSIS,
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    const result = await analyzeAssignment(deps(fs, client), { assignmentId: a.id });
    expect(result.ok).toBe(true);
    expect(userMsg).toContain('Any concerns?'); // the visible question is analyzed
    expect(userMsg).not.toContain('ORPHAN-SECRET'); // the hidden orphan is not
  });

  it('re-analyzing the same assignment overwrites its Insight (no duplicate)', async () => {
    const fs = memFileSystem();
    const assignmentId = await seedAnswered(fs);
    const first = await analyzeAssignment(deps(fs, fakeClient(ANALYSIS)), { assignmentId });
    const second = await analyzeAssignment(deps(fs, fakeClient(ANALYSIS)), { assignmentId });
    expect(second.insight?.id).toBe(first.insight?.id); // same id reused
    expect((await listAllInsights(fs, key)).length).toBe(1); // not duplicated
  });

  it('stamps analyzedRevision from the response (56 §4) — defaulting a pre-56 response to 1', async () => {
    const fs = memFileSystem();
    const assignmentId = await seedAnswered(fs); // seeded response has no `revision` → reads as 1
    const result = await analyzeAssignment(deps(fs, fakeClient(ANALYSIS)), { assignmentId });
    expect(result.insight?.provenance.analyzedRevision).toBe(1);

    // Re-submit at revision 2 → re-analyze stamps 2.
    const r = await getResponse(fs, key, assignmentId);
    await saveResponse(fs, key, { ...r!, revision: 2, submittedAt: now.toISOString() });
    const re = await analyzeAssignment(deps(fs, fakeClient(ANALYSIS)), { assignmentId });
    expect(re.insight?.provenance.analyzedRevision).toBe(2);
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

describe('isAnalysisStale + responseRevision (56)', () => {
  const resp = (over: Partial<ResponseSet> = {}): ResponseSet => ({
    id: 'r1',
    schemaVersion: 1,
    assignmentId: 'a1',
    answers: [],
    submittedAt: '2026-06-11T12:00:00.000Z',
    ...over,
  });
  const ins = (analyzedRevision?: number): Insight =>
    ({
      id: 'i1',
      provenance: {
        assignmentId: 'a1',
        at: 'now',
        ...(analyzedRevision ? { analyzedRevision } : {}),
      },
    }) as Insight;

  it('a pre-56 response reads as revision 1', () => {
    expect(responseRevision(resp())).toBe(1);
    expect(responseRevision(resp({ revision: 3 }))).toBe(3);
  });

  it('is false with no insight, no submission, or matching revisions; true when the response is ahead', () => {
    expect(isAnalysisStale(resp({ revision: 2 }), null)).toBe(false); // never analyzed
    expect(isAnalysisStale(resp({ submittedAt: undefined }), ins(1))).toBe(false); // an unsubmitted draft
    expect(isAnalysisStale(resp({ revision: 1 }), ins(1))).toBe(false); // analyzed at the current revision
    expect(isAnalysisStale(resp({ revision: 2 }), ins(1))).toBe(true); // edited since → stale
    // pre-56 insight (no analyzedRevision → 1): an un-edited (revision 1) send is NOT falsely stale.
    expect(isAnalysisStale(resp(), ins())).toBe(false);
    expect(isAnalysisStale(resp({ revision: 2 }), ins())).toBe(true);
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

import { describe, expect, it, vi } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { ClaudeClient, FileSystem } from '../host';
import {
  backfillPartnerSharing,
  listAllInsights,
  listInsightsForPerson,
  updateInsight,
} from '../insights';
import { createAssignment } from './assignmentService';
import { saveQuestionnaire } from './questionnaireService';
import { getResponse, saveResponse } from './responseService';
import {
  analyzeAssignment,
  extractJsonObject,
  isAnalysisStale,
  responseRevision,
} from './analysisService';
import { buildAlignmentSystem, buildAnalysisSystem } from './aiPrompts';
import type { Insight, ResponseSet, SensitivityTier } from '../schemas';
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

/** Seed a submitted intimacy questionnaire at a given tier (for the explicit-register + empty-insight tests). */
async function seedIntimacy(fs: FileSystem, tier: SensitivityTier): Promise<string> {
  const q = await saveQuestionnaire(fs, key, {
    title: 'Desire, Depth & Us',
    type: 'intimacy',
    sensitivity: tier,
    questions: [{ id: 'q1', type: 'shortText', prompt: 'What do you crave most?', required: true }],
  });
  const a = await createAssignment(fs, key, {
    questionnaireId: q.id,
    senderPersonId: 'p1',
    recipient: { kind: 'person', personId: 'p2' },
    channel: 'inApp',
    privacy: 'private',
    senderVisibleToRecipient: true,
  });
  await saveResponse(fs, key, {
    id: 'r1',
    schemaVersion: 1,
    assignmentId: a.id,
    answers: [
      { questionId: 'q1', value: 'Slow and deliberate — drawing it out until I’m desperate.' },
    ],
    submittedAt: now.toISOString(),
  });
  return a.id;
}

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

describe('buildAnalysisSystem — register-aware (08 §22.2)', () => {
  it('appends the EXPLICIT intimacy framing for intimacy/scenario at explicit + unfiltered tiers', () => {
    for (const type of ['intimacy', 'scenario']) {
      for (const tier of ['explicit', 'unfiltered'] as const) {
        const sys = buildAnalysisSystem(type, tier);
        expect(sys).toContain('DO produce a real, substantive result');
        expect(sys).toContain('do NOT return an empty summary');
        expect(sys).toContain('consensual adults only');
      }
    }
  });

  it('leaves a STANDARD questionnaire unchanged (no explicit framing)', () => {
    const sys = buildAnalysisSystem('role-feedback', 'standard');
    expect(sys).not.toContain('DO produce a real, substantive result');
    expect(sys).not.toContain('sexually explicit');
  });

  it('uses the lighter, non-graphic note for the intimacyGeneral tier', () => {
    const sys = buildAnalysisSystem('intimacy', 'intimacyGeneral');
    expect(sys).toContain('respectful and non-graphic');
    expect(sys).not.toContain('sexually explicit'); // not the explicit register
  });

  it('applies the SAME register to the compatibility report (buildAlignmentSystem) — no half-application', () => {
    // The 08 §22.7 lesson: apply the register to EVERY read-side path that interprets intimacy content.
    const report = buildAlignmentSystem('intimacy', 'unfiltered');
    expect(report).toContain('DO produce a real, substantive result');
    expect(report).toContain('do NOT return an empty summary');
    expect(report).toContain('consensual adults only');
    // …but it's still the ALIGNMENT prompt (compatibility report), not the analysis one.
    expect(report).toContain('compatibility report');
    // Standard compatibility report is unchanged.
    expect(buildAlignmentSystem('role-feedback', 'standard')).not.toContain(
      'DO produce a real, substantive result',
    );
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
    // Facts now default to shared-with-partner (owner decision, 2026-07-17) rather than the model's per-fact
    // broadcast guess: none broadcast (`shareable:false`), each scoped to the `partner` relationship type.
    expect(result.insight?.facts.every((f) => f.shareable === false)).toBe(true);
    expect(result.insight?.facts.map((f) => f.shareableTypes)).toEqual([['partner'], ['partner']]);
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
    // The skipped question is NOT analyzed as an answer (§25.5 — a decline is never an inferred fact)…
    expect(prompt).not.toContain('A: Prefer not to say');
    // …but since §34.3 the model IS told what came back refused, under a framing that forbids reading
    // anything about the PERSON into it. The question text is the sender's own, so it is always safe.
    expect(prompt).toContain('What secretly worries you most?');
    expect(prompt).toContain('NEVER infer a trait');
    // This send is STANDARD — the sender may see the answers, so the recipient's own words may steer.
    expect(prompt).toContain('Prefer not to say');
  });

  it('a PRIVATE send tells the model NOTHING about what was skipped (08 §34.2/§34.3)', async () => {
    const fs = memFileSystem();
    const q = await saveQuestionnaire(fs, key, {
      title: 'Check-in',
      type: 'role-feedback',
      sensitivity: 'standard',
      questions: [
        { id: 'q1', type: 'shortText', prompt: 'How are we doing?', required: true },
        { id: 'q2', type: 'shortText', prompt: 'How is your mother?', required: false },
      ],
    });
    const a = await createAssignment(fs, key, {
      questionnaireId: q.id,
      senderPersonId: 'p1',
      recipient: { kind: 'person', personId: 'p2' },
      channel: 'inApp',
      // The promise the recipient was shown: "they won't see your written answers". A skip reason IS a
      // written answer, and the insight summary this call produces is what crosses back to the sender.
      privacy: 'private',
      senderVisibleToRecipient: true,
    });
    await saveResponse(fs, key, {
      id: 'r1',
      schemaVersion: 1,
      assignmentId: a.id,
      answers: [
        { questionId: 'q1', value: 'Pretty well.' },
        {
          questionId: 'q2',
          value: { declined: true, reason: 'she died in March and I can’t talk about it' },
        },
      ],
      submittedAt: new Date().toISOString(),
    });
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
    // Her words: never, obviously.
    expect(prompt).not.toContain('she died in March');
    // But not the mapping either. The sender has no route to "which question did she decline" on a private
    // send — the bridge withholds the answers, the aggregate excludes the send, the card's summary is counts
    // with no question attached — and the insight summary this call writes DOES reach them. So the refusal
    // block must be absent entirely, not merely stripped of its reasons.
    expect(prompt).not.toContain('QUESTIONS THEY DID NOT ANSWER');
    expect(prompt).not.toContain('skipped it');
    expect(prompt).not.toContain('preferred not to say');
    // The answered question is still analysed as normal — this withholds the refusal, not the response.
    expect(prompt).toContain('Pretty well.');
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

  it('sends the EXPLICIT analysis register to the model for an intimacy questionnaire (the empty-insight fix, 08 §22.2)', async () => {
    const fs = memFileSystem();
    const assignmentId = await seedIntimacy(fs, 'unfiltered');
    let sentSystem = '';
    const client: ClaudeClient = {
      send: () => Promise.resolve(ANALYSIS),
      stream: (options, onDelta) => {
        sentSystem = options.system ?? '';
        onDelta(ANALYSIS);
        return Promise.resolve({
          text: ANALYSIS,
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    await analyzeAssignment(deps(fs, client), { assignmentId });
    // The system prompt the model actually receives carries the frank register + the "don't return empty"
    // direction + the consensual-adult boundary — this is what fixes the valid-but-empty analysis.
    expect(sentSystem).toContain('DO produce a real, substantive result');
    expect(sentSystem).toContain('do NOT return an empty summary');
    expect(sentSystem).toContain('consensual adults only');
  });

  it('does NOT send the explicit register for a STANDARD questionnaire (register scoped to intimacy)', async () => {
    const fs = memFileSystem();
    const assignmentId = await seedAnswered(fs); // role-feedback / standard
    let sentSystem = '';
    const client: ClaudeClient = {
      send: () => Promise.resolve(ANALYSIS),
      stream: (options, onDelta) => {
        sentSystem = options.system ?? '';
        onDelta(ANALYSIS);
        return Promise.resolve({
          text: ANALYSIS,
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    await analyzeAssignment(deps(fs, client), { assignmentId });
    expect(sentSystem).not.toContain('DO produce a real, substantive result');
    expect(sentSystem).not.toContain('sexually explicit');
  });

  it('returns an honest EMPTY (not MALFORMED) when the model returns a valid but empty analysis', async () => {
    const fs = memFileSystem();
    const assignmentId = await seedIntimacy(fs, 'unfiltered');
    // The exact shape the live model returned for the reported case: well-formed JSON, empty summary + facts.
    const empty = JSON.stringify({
      summary: '',
      facts: [],
      confidence: 'low',
      categories: ['Other'],
      crisisFlag: false,
    });
    const result = await analyzeAssignment(deps(fs, fakeClient(empty)), { assignmentId });
    // Before the fix this fell through to MALFORMED ("unexpected shape, try again") — now it's an honest EMPTY.
    expect(result).toMatchObject({ ok: false, reason: 'EMPTY' });
    expect(result.message).toContain('draw an insight');
    // A billed call is still metered even on an empty result.
    expect(result.usage?.type).toBe('questionnaire.analyze');
  });

  it('treats a WHITESPACE-only summary as EMPTY too (not a near-blank Insight)', async () => {
    const fs = memFileSystem();
    const assignmentId = await seedIntimacy(fs, 'unfiltered');
    // `"   "` used to pass `z.string().min(1)` and save a near-blank Insight; now it routes to EMPTY.
    const blank = JSON.stringify({
      summary: '   ',
      facts: [],
      confidence: 'low',
      crisisFlag: false,
    });
    const result = await analyzeAssignment(deps(fs, fakeClient(blank)), { assignmentId });
    expect(result).toMatchObject({ ok: false, reason: 'EMPTY' });
    expect(result.insight).toBeUndefined();
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

  it('a PRIVATE send with every answer skipped stays EMPTY and spends NOTHING (08 §34.3)', async () => {
    const fs = memFileSystem();
    const q = await saveQuestionnaire(fs, key, {
      title: 'Check-in',
      type: 'role-feedback',
      sensitivity: 'standard',
      questions: [{ id: 'q1', type: 'shortText', prompt: 'How are we doing?', required: true }],
    });
    const a = await createAssignment(fs, key, {
      questionnaireId: q.id,
      senderPersonId: 'p1',
      recipient: { kind: 'person', personId: 'p2' },
      channel: 'inApp',
      privacy: 'private',
      senderVisibleToRecipient: true,
    });
    await saveResponse(fs, key, {
      id: 'r1',
      schemaVersion: 1,
      assignmentId: a.id,
      answers: [{ questionId: 'q1', value: { declined: true, reason: 'Prefer not to say' } }],
      submittedAt: new Date().toISOString(),
    });
    const stream = vi.fn();
    const client: ClaudeClient = { send: () => Promise.resolve(''), stream };
    const result = await analyzeAssignment(deps(fs, client), { assignmentId: a.id });
    // There is nothing we are ALLOWED to say back to this sender, so we say nothing and charge nothing.
    expect(result).toMatchObject({ ok: false, reason: 'EMPTY' });
    expect(stream).not.toHaveBeenCalled();
    expect(result.usage).toBeUndefined();
  });

  it('a STANDARD send with every answer skipped reads the REFUSAL, about the questions (08 §34.3)', async () => {
    const fs = memFileSystem();
    const assignmentId = await seedAnswered(fs);
    const r = await getResponse(fs, key, assignmentId);
    await saveResponse(fs, key, {
      ...r!,
      answers: [
        { questionId: 'q1', value: { declined: true, reason: 'Not clear — needs more context' } },
      ],
    });
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
    const result = await analyzeAssignment(deps(fs, client), { assignmentId });
    expect(result.ok).toBe(true);
    const prompt = seen.join('\n');
    expect(prompt).toContain('every question came back unanswered');
    expect(prompt).toContain('You are reading the QUESTIONS, not the person');
    // The Insight this writes is about the QUESTIONNAIRE, so its facts must never ride the
    // partner-shared default an ordinary analysis fact gets (producedFactShare).
    expect(result.insight?.facts.every((f) => f.shareable === false)).toBe(true);
    // EXPLICIT-private, not merely unscoped: `shareable:false` with no `shareableTypes` is exactly the shape
    // the partner-share backfill promotes to ['partner'], and on a Standard send these texts come from the
    // recipient's own words. An explicit [] is preserved by the backfill.
    expect(result.insight?.facts.every((f) => f.shareableTypes?.length === 0)).toBe(true);
    expect(result.insight?.approved).toBe(false);
    expect(result.insight?.provenance.refusalRead).toBe(true);
  });

  it('a refusal read SURVIVES the partner-share backfill — the one thing the empty scope is for (08 §34.3)', async () => {
    // The other tests assert the SHAPE (`shareableTypes: []`). None of them runs the thing that shape exists
    // to defend against, so a later "tidy-up" of `isDefaultPrivate` that also matched an empty array would
    // leave every one of them green while these facts — derived from the recipient's own words — silently
    // became partner-shared on the sender's next Memory read.
    const fs = memFileSystem();
    const assignmentId = await seedAnswered(fs);
    const r = await getResponse(fs, key, assignmentId);
    await saveResponse(fs, key, {
      ...r!,
      answers: [{ questionId: 'q1', value: { declined: true, reason: 'Prefer not to say' } }],
    });
    const result = await analyzeAssignment(deps(fs, fakeClient(ANALYSIS)), { assignmentId });
    expect(result.ok).toBe(true);
    const subject = result.insight!.subjectPersonId;

    await backfillPartnerSharing(fs, key, subject);

    const after = (await listInsightsForPerson(fs, key, subject)).find(
      (i) => i.provenance.refusalRead === true,
    );
    expect(after).toBeDefined();
    expect(after!.facts.length).toBeGreaterThan(0);
    expect(after!.facts.every((f) => f.shareableTypes?.length === 0)).toBe(true);
    expect(after!.facts.every((f) => f.shareable === false)).toBe(true);
  });

  it('a refusal read never overwrites a REAL analysis (08 §34.3)', async () => {
    const fs = memFileSystem();
    const assignmentId = await seedAnswered(fs);
    // A normal analysis first — this is the record with the sender's facts, metrics and approved state.
    const first = await analyzeAssignment(deps(fs, fakeClient(ANALYSIS)), { assignmentId });
    expect(first.ok).toBe(true);

    // The recipient withdraws everything and resubmits empty; auto-analysis re-runs with no user action.
    const r = await getResponse(fs, key, assignmentId);
    await saveResponse(fs, key, {
      ...r!,
      answers: [
        { questionId: 'q1', value: { declined: true, reason: 'Not clear — needs more context' } },
      ],
    });
    // …and it bails BEFORE spending. This runs on `autoAnalyze`, i.e. with no user action, every time the
    // sender re-opens Results — so a guard that sits below the model call bills a read on each visit and
    // throws the answer away. Count the calls: there must be none.
    let calls = 0;
    const counting: ClaudeClient = {
      send: () => {
        calls += 1;
        return Promise.resolve(ANALYSIS);
      },
      stream: (_o, onDelta) => {
        calls += 1;
        onDelta(ANALYSIS);
        return Promise.resolve({
          text: ANALYSIS,
          usage: { inputTokens: 10, outputTokens: 20, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    const second = await analyzeAssignment(deps(fs, counting), { assignmentId });
    expect(second).toMatchObject({ ok: false, reason: 'EMPTY' });
    expect(calls).toBe(0);
    expect(second.usage).toBeUndefined();

    // The earlier insight survives untouched — `saveInsight` replaces a whole record, so reusing its id
    // would have silently destroyed it.
    const all = await listAllInsights(fs, key);
    const kept = all.find((i) => i.provenance.assignmentId === assignmentId);
    expect(kept?.summary).toBe(first.insight?.summary);
    expect(kept?.provenance.refusalRead).toBeUndefined();
  });

  it('gives the analysis real token headroom, not a tight ceiling (08 §3.7)', async () => {
    const fs = memFileSystem();
    const assignmentId = await seedAnswered(fs);
    let captured = 0;
    const client: ClaudeClient = {
      send: () => Promise.resolve(ANALYSIS),
      stream: (options, onDelta) => {
        captured = options.maxTokens;
        onDelta(ANALYSIS);
        return Promise.resolve({
          text: ANALYSIS,
          usage: { inputTokens: 10, outputTokens: 20, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    await analyzeAssignment(deps(fs, client), { assignmentId });
    expect(captured).toBeGreaterThanOrEqual(2000);
  });

  it('a MALFORMED failure carries a CONTENT-FREE diagnostic (keys, length) for self-diagnosis (08 §3.7)', async () => {
    const fs = memFileSystem();
    const assignmentId = await seedAnswered(fs);
    // A complete, closed object — but the model used the WRONG keys (no "summary"), so it can't parse.
    const text = JSON.stringify({ overview: 'A summary in the wrong key.', points: ['a', 'b'] });
    const result = await analyzeAssignment(deps(fs, fakeClient(text)), { assignmentId });
    expect(result).toMatchObject({ ok: false, reason: 'MALFORMED' });
    // The diagnostic reveals the actual shape (the model's top-level KEYS) so a recurring failure is
    // diagnosable — but never the field VALUES (no answer content leaks).
    expect(result.diagnostic).toContain('MALFORMED');
    expect(result.diagnostic).toContain('keys: overview, points');
    expect(result.diagnostic).not.toContain('wrong key');
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

import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { FileSystem } from '../host';
import { listAllInsights, saveInsight } from '../insights';
import { createAssignment, getAssignment, listAssignments } from './assignmentService';
import { getQuestionnaire, saveQuestionnaire } from './questionnaireService';
import { getResponse, saveResponse } from './responseService';
import { deleteSend, hasSends, purgeQuestionnaire } from './deletionService';

const key = generateMasterKey();
const now = '2026-06-11T12:00:00.000Z';

async function seedSubmittedSend(fs: FileSystem, questionnaireId: string): Promise<string> {
  const a = await createAssignment(fs, key, {
    questionnaireId,
    senderPersonId: 'p1',
    recipient: { kind: 'person', personId: 'p2' },
    channel: 'inApp',
    privacy: 'standard',
    senderVisibleToRecipient: true,
  });
  await saveResponse(fs, key, {
    id: `r-${a.id}`,
    schemaVersion: 1,
    assignmentId: a.id,
    answers: [{ questionId: 'q1', value: 'ok' }],
    submittedAt: now,
  });
  await saveInsight(fs, key, {
    id: `i-${a.id}`,
    schemaVersion: 1,
    source: 'questionnaire',
    subjectPersonId: 'p1',
    summary: 'derived',
    facts: [],
    confidence: 'medium',
    categories: [],
    approved: false,
    provenance: { assignmentId: a.id, at: now },
    createdAt: now,
    updatedAt: now,
  });
  return a.id;
}

async function seedQuestionnaire(fs: FileSystem): Promise<string> {
  const q = await saveQuestionnaire(fs, key, {
    title: 'Weekly check-in',
    type: 'role-feedback',
    sensitivity: 'standard',
    questions: [{ id: 'q1', type: 'shortText', prompt: 'How?', required: true }],
  });
  return q.id;
}

describe('saveQuestionnaire — creatorPersonId', () => {
  it('stamps the creator on create and preserves it across edits', async () => {
    const fs = memFileSystem();
    const created = await saveQuestionnaire(
      fs,
      key,
      { title: 'Q', type: 'role-feedback', sensitivity: 'standard', questions: [] },
      'owner-1',
    );
    expect(created.creatorPersonId).toBe('owner-1');
    // An edit by someone else must not steal authorship.
    const edited = await saveQuestionnaire(
      fs,
      key,
      {
        id: created.id,
        title: 'Q2',
        type: 'role-feedback',
        sensitivity: 'standard',
        questions: [],
      },
      'member-9',
    );
    expect(edited.creatorPersonId).toBe('owner-1');
  });

  it('never back-fills a creator onto a legacy (creator-less) def via an edit', async () => {
    const fs = memFileSystem();
    // A legacy def saved with no creator (e.g. created before creatorPersonId existed).
    const legacy = await saveQuestionnaire(fs, key, {
      title: 'Legacy',
      type: 'role-feedback',
      sensitivity: 'standard',
      questions: [],
    });
    expect(legacy.creatorPersonId).toBeUndefined();
    // A member editing it must NOT become its creator (which would let them delete an owner's def).
    const edited = await saveQuestionnaire(
      fs,
      key,
      {
        id: legacy.id,
        title: 'Legacy v2',
        type: 'role-feedback',
        sensitivity: 'standard',
        questions: [],
      },
      'member-9',
    );
    expect(edited.creatorPersonId).toBeUndefined();
  });
});

describe('deletion + purge', () => {
  it('deleteSend removes the send but KEEPS its derived Insight (spec 20 §3.7)', async () => {
    const fs = memFileSystem();
    const qid = await seedQuestionnaire(fs);
    const assignmentId = await seedSubmittedSend(fs, qid);

    await deleteSend(fs, key, assignmentId);
    expect(await getAssignment(fs, key, assignmentId)).toBeNull();
    expect(await getResponse(fs, key, assignmentId)).toBeNull();
    // The Insight persists as the coach's memory — only the send/response artifacts are gone.
    expect((await listAllInsights(fs, key)).length).toBe(1);
    // The definition itself survives a single-send delete.
    expect(await getQuestionnaire(fs, key, qid)).not.toBeNull();
  });

  it('purgeQuestionnaire removes the def + every send, but KEEPS derived Insights (spec 20 §3.7)', async () => {
    const fs = memFileSystem();
    const qid = await seedQuestionnaire(fs);
    const a1 = await seedSubmittedSend(fs, qid);
    const a2 = await seedSubmittedSend(fs, qid);
    // A second, unrelated questionnaire + send must be left untouched.
    const otherQid = await seedQuestionnaire(fs);
    const otherSend = await seedSubmittedSend(fs, otherQid);

    expect(await hasSends(fs, key, qid)).toBe(true);
    await purgeQuestionnaire(fs, key, qid);

    expect(await getQuestionnaire(fs, key, qid)).toBeNull();
    expect(await getAssignment(fs, key, a1)).toBeNull();
    expect(await getAssignment(fs, key, a2)).toBeNull();
    // Only the purged questionnaire's SEND artifacts are gone — the other survives intact.
    expect(await getQuestionnaire(fs, key, otherQid)).not.toBeNull();
    expect(await getAssignment(fs, key, otherSend)).not.toBeNull();
    expect((await listAssignments(fs, key)).map((a) => a.id)).toEqual([otherSend]);
    // ...but every derived Insight PERSISTS (the coach's memory isn't gutted by cleanup, §3.7).
    expect((await listAllInsights(fs, key)).map((i) => i.provenance.assignmentId).sort()).toEqual(
      [a1, a2, otherSend].sort(),
    );
  });

  it('hasSends is false for an unsent questionnaire', async () => {
    const fs = memFileSystem();
    const qid = await seedQuestionnaire(fs);
    expect(await hasSends(fs, key, qid)).toBe(false);
  });
});

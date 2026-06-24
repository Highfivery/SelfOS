import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { Question, QuestionnaireInput, Recipient, ResponseSet } from '../schemas';
import {
  createAssignment,
  deleteAssignment,
  getAssignment,
  getAssignmentSnapshot,
  listAssignments,
  updateAssignmentStatus,
} from './assignmentService';
import {
  deleteQuestionnaire,
  getQuestionnaire,
  listQuestionnaires,
  saveQuestionnaire,
  validateQuestionnaire,
} from './questionnaireService';
import { getResponse, saveResponse } from './responseService';

const key = generateMasterKey();

function question(over: Partial<Question> = {}): Question {
  return { id: 'q1', type: 'shortText', prompt: 'How are you?', required: true, ...over };
}

function input(over: Partial<QuestionnaireInput> = {}): QuestionnaireInput {
  return {
    title: 'Check-in',
    type: 'role-feedback',
    sensitivity: 'standard',
    questions: [question()],
    ...over,
  };
}

const recipient: Recipient = { kind: 'person', personId: 'p2' };
function send(fs: ReturnType<typeof memFileSystem>, questionnaireId: string) {
  return createAssignment(fs, key, {
    questionnaireId,
    senderPersonId: 'p1',
    recipient,
    channel: 'inApp',
    privacy: 'standard',
    senderVisibleToRecipient: true,
  });
}

describe('questionnaireService', () => {
  it('creates and reads a definition', async () => {
    const fs = memFileSystem();
    const created = await saveQuestionnaire(fs, key, input({ title: 'First' }));
    expect(created.version).toBe(1);
    expect((await getQuestionnaire(fs, key, created.id))?.title).toBe('First');
  });

  it('bumps version on edit and preserves createdAt', async () => {
    const fs = memFileSystem();
    const created = await saveQuestionnaire(fs, key, input({ title: 'First' }));
    const edited = await saveQuestionnaire(fs, key, input({ id: created.id, title: 'Edited' }));
    expect(edited.id).toBe(created.id);
    expect(edited.version).toBe(2); // immutable-snapshot version bumps on edit
    expect(edited.createdAt).toBe(created.createdAt);
    expect((await getQuestionnaire(fs, key, created.id))?.version).toBe(2);
  });

  it('lists and deletes definitions', async () => {
    const fs = memFileSystem();
    const a = await saveQuestionnaire(fs, key, input({ title: 'A' }));
    await saveQuestionnaire(fs, key, input({ title: 'B' }));
    expect((await listQuestionnaires(fs, key)).length).toBe(2);
    await deleteQuestionnaire(fs, a.id);
    expect(await getQuestionnaire(fs, key, a.id)).toBeNull();
    expect((await listQuestionnaires(fs, key)).length).toBe(1);
  });

  it('stores definitions encrypted at rest', async () => {
    const fs = memFileSystem();
    const created = await saveQuestionnaire(fs, key, input({ title: 'My secret survey' }));
    const bytes = await fs.read(`questionnaires/defs/${created.id}.enc`);
    const raw = bytes && new TextDecoder().decode(bytes);
    expect(raw).toContain('aes-256-gcm');
    expect(raw).not.toContain('My secret survey');
  });
});

describe('validateQuestionnaire', () => {
  it('passes a valid questionnaire', () => {
    expect(validateQuestionnaire(input())).toEqual([]);
  });

  it('flags an empty questionnaire', () => {
    expect(validateQuestionnaire(input({ questions: [] })).length).toBeGreaterThan(0);
  });

  it('requires options for every choice/ranking/allocation type', () => {
    for (const type of [
      'singleChoice',
      'multiChoice',
      'ranking',
      'thisOrThat',
      'allocation',
    ] as const) {
      expect(validateQuestionnaire(input({ questions: [question({ type })] })).join(' ')).toContain(
        'options',
      );
    }
  });

  it('requires a scale for rating/slider and rows for matrix', () => {
    expect(
      validateQuestionnaire(input({ questions: [question({ type: 'rating' })] })).join(' '),
    ).toContain('scale');
    expect(
      validateQuestionnaire(input({ questions: [question({ type: 'slider' })] })).join(' '),
    ).toContain('scale');
    expect(
      validateQuestionnaire(input({ questions: [question({ type: 'matrix' })] })).join(' '),
    ).toContain('row');
  });

  it('accepts answer types that need no structural fields', () => {
    for (const type of ['shortText', 'longText', 'yesNo', 'date'] as const) {
      expect(validateQuestionnaire(input({ questions: [question({ type })] }))).toEqual([]);
    }
  });

  it('flags a branch to a missing question', () => {
    expect(
      validateQuestionnaire(
        input({
          questions: [
            question({ branch: { whenQuestionId: 'nope', equals: true, action: 'show' } }),
          ],
        }),
      ).join(' '),
    ).toContain('missing question');
  });

  it('flags a branch on a LATER question (a dead-end that can never appear, 38 §3.9)', () => {
    expect(
      validateQuestionnaire(
        input({
          questions: [
            question({ id: 'q1', branch: { whenQuestionId: 'q2', equals: true, action: 'show' } }),
            question({ id: 'q2', type: 'yesNo', branch: undefined }),
          ],
        }),
      ).join(' '),
    ).toContain('later question');
  });

  it('flags a branch that references itself (38 §3.9)', () => {
    expect(
      validateQuestionnaire(
        input({
          questions: [
            question({ id: 'q1', branch: { whenQuestionId: 'q1', equals: true, action: 'show' } }),
          ],
        }),
      ).join(' '),
    ).toContain('itself');
  });

  it('flags a form where EVERY question is conditional (could render empty, 38 §3.9)', () => {
    // Both questions are branched, so nothing is guaranteed to appear — the form could be empty.
    expect(
      validateQuestionnaire(
        input({
          questions: [
            question({ id: 'q1', type: 'yesNo', branch: { whenQuestionId: 'q1', action: 'show' } }),
            question({ id: 'q2', branch: { whenQuestionId: 'q1', equals: true, action: 'show' } }),
          ],
        }),
      ).join(' '),
    ).toContain('always appear');
  });

  it('accepts a valid backward branch (trigger earlier, plus an unconditional question)', () => {
    expect(
      validateQuestionnaire(
        input({
          questions: [
            question({ id: 'q1', type: 'yesNo' }),
            question({ id: 'q2', branch: { whenQuestionId: 'q1', equals: true, action: 'show' } }),
          ],
        }),
      ),
    ).toEqual([]);
  });
});

describe('assignmentService', () => {
  it('snapshots the questionnaire so later edits do not change the sent copy', async () => {
    const fs = memFileSystem();
    const q = await saveQuestionnaire(fs, key, input({ title: 'v1 title' }));
    const assignment = await send(fs, q.id);
    // Edit the definition AFTER sending.
    await saveQuestionnaire(fs, key, input({ id: q.id, title: 'v2 title' }));
    const snapshot = await getAssignmentSnapshot(fs, key, assignment.id);
    expect(snapshot?.title).toBe('v1 title'); // frozen at send
    expect(snapshot?.version).toBe(1);
    expect((await getQuestionnaire(fs, key, q.id))?.version).toBe(2); // the def moved on independently
  });

  it('refuses to send an incomplete questionnaire', async () => {
    const fs = memFileSystem();
    const q = await saveQuestionnaire(
      fs,
      key,
      input({ questions: [question({ type: 'singleChoice' })] }),
    );
    await expect(send(fs, q.id)).rejects.toThrow(/incomplete/);
  });

  it('creates, reads, scoped-lists, transitions status, and deletes', async () => {
    const fs = memFileSystem();
    const q = await saveQuestionnaire(fs, key, input());
    const assignment = await send(fs, q.id);
    expect(assignment.status).toBe('sent');
    expect((await getAssignment(fs, key, assignment.id))?.status).toBe('sent');
    expect((await listAssignments(fs, key)).length).toBe(1);
    expect((await listAssignments(fs, key, { senderPersonId: 'someone-else' })).length).toBe(0);

    const declined = await updateAssignmentStatus(fs, key, assignment.id, 'declined', {
      declineNote: 'not right now',
    });
    expect(declined.status).toBe('declined');
    expect(declined.declineNote).toBe('not right now');

    await deleteAssignment(fs, assignment.id);
    expect(await getAssignment(fs, key, assignment.id)).toBeNull();
    expect(await getAssignmentSnapshot(fs, key, assignment.id)).toBeNull();
  });

  it('skips a stray non-send entry under sends/ (e.g. a synced .DS_Store)', async () => {
    const fs = memFileSystem();
    const q = await saveQuestionnaire(fs, key, input());
    await send(fs, q.id);
    // A cloud provider drops a bare file directly into sends/; listing must skip it (its
    // assignment.enc read returns null), not crash or count it.
    await fs.writeAtomic('questionnaires/sends/.DS_Store', new TextEncoder().encode('junk'));
    expect((await listAssignments(fs, key)).length).toBe(1);
  });
});

describe('responseService', () => {
  it('saves and reads a response (encrypted), chaining re-asks', async () => {
    const fs = memFileSystem();
    const response: ResponseSet = {
      id: 'resp1',
      schemaVersion: 1,
      assignmentId: 'a1',
      reAskOf: 'resp0',
      answers: [{ questionId: 'q1', value: 'doing well' }],
      submittedAt: '2026-06-11T00:00:00.000Z',
    };
    await saveResponse(fs, key, response);

    const read = await getResponse(fs, key, 'a1');
    expect(read?.answers[0]?.value).toBe('doing well');
    expect(read?.reAskOf).toBe('resp0');

    const bytes = await fs.read('questionnaires/sends/a1/response.enc');
    expect(bytes && new TextDecoder().decode(bytes)).not.toContain('doing well'); // encrypted at rest
    expect(await getResponse(fs, key, 'never-answered')).toBeNull();
  });
});

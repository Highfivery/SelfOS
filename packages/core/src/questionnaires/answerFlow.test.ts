import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { FileSystem } from '../host';
import type { Recipient } from '../schemas';
import { createAssignment, getAssignment, listAssignments } from './assignmentService';
import { saveQuestionnaire } from './questionnaireService';
import { getResponse } from './responseService';
import {
  declineAssignment,
  isAnswerable,
  isReopenable,
  openAssignment,
  reopenAssignment,
  saveProgress,
  submitResponse,
} from './answerService';

const key = generateMasterKey();

async function seedSentAssignment(
  fs: FileSystem,
  recipient: Recipient = { kind: 'person', personId: 'p2' },
): Promise<string> {
  const q = await saveQuestionnaire(fs, key, {
    title: 'Weekly check-in',
    type: 'role-feedback',
    sensitivity: 'standard',
    questions: [
      { id: 'q1', type: 'shortText', prompt: 'How are we doing?', required: true },
      { id: 'q2', type: 'yesNo', prompt: 'Feeling heard?', required: false },
    ],
  });
  const a = await createAssignment(fs, key, {
    questionnaireId: q.id,
    senderPersonId: 'p1',
    recipient,
    channel: 'inApp',
    privacy: 'private',
    senderVisibleToRecipient: true,
  });
  return a.id;
}

describe('listAssignments — recipientPersonId filter (the Inbox side)', () => {
  it('returns only assignments addressed to that household person', async () => {
    const fs = memFileSystem();
    const forP2 = await seedSentAssignment(fs, { kind: 'person', personId: 'p2' });
    await seedSentAssignment(fs, { kind: 'person', personId: 'p3' });
    await seedSentAssignment(fs, { kind: 'external', displayName: 'A friend' });

    const inbox = await listAssignments(fs, key, { recipientPersonId: 'p2' });
    expect(inbox.map((a) => a.id)).toEqual([forP2]);
  });
});

describe('answer lifecycle', () => {
  it('opens a sent assignment (idempotent past `opened`)', async () => {
    const fs = memFileSystem();
    const id = await seedSentAssignment(fs);
    expect((await openAssignment(fs, key, id)).status).toBe('opened');
    // saving progress moves it to inProgress; re-opening must not regress it
    await saveProgress(fs, key, { assignmentId: id, answers: [{ questionId: 'q1', value: 'ok' }] });
    expect((await openAssignment(fs, key, id)).status).toBe('inProgress');
  });

  it('saves a resumable draft (no submittedAt) and reuses its id on resume', async () => {
    const fs = memFileSystem();
    const id = await seedSentAssignment(fs);
    const first = await saveProgress(fs, key, {
      assignmentId: id,
      answers: [{ questionId: 'q1', value: 'partial' }],
    });
    expect(first.submittedAt).toBeUndefined();
    expect((await getAssignment(fs, key, id))?.status).toBe('inProgress');

    const resumed = await saveProgress(fs, key, {
      assignmentId: id,
      answers: [{ questionId: 'q1', value: 'more' }],
    });
    expect(resumed.id).toBe(first.id); // same ResponseSet identity across resume
    expect((await getResponse(fs, key, id))?.answers[0]?.value).toBe('more');
  });

  it('submits answers (stamps submittedAt, locks at submitted) reusing a draft id', async () => {
    const fs = memFileSystem();
    const id = await seedSentAssignment(fs);
    const draft = await saveProgress(fs, key, {
      assignmentId: id,
      answers: [{ questionId: 'q1', value: 'draft' }],
    });
    const submitted = await submitResponse(fs, key, {
      assignmentId: id,
      answers: [
        { questionId: 'q1', value: 'final' },
        { questionId: 'q2', value: true },
      ],
    });
    expect(submitted.id).toBe(draft.id);
    expect(submitted.submittedAt).toBeTruthy();
    expect((await getAssignment(fs, key, id))?.status).toBe('submitted');
  });

  it('declines silently or with a short note', async () => {
    const fs = memFileSystem();
    const silent = await seedSentAssignment(fs);
    const declinedSilent = await declineAssignment(fs, key, { assignmentId: silent });
    expect(declinedSilent.status).toBe('declined');
    expect(declinedSilent.declineNote).toBeUndefined();

    const withNote = await seedSentAssignment(fs);
    const declined = await declineAssignment(fs, key, {
      assignmentId: withNote,
      note: '  Not a good time  ',
    });
    expect(declined.status).toBe('declined');
    expect(declined.declineNote).toBe('Not a good time'); // trimmed
  });

  it('submit stamps revision 1; re-open + resubmit bumps it (56)', async () => {
    const fs = memFileSystem();
    const id = await seedSentAssignment(fs);
    const first = await submitResponse(fs, key, {
      assignmentId: id,
      answers: [{ questionId: 'q1', value: 'v1' }],
    });
    expect(first.revision).toBe(1);
    expect(isReopenable('submitted')).toBe(true);

    // Re-open → editable again (inProgress), answers + revision preserved.
    const reopened = await reopenAssignment(fs, key, id);
    expect(reopened.status).toBe('inProgress');
    expect((await getResponse(fs, key, id))?.revision).toBe(1);

    // Editing via a draft carries the revision forward, and the resubmit bumps it.
    await saveProgress(fs, key, { assignmentId: id, answers: [{ questionId: 'q1', value: 'v2' }] });
    expect((await getResponse(fs, key, id))?.revision).toBe(1); // still last-submitted revision while drafting
    const second = await submitResponse(fs, key, {
      assignmentId: id,
      answers: [{ questionId: 'q1', value: 'v2' }],
    });
    expect(second.id).toBe(first.id); // same ResponseSet identity
    expect(second.revision).toBe(2);

    // A third edit → revision 3.
    await reopenAssignment(fs, key, id);
    const third = await submitResponse(fs, key, {
      assignmentId: id,
      answers: [{ questionId: 'q1', value: 'v3' }],
    });
    expect(third.revision).toBe(3);
  });

  it('re-open is idempotent on an editable send and refuses a non-reopenable status (56)', async () => {
    const fs = memFileSystem();
    const id = await seedSentAssignment(fs);
    // A never-submitted (sent) send can't be re-opened — it was never locked.
    expect(isReopenable('sent')).toBe(false);
    await expect(reopenAssignment(fs, key, id)).rejects.toThrow(/no longer be edited/);
    // A declined send stays locked.
    const declinedId = await seedSentAssignment(fs);
    await declineAssignment(fs, key, { assignmentId: declinedId });
    await expect(reopenAssignment(fs, key, declinedId)).rejects.toThrow(/no longer be edited/);
    // Re-opening an already-inProgress send is a no-op.
    await submitResponse(fs, key, {
      assignmentId: id,
      answers: [{ questionId: 'q1', value: 'x' }],
    });
    await reopenAssignment(fs, key, id);
    expect((await reopenAssignment(fs, key, id)).status).toBe('inProgress');
  });

  it('locks the assignment after submit — no further answering or declining', async () => {
    const fs = memFileSystem();
    const id = await seedSentAssignment(fs);
    await submitResponse(fs, key, {
      assignmentId: id,
      answers: [{ questionId: 'q1', value: 'x' }],
    });
    expect(isAnswerable('submitted')).toBe(false);
    await expect(
      saveProgress(fs, key, { assignmentId: id, answers: [{ questionId: 'q1', value: 'y' }] }),
    ).rejects.toThrow(/no longer be answered/);
    await expect(
      submitResponse(fs, key, { assignmentId: id, answers: [{ questionId: 'q1', value: 'y' }] }),
    ).rejects.toThrow(/no longer be answered/);
    await expect(declineAssignment(fs, key, { assignmentId: id })).rejects.toThrow(
      /no longer be answered/,
    );
  });
});

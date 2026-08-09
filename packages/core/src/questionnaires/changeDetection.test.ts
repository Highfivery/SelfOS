import { describe, expect, it } from 'vitest';

import { generateMasterKey } from '../crypto';
import type { FileSystem } from '../host';
import { memFileSystem } from '../host/memFileSystem';
import { upsertPerson } from '../people/peopleService';
import type { Question } from '../schemas';

import { openAssignment, submitResponse } from './answerService';
import { createAssignment } from './assignmentService';
import {
  BAILED_STALE_DAYS,
  detectRecipientBailed,
  detectRecipientNumericShifts,
} from './changeDetection';
import { gatherRecipientFeedbackGuidance } from './recipientHistory';
import { readProfile } from './personalizationProfile';
import { saveQuestionnaire } from './questionnaireService';

const key = generateMasterKey();

/** Send a one-rating-question questionnaire to `recipientId` and submit `value`. Same question id `r1` across
 *  calls, so the detector aligns them as a re-ask. */
async function askAndAnswer(
  fs: FileSystem,
  recipientId: string,
  question: Question,
  value: number,
): Promise<void> {
  const q = await saveQuestionnaire(fs, key, {
    title: 'Rating',
    type: 'general',
    sensitivity: 'standard',
    questions: [question],
  });
  const a = await createAssignment(fs, key, {
    questionnaireId: q.id,
    senderPersonId: 'author',
    recipient: { kind: 'person', personId: recipientId },
    channel: 'inApp',
    privacy: 'private',
    senderVisibleToRecipient: true,
  });
  await submitResponse(fs, key, { assignmentId: a.id, answers: [{ questionId: 'r1', value }] });
}

const rating: Question = {
  id: 'r1',
  type: 'rating',
  prompt: 'How satisfied are you with your career?',
  required: false,
  scale: { min: 1, max: 5 },
};

describe('detectRecipientNumericShifts', () => {
  it('detects a meaningful rating shift across a re-ask', async () => {
    const fs = memFileSystem();
    await upsertPerson(fs, key, { id: 'p2', displayName: 'Pat', isSubject: true, tags: [] });
    await askAndAnswer(fs, 'p2', rating, 2);
    await askAndAnswer(fs, 'p2', rating, 5);
    const shifts = await detectRecipientNumericShifts(fs, key, 'p2');
    expect(shifts).toHaveLength(1);
    expect(shifts[0]).toMatchObject({ questionId: 'r1', from: '2/5', to: '5/5' });
  });

  it('ignores a sub-threshold wobble (< a quarter of the scale)', async () => {
    const fs = memFileSystem();
    await upsertPerson(fs, key, { id: 'p3', displayName: 'Sam', isSubject: true, tags: [] });
    const slider: Question = {
      id: 'r1',
      type: 'slider',
      prompt: 'Mood',
      required: false,
      scale: { min: 0, max: 100 },
    };
    await askAndAnswer(fs, 'p3', slider, 40);
    await askAndAnswer(fs, 'p3', slider, 50); // Δ10 < 25 (a quarter of 100) → ignored
    expect(await detectRecipientNumericShifts(fs, key, 'p3')).toHaveLength(0);
  });

  it('detects a large slider shift', async () => {
    const fs = memFileSystem();
    await upsertPerson(fs, key, { id: 'p4', displayName: 'Lee', isSubject: true, tags: [] });
    const slider: Question = {
      id: 'r1',
      type: 'slider',
      prompt: 'Stress level',
      required: false,
      scale: { min: 0, max: 100 },
    };
    await askAndAnswer(fs, 'p4', slider, 20);
    await askAndAnswer(fs, 'p4', slider, 80);
    expect(await detectRecipientNumericShifts(fs, key, 'p4')).toMatchObject([
      { from: '20/100', to: '80/100' },
    ]);
  });

  it('returns nothing for a single answer (no re-ask)', async () => {
    const fs = memFileSystem();
    await upsertPerson(fs, key, { id: 'p5', displayName: 'Ari', isSubject: true, tags: [] });
    await askAndAnswer(fs, 'p5', rating, 3);
    expect(await detectRecipientNumericShifts(fs, key, 'p5')).toEqual([]);
  });
});

describe('capture records a change and it reaches generation guidance', () => {
  it('logs the shift on submit and surfaces a "what changed?" hint', async () => {
    const fs = memFileSystem();
    await upsertPerson(fs, key, { id: 'p9', displayName: 'Bo', isSubject: true, tags: [] });
    await askAndAnswer(fs, 'p9', rating, 2);
    await askAndAnswer(fs, 'p9', rating, 5); // the second submit's capture detects + logs the shift

    const profile = await readProfile(fs, key, 'p9');
    expect(profile.changes).toHaveLength(1);
    expect(profile.changes[0]).toMatchObject({
      kind: 'numeric-shift',
      metricKey: 'r1',
      label: 'How satisfied are you with your career?',
      from: '2/5',
      to: '5/5',
      explored: false,
    });

    const guidance = await gatherRecipientFeedbackGuidance(fs, key, 'p9');
    expect(guidance).toContain('RECENTLY CHANGED');
    expect(guidance).toContain('How satisfied are you with your career?');
    expect(guidance).toContain('2/5 → 5/5');
  });
});

describe('detectRecipientBailed (spec 69 §5.2 — abandonment)', () => {
  async function ask(fs: FileSystem, recipientId: string): Promise<string> {
    const q = await saveQuestionnaire(fs, key, {
      title: 'A long one',
      type: 'general',
      sensitivity: 'standard',
      questions: [{ id: 'q1', type: 'shortText', prompt: 'Tell me everything?', required: false }],
    });
    const a = await createAssignment(fs, key, {
      questionnaireId: q.id,
      senderPersonId: 'author',
      recipient: { kind: 'person', personId: recipientId },
      channel: 'inApp',
      privacy: 'private',
      senderVisibleToRecipient: true,
    });
    return a.id;
  }

  it('flags an opened-but-unsubmitted check-in only once it has gone stale', async () => {
    const fs = memFileSystem();
    await upsertPerson(fs, key, { id: 'p1', displayName: 'Pat', isSubject: true, tags: [] });
    const id = await ask(fs, 'p1');
    await openAssignment(fs, key, id); // status → 'opened', updatedAt ≈ now

    // Right after opening → not abandoned yet.
    const soon = new Date(Date.now() + 60 * 1000);
    expect(await detectRecipientBailed(fs, key, 'p1', soon)).toEqual([]);

    // Eight days later, still unsubmitted → bailed.
    const later = new Date(Date.now() + (BAILED_STALE_DAYS + 1) * 24 * 60 * 60 * 1000);
    const bailed = await detectRecipientBailed(fs, key, 'p1', later);
    expect(bailed).toHaveLength(1);
    expect(bailed[0]?.title).toBe('A long one');
  });

  it('does NOT flag a submitted check-in as bailed', async () => {
    const fs = memFileSystem();
    await upsertPerson(fs, key, { id: 'p2', displayName: 'Sam', isSubject: true, tags: [] });
    const id = await ask(fs, 'p2');
    await openAssignment(fs, key, id);
    await submitResponse(fs, key, {
      assignmentId: id,
      answers: [{ questionId: 'q1', value: 'done' }],
    });
    const later = new Date(Date.now() + (BAILED_STALE_DAYS + 1) * 24 * 60 * 60 * 1000);
    expect(await detectRecipientBailed(fs, key, 'p2', later)).toEqual([]);
  });
});

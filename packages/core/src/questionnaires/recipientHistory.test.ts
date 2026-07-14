import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import { upsertPerson } from '../people/peopleService';
import { saveInsight } from '../insights';
import { saveQuestionnaire } from './questionnaireService';
import { createAssignment } from './assignmentService';
import { saveResponse } from './responseService';
import { gatherRecipientHistory, gatherRecipientPriorAnswers } from './recipientHistory';

const key = generateMasterKey();
const now = '2026-06-15T12:00:00.000Z';

describe('gatherRecipientHistory (08 §17.4)', () => {
  it('assembles the recipient’s profile, insights, and already-asked question prompts', async () => {
    const fs = memFileSystem();
    const mara = await upsertPerson(fs, key, {
      displayName: 'Mara',
      isSubject: true,
      tags: [],
      occupation: 'Nurse',
      goals: 'Run a half-marathon',
    });
    // An Insight (the distilled layer fed by intake/sessions/dreams/questionnaires).
    await saveInsight(fs, key, {
      id: 'i1',
      schemaVersion: 1,
      source: 'session',
      subjectPersonId: mara.id,
      summary: 'Feeling stretched at work lately.',
      facts: [{ id: 'f1', text: 'Wants more rest on weekends', shareable: true }],
      confidence: 'high',
      categories: [],
      approved: true,
      provenance: { at: now },
      createdAt: now,
      updatedAt: now,
    });
    // A prior questionnaire ALREADY sent to Mara — its prompt must be surfaced as "already asked".
    const def = await saveQuestionnaire(fs, key, {
      title: 'Last week',
      type: 'role-feedback',
      sensitivity: 'standard',
      recipient: { kind: 'person', personId: mara.id },
      questions: [
        { id: 'q1', type: 'shortText', prompt: 'How was your week at work?', required: true },
      ],
    });
    await createAssignment(fs, key, {
      questionnaireId: def.id,
      senderPersonId: 'owner',
      recipient: { kind: 'person', personId: mara.id },
      channel: 'inApp',
      privacy: 'private',
      senderVisibleToRecipient: true,
    });

    const history = await gatherRecipientHistory(fs, key, mara.id);
    expect(history).toMatch(/Nurse/); // profile
    expect(history).toMatch(/Run a half-marathon/); // profile goal
    expect(history).toMatch(/stretched at work/i); // insight summary
    expect(history).toMatch(/more rest on weekends/i); // insight fact
    expect(history).toMatch(/How was your week at work\?/); // already-asked prompt
    expect(history).toMatch(/do NOT repeat these/i); // the heading framing
  });

  it('returns an empty digest for a person with no history', async () => {
    const fs = memFileSystem();
    const p = await upsertPerson(fs, key, { displayName: 'New', isSubject: true, tags: [] });
    expect(await gatherRecipientHistory(fs, key, p.id)).toBe('');
  });
});

describe('gatherRecipientPriorAnswers (08 §24.3-A1)', () => {
  it('formats the recipient’s ACTUAL answers to prior questionnaires (Q → A), not just the prompts', async () => {
    const fs = memFileSystem();
    const mara = await upsertPerson(fs, key, { displayName: 'Mara', isSubject: true, tags: [] });
    const def = await saveQuestionnaire(fs, key, {
      title: 'Last week',
      type: 'general',
      sensitivity: 'standard',
      recipient: { kind: 'person', personId: mara.id },
      questions: [
        { id: 'q1', type: 'shortText', prompt: 'What lifted you up this week?', required: true },
      ],
    });
    const assignment = await createAssignment(fs, key, {
      questionnaireId: def.id,
      senderPersonId: 'owner',
      recipient: { kind: 'person', personId: mara.id },
      channel: 'inApp',
      privacy: 'private',
      senderVisibleToRecipient: true,
    });
    await saveResponse(fs, key, {
      id: 'r1',
      schemaVersion: 1,
      assignmentId: assignment.id,
      answers: [{ questionId: 'q1', value: 'A quiet morning hike with my dog.' }],
      submittedAt: now,
    });

    const answers = await gatherRecipientPriorAnswers(fs, key, mara.id);
    expect(answers).toMatch(/Q: What lifted you up this week\?/);
    expect(answers).toMatch(/A: A quiet morning hike with my dog\./);
  });

  it('is empty when the recipient has been sent nothing / answered nothing', async () => {
    const fs = memFileSystem();
    const p = await upsertPerson(fs, key, { displayName: 'New', isSubject: true, tags: [] });
    expect(await gatherRecipientPriorAnswers(fs, key, p.id)).toBe('');
  });
});

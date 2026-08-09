import { describe, expect, it } from 'vitest';

import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import { createAssignment } from '../questionnaires/assignmentService';
import { saveQuestionnaire } from '../questionnaires/questionnaireService';

import { autoCheckinSentActivity } from './sentActivity';

const key = generateMasterKey();
const OWNER = 'owner-1';

async function autoSend(
  fs: ReturnType<typeof memFileSystem>,
  recipientPersonId: string,
  generatedAt: string,
): Promise<void> {
  const q = await saveQuestionnaire(fs, key, {
    title: 'Auto check-in',
    type: 'general',
    sensitivity: 'standard',
    autoCheckin: { targetId: 't1', intent: 'explore', rationale: 'new ground', generatedAt },
    questions: [{ id: 'q1', type: 'shortText', prompt: 'How are you?', required: false }],
  });
  await createAssignment(fs, key, {
    questionnaireId: q.id,
    senderPersonId: OWNER,
    recipient: { kind: 'person', personId: recipientPersonId },
    channel: 'inApp',
    privacy: 'private',
    senderVisibleToRecipient: true,
  });
}

async function manualSend(
  fs: ReturnType<typeof memFileSystem>,
  recipientPersonId: string,
): Promise<void> {
  const q = await saveQuestionnaire(fs, key, {
    title: 'A hand-authored one',
    type: 'general',
    sensitivity: 'standard',
    questions: [{ id: 'q1', type: 'shortText', prompt: 'Q?', required: false }],
  });
  await createAssignment(fs, key, {
    questionnaireId: q.id,
    senderPersonId: OWNER,
    recipient: { kind: 'person', personId: recipientPersonId },
    channel: 'inApp',
    privacy: 'private',
    senderVisibleToRecipient: true,
  });
}

describe('autoCheckinSentActivity (spec 69 §13 — the per-stream compact read)', () => {
  it('counts the owner’s OWN auto-checkin sends per other-person, with the latest date', async () => {
    const fs = memFileSystem();
    await autoSend(fs, 'partner', '2026-08-01T00:00:00.000Z');
    await autoSend(fs, 'partner', '2026-08-05T00:00:00.000Z');
    await autoSend(fs, 'friend', '2026-08-03T00:00:00.000Z');

    const activity = await autoCheckinSentActivity(fs, key, OWNER);
    expect(activity['partner']?.sentCount).toBe(2);
    // Latest is the most recent createdAt (the assignments are stamped at creation, near "now").
    expect(activity['partner']?.latestAt).not.toBeNull();
    expect(activity['friend']?.sentCount).toBe(1);
  });

  it('excludes self-sends and manual (non-auto) sends — own-scoped to auto-checkin streams', async () => {
    const fs = memFileSystem();
    await autoSend(fs, OWNER, '2026-08-01T00:00:00.000Z'); // a self stream — excluded
    await manualSend(fs, 'friend'); // a hand-authored send — not an auto-checkin
    await autoSend(fs, 'friend', '2026-08-02T00:00:00.000Z');

    const activity = await autoCheckinSentActivity(fs, key, OWNER);
    expect(activity[OWNER]).toBeUndefined(); // no self stream
    expect(activity['friend']?.sentCount).toBe(1); // only the auto send, not the manual one
  });

  it('returns nothing for an owner who has sent no auto check-ins', async () => {
    const fs = memFileSystem();
    expect(await autoCheckinSentActivity(fs, key, OWNER)).toEqual({});
  });
});

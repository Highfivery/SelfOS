import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { Insight } from '../schemas';
import { aboutFromRecipient, resolveInsightAbout, resolveInsightSource } from './aboutResolver';
import { createAssignment } from './assignmentService';
import { writeCompatibilityMember } from './compatibilityService';
import { getQuestionnaire, saveQuestionnaire } from './questionnaireService';

const key = generateMasterKey();
const at = '2026-07-08T12:00:00.000Z';

function insight(partial: Partial<Insight> & { provenance: Insight['provenance'] }): Insight {
  return {
    id: 'i1',
    schemaVersion: 1,
    source: 'questionnaire',
    subjectPersonId: 'p1',
    summary: 's',
    facts: [],
    confidence: 'medium',
    categories: [],
    approved: true,
    createdAt: at,
    updatedAt: at,
    ...partial,
  };
}

describe('aboutFromRecipient', () => {
  it('returns null for a self-recipient (a self check-in)', () => {
    expect(aboutFromRecipient({ kind: 'person', personId: 'p1' }, 'p1')).toBeNull();
  });

  it('returns the household recipient id when it is not the subject', () => {
    expect(aboutFromRecipient({ kind: 'person', personId: 'p2' }, 'p1')).toEqual({
      aboutPersonId: 'p2',
    });
  });

  it('names an external recipient (displayName → email → phone → fallback)', () => {
    expect(aboutFromRecipient({ kind: 'external', displayName: 'Sam' }, 'p1')).toEqual({
      aboutName: 'Sam',
    });
    expect(aboutFromRecipient({ kind: 'external', email: 'sam@x.dev' }, 'p1')).toEqual({
      aboutName: 'sam@x.dev',
    });
    expect(aboutFromRecipient({ kind: 'external' }, 'p1')).toEqual({ aboutName: 'a recipient' });
  });
});

describe('resolveInsightAbout', () => {
  it('returns null for a non-questionnaire insight', async () => {
    const fs = memFileSystem();
    const about = await resolveInsightAbout(
      fs,
      key,
      insight({ source: 'session', provenance: { conversationId: 'c1', at } }),
    );
    expect(about).toBeNull();
  });

  it('prefers a stamped provenance over any lookup', async () => {
    const fs = memFileSystem();
    const about = await resolveInsightAbout(
      fs,
      key,
      insight({ provenance: { assignmentId: 'gone', aboutPersonId: 'p2', at } }),
    );
    expect(about).toEqual({ aboutPersonId: 'p2' });
  });

  it('resolves a pre-#129 insight read-time from its assignment', async () => {
    const fs = memFileSystem();
    const q = await saveQuestionnaire(fs, key, {
      title: 'Check-in',
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
    const about = await resolveInsightAbout(
      fs,
      key,
      insight({ provenance: { assignmentId: a.id, at } }), // no about* stamped (legacy)
    );
    expect(about).toEqual({ aboutPersonId: 'p2' });
  });

  it('returns null when the originating send was deleted and nothing was stamped', async () => {
    const fs = memFileSystem();
    const about = await resolveInsightAbout(
      fs,
      key,
      insight({ provenance: { assignmentId: 'deleted', at } }),
    );
    expect(about).toBeNull();
  });

  it('resolves the OTHER participant of a compatibility group', async () => {
    const fs = memFileSystem();
    const saved = await saveQuestionnaire(fs, key, {
      title: 'Compat',
      type: 'role-feedback',
      sensitivity: 'standard',
      compatibility: { enabled: true, visibility: 'sharedReport' },
      questions: [{ id: 'q1', type: 'yesNo', prompt: 'Aligned?', required: true }],
    });
    const canonical = await getQuestionnaire(fs, key, saved.id);
    if (!canonical) throw new Error('missing questionnaire');
    // Two paired sends in one group: p1 (the subject) answers one, p2 the other.
    for (const participant of ['p1', 'p2']) {
      await writeCompatibilityMember(fs, key, {
        canonical,
        senderPersonId: 'p1',
        participantPersonId: participant,
        questions: canonical.questions,
        visibility: 'sharedReport',
        compatibilityGroupId: 'g1',
      });
    }
    const about = await resolveInsightAbout(
      fs,
      key,
      insight({ provenance: { compatibilityGroupId: 'g1', at } }),
    );
    expect(about).toEqual({ aboutPersonId: 'p2' });
  });
});

describe('resolveInsightSource', () => {
  it('returns null for a non-questionnaire insight', async () => {
    const fs = memFileSystem();
    expect(
      await resolveInsightSource(
        fs,
        key,
        insight({ source: 'session', provenance: { conversationId: 'c1', at } }),
      ),
    ).toBeNull();
  });

  it('returns null when there is no originating assignment (e.g. a compatibility insight)', async () => {
    const fs = memFileSystem();
    expect(
      await resolveInsightSource(
        fs,
        key,
        insight({ provenance: { compatibilityGroupId: 'g1', at } }),
      ),
    ).toBeNull();
  });

  it('resolves the source questionnaire title + live id from the assignment', async () => {
    const fs = memFileSystem();
    const q = await saveQuestionnaire(fs, key, {
      title: 'Intimacy check-in',
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
      await resolveInsightSource(fs, key, insight({ provenance: { assignmentId: a.id, at } })),
    ).toEqual({ sourceTitle: 'Intimacy check-in', sourceQuestionnaireId: q.id });
  });

  it('returns null when the originating send was deleted', async () => {
    const fs = memFileSystem();
    expect(
      await resolveInsightSource(fs, key, insight({ provenance: { assignmentId: 'gone', at } })),
    ).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import type { ClaudeClient, ClaudeStreamResult } from '../host';
import { memFileSystem } from '../host/memFileSystem';
import type { AiDeps } from '../questionnaires/aiCall';
import { upsertPerson } from '../people/peopleService';
import { upsertRelationship } from '../people/relationshipService';
import { acknowledgeAdult } from '../conversations/guidanceService';
import { setYnmOptIn } from '../together/ynmService';
import { saveQuestionnaire } from '../questionnaires/questionnaireService';
import { createAssignment, getAssignment } from '../questionnaires/assignmentService';
import { isAnswerable } from '../questionnaires/answerService';
import { writeEncryptedJson } from '../vault';
import type { EmailResponse, SentSuggestion } from '../schemas';
import { recordSentSuggestion } from './emailSuggestionService';
import { computeMutualGreenLights, applyEmailCheckinAnswers } from './emailResponseEffects';

/** Establish live intimacy consent between two partners (partner edge + both 18+ acks + both YNM opt-ins). */
async function consentBetween(fs: ReturnType<typeof memFileSystem>, aId: string, bId: string) {
  await upsertRelationship(fs, key, { fromPersonId: aId, toPersonId: bId, type: 'partner' });
  await acknowledgeAdult(fs, key, aId);
  await acknowledgeAdult(fs, key, bId);
  await setYnmOptIn(fs, key, aId, bId, true, now);
  await setYnmOptIn(fs, key, bId, aId, true, now);
}

const key = generateMasterKey();
const now = new Date('2026-09-01T12:00:00.000Z');

function analysisClient(): ClaudeClient {
  const result: ClaudeStreamResult = {
    text: '{"summary":"A brief reflection.","facts":[],"confidence":"low","categories":["Other"]}',
    usage: { inputTokens: 50, outputTokens: 40, cacheWriteTokens: 0, cacheReadTokens: 0 },
    stopReason: 'end_turn',
  };
  return { send: () => Promise.resolve(''), stream: () => Promise.resolve(result) };
}

async function seedSuggestion(
  fs: ReturnType<typeof memFileSystem>,
  personId: string,
  s: SentSuggestion,
) {
  await recordSentSuggestion(fs, key, personId, s);
}
async function seedResponse(
  fs: ReturnType<typeof memFileSystem>,
  personId: string,
  r: EmailResponse,
) {
  await writeEncryptedJson(fs, `people/${personId}/email/responses/${r.id}.enc`, r, key);
}

const suggBase = {
  schemaVersion: 1 as const,
  family: 'ai-suggestion-intimacy' as const,
  suggestionType: 'intimacy' as const,
  text: 'a shared idea',
  sharedSuggestionKey: 'sk-1',
  tokens: [],
  sentAt: '2026-08-25T00:00:00.000Z',
};
const respBase = {
  schemaVersion: 1 as const,
  family: 'ai-suggestion-intimacy' as const,
  kind: 'intimacy-reaction' as const,
  answer: 'im-game',
  sensitivity: 'intimacy' as const,
  source: 'relay-tap' as const,
  edited: false,
  respondedAt: '2026-08-26T00:00:00.000Z',
};

describe('computeMutualGreenLights (67 §3.6)', () => {
  it('surfaces a shared suggestion BOTH partners tapped im-game on (with live consent), and not a one-sided one', async () => {
    const fs = memFileSystem();
    const a = await upsertPerson(fs, key, { displayName: 'Ada', isSubject: true, tags: [] });
    const b = await upsertPerson(fs, key, { displayName: 'Bea', isSubject: true, tags: [] });
    await consentBetween(fs, a.id, b.id);
    // A's copy + A's im-game.
    await seedSuggestion(fs, a.id, { ...suggBase, id: 'sa', partnerPersonId: b.id });
    await seedResponse(fs, a.id, { ...respBase, id: 'ra', suggestionId: 'sa' });
    // B's copy of the SAME shared key + B's im-game.
    await seedSuggestion(fs, b.id, { ...suggBase, id: 'sb', partnerPersonId: a.id });
    await seedResponse(fs, b.id, { ...respBase, id: 'rb', suggestionId: 'sb' });

    const greens = await computeMutualGreenLights(fs, key, a.id);
    expect(greens).toHaveLength(1);
    expect(greens[0]).toMatchObject({
      partnerId: b.id,
      partnerName: 'Bea',
      sharedSuggestionKey: 'sk-1',
    });

    // Revoking B's YNM opt-in immediately clears the green light (the live-recheck posture).
    await setYnmOptIn(fs, key, b.id, a.id, false, now);
    expect(await computeMutualGreenLights(fs, key, a.id)).toHaveLength(0);
  });

  it('does not surface a one-sided green light (only one partner tapped im-game)', async () => {
    const fs = memFileSystem();
    const a = await upsertPerson(fs, key, { displayName: 'Ada', isSubject: true, tags: [] });
    const b = await upsertPerson(fs, key, { displayName: 'Bea', isSubject: true, tags: [] });
    await consentBetween(fs, a.id, b.id);
    await seedSuggestion(fs, a.id, { ...suggBase, id: 'sa', partnerPersonId: b.id });
    await seedResponse(fs, a.id, { ...respBase, id: 'ra', suggestionId: 'sa' });
    await seedSuggestion(fs, b.id, { ...suggBase, id: 'sb', partnerPersonId: a.id }); // B never tapped
    expect(await computeMutualGreenLights(fs, key, a.id)).toHaveLength(0);
  });
});

describe('applyEmailCheckinAnswers (67 §3.5)', () => {
  it('submits + analyzes a drained embedded check-in answer, then is idempotent', async () => {
    const fs = memFileSystem();
    const me = await upsertPerson(fs, key, { displayName: 'Me', isSubject: true, tags: [] });
    const questionId = 'q1';
    const questionnaire = await saveQuestionnaire(
      fs,
      key,
      {
        title: 'A check-in',
        type: 'general',
        sensitivity: 'standard',
        recipient: { kind: 'person', personId: me.id },
        questions: [
          {
            id: questionId,
            type: 'singleChoice',
            prompt: 'How was rest?',
            required: false,
            options: ['Yes', 'No'],
          },
        ],
      },
      me.id,
    );
    const assignment = await createAssignment(fs, key, {
      questionnaireId: questionnaire.id,
      senderPersonId: me.id,
      recipient: { kind: 'person', personId: me.id },
      channel: 'inApp',
      privacy: 'standard',
      senderVisibleToRecipient: true,
    });
    await seedResponse(fs, me.id, {
      schemaVersion: 1,
      id: 'rc',
      family: 'ai-suggestion',
      kind: 'checkin-answer',
      answer: 'Yes',
      questionId,
      assignmentId: assignment.id,
      sensitivity: 'standard',
      source: 'relay-tap',
      edited: false,
      respondedAt: '2026-08-30T00:00:00.000Z',
    });

    const deps: AiDeps = {
      fs,
      key,
      client: analysisClient(),
      apiKey: 'sk',
      model: 'claude-sonnet-4-6',
      personId: me.id,
      now,
    };
    const applied = await applyEmailCheckinAnswers(deps, me.id);
    expect(applied).toBe(1);
    const after = await getAssignment(fs, key, assignment.id);
    expect(after && isAnswerable(after.status)).toBe(false); // recorded → no longer answerable

    // Idempotent: a second run does nothing.
    expect(await applyEmailCheckinAnswers(deps, me.id)).toBe(0);
  });
});

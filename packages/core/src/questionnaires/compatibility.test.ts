import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { ClaudeClient, FileSystem } from '../host';
import { listAllInsights } from '../insights';
import type { Question } from '../schemas';
import { generateAlignment, getAlignmentReport, purgeCompatibilityGroup } from './alignmentService';
import { getAssignment, getAssignmentSnapshot, listAssignments } from './assignmentService';
import { createCompatibilitySend } from './compatibilityService';
import { deleteSend } from './deletionService';
import { compatibilityDisclosure } from './disclosure';
import { generateVariant, type AiDeps } from './generationService';
import { saveQuestionnaire } from './questionnaireService';
import { saveResponse } from './responseService';

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
  return { fs, key, client, apiKey: 'sk-x', model: 'claude-sonnet-4-6', personId: 'sender', now };
}

const canonicalQuestions: Question[] = [
  {
    id: 'c1',
    type: 'rating',
    prompt: 'How connected do you feel?',
    required: true,
    scale: { min: 1, max: 5 },
  },
  { id: 'c2', type: 'yesNo', prompt: 'Do you want more time together?', required: true },
];

/** A compatibility questionnaire definition, ready to send. */
async function seedCompatQuestionnaire(
  fs: FileSystem,
  visibility: 'sharedReport' | 'senderSeesAll' | 'eachSeesOwn' = 'sharedReport',
): Promise<string> {
  const q = await saveQuestionnaire(fs, key, {
    title: 'Compatibility check',
    type: 'role-feedback',
    sensitivity: 'standard',
    questions: canonicalQuestions.map((c) => ({ ...c, canonicalId: c.id })),
    compatibility: { enabled: true, visibility },
  });
  return q.id;
}

/** Send to two people, then submit both their responses (each answers their variant). */
async function seedAnsweredGroup(
  fs: FileSystem,
  visibility: 'sharedReport' | 'senderSeesAll' | 'eachSeesOwn' = 'sharedReport',
): Promise<{ groupId: string; aId: string; bId: string }> {
  const questionnaireId = await seedCompatQuestionnaire(fs, visibility);
  const variant = (label: string): Question[] =>
    canonicalQuestions.map((c) => ({ ...c, canonicalId: c.id, prompt: `${label}: ${c.prompt}` }));
  const groupId = await createCompatibilitySend(fs, key, {
    questionnaireId,
    senderPersonId: 'sender',
    visibility,
    recipients: [
      { personId: 'alex', questions: variant('Alex') },
      { personId: 'bri', questions: variant('Bri') },
    ],
  });
  const members = (await listAssignments(fs, key)).filter(
    (a) => a.compatibilityGroupId === groupId,
  );
  const [a, b] = members;
  if (!a || !b) throw new Error('expected two members');
  await saveResponse(fs, key, {
    id: 'ra',
    schemaVersion: 1,
    assignmentId: a.id,
    answers: [
      { questionId: 'c1', value: 4 },
      { questionId: 'c2', value: true },
    ],
    submittedAt: now.toISOString(),
  });
  await saveResponse(fs, key, {
    id: 'rb',
    schemaVersion: 1,
    assignmentId: b.id,
    answers: [
      { questionId: 'c1', value: 3 },
      { questionId: 'c2', value: false },
    ],
    submittedAt: now.toISOString(),
  });
  return { groupId, aId: a.id, bId: b.id };
}

describe('generateVariant', () => {
  it('personalizes prompts while preserving type + count + canonicalId', async () => {
    const fs = memFileSystem();
    const text = JSON.stringify(['For Alex: rate connection', 'For Alex: want more time?']);
    const result = await generateVariant(deps(fs, fakeClient(text)), {
      forName: 'Alex',
      questions: canonicalQuestions,
      targetContext: {
        authorPersonId: 'sender',
        includeAuthor: false,
        targetPersonId: 'alex',
        includeTarget: true,
        includeRelationship: true,
      },
    });
    expect(result.ok).toBe(true);
    expect(result.questions).toHaveLength(2);
    expect(result.questions?.[0]?.prompt).toBe('For Alex: rate connection');
    expect(result.questions?.[0]?.type).toBe('rating'); // structure preserved
    expect(result.questions?.[0]?.canonicalId).toBe('c1'); // alignment key set
    expect(result.questions?.[1]?.canonicalId).toBe('c2');
  });

  it('REFUSES when the model returns the wrong number of prompts', async () => {
    const fs = memFileSystem();
    const result = await generateVariant(deps(fs, fakeClient(JSON.stringify(['only one']))), {
      forName: 'Alex',
      questions: canonicalQuestions,
      targetContext: {
        authorPersonId: 'sender',
        includeAuthor: false,
        targetPersonId: 'alex',
        includeTarget: true,
        includeRelationship: true,
      },
    });
    expect(result).toMatchObject({ ok: false, reason: 'REFUSED' });
  });
});

describe('createCompatibilitySend', () => {
  it('creates two paired, Private assignments with their own variant snapshots', async () => {
    const fs = memFileSystem();
    const questionnaireId = await seedCompatQuestionnaire(fs);
    const groupId = await createCompatibilitySend(fs, key, {
      questionnaireId,
      senderPersonId: 'sender',
      visibility: 'sharedReport',
      recipients: [
        {
          personId: 'alex',
          questions: canonicalQuestions.map((c) => ({
            ...c,
            canonicalId: c.id,
            prompt: `Alex: ${c.prompt}`,
          })),
        },
        {
          personId: 'bri',
          questions: canonicalQuestions.map((c) => ({
            ...c,
            canonicalId: c.id,
            prompt: `Bri: ${c.prompt}`,
          })),
        },
      ],
    });
    const members = (await listAssignments(fs, key)).filter(
      (a) => a.compatibilityGroupId === groupId,
    );
    expect(members).toHaveLength(2);
    expect(members.every((a) => a.privacy === 'private')).toBe(true); // never inline-visible to sender
    expect(
      members.map((a) => (a.recipient.kind === 'person' ? a.recipient.personId : '')).sort(),
    ).toEqual(['alex', 'bri']);
    // Each member carries its OWN personalized snapshot.
    const first = members[0];
    if (!first) throw new Error('expected a member');
    const snap = await getAssignmentSnapshot(fs, key, first.id);
    expect(snap?.questions[0]?.prompt).toMatch(/^(Alex|Bri): /);
  });
});

describe('generateAlignment', () => {
  const ALIGNMENT = JSON.stringify({
    summary: 'Mostly aligned, with a difference on time together.',
    items: [
      { canonicalId: 'c1', agreement: 'aligned', note: 'Both feel fairly connected.' },
      {
        canonicalId: 'c2',
        agreement: 'divergent',
        note: 'One wants more time; the other does not.',
      },
    ],
    crisisFlag: false,
    facts: [{ text: 'They differ on desired time together.', shareable: true }],
  });

  it('aligns two submitted responses into a report + a draft Insight for the sender', async () => {
    const fs = memFileSystem();
    const { groupId } = await seedAnsweredGroup(fs);
    const result = await generateAlignment(deps(fs, fakeClient(ALIGNMENT)), {
      compatibilityGroupId: groupId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.report.items.map((i) => i.canonicalId)).toEqual(['c1', 'c2']);
    expect(result.report.items[1]?.agreement).toBe('divergent');
    expect(result.usage.type).toBe('questionnaire.analyze');

    // The report is cached, and an UNapproved Insight (subject = the sender) was drafted from it.
    expect((await getAlignmentReport(fs, key, groupId))?.summary).toContain('Mostly aligned');
    const insights = await listAllInsights(fs, key);
    const drafted = insights.find((i) => i.provenance.compatibilityGroupId === groupId);
    expect(drafted?.subjectPersonId).toBe('sender');
    expect(drafted?.approved).toBe(false);
  });

  it('is NOT_READY until both people have submitted', async () => {
    const fs = memFileSystem();
    const { groupId, bId } = await seedAnsweredGroup(fs);
    // Wipe B's response so only one is submitted.
    await fs.remove(`questionnaires/sends/${bId}/response.enc`);
    expect(
      await generateAlignment(deps(fs, fakeClient(ALIGNMENT)), {
        compatibilityGroupId: groupId,
      }),
    ).toMatchObject({ ok: false, reason: 'NOT_READY' });
  });

  it('regenerating reuses the same Insight (no duplicate)', async () => {
    const fs = memFileSystem();
    const { groupId } = await seedAnsweredGroup(fs);
    await generateAlignment(deps(fs, fakeClient(ALIGNMENT)), { compatibilityGroupId: groupId });
    await generateAlignment(deps(fs, fakeClient(ALIGNMENT)), { compatibilityGroupId: groupId });
    const drafted = (await listAllInsights(fs, key)).filter(
      (i) => i.provenance.compatibilityGroupId === groupId,
    );
    expect(drafted).toHaveLength(1);
  });

  it('deleting a member tears down the report + its drafted Insight', async () => {
    const fs = memFileSystem();
    const { groupId, aId } = await seedAnsweredGroup(fs);
    await generateAlignment(deps(fs, fakeClient(ALIGNMENT)), { compatibilityGroupId: groupId });
    await deleteSend(fs, key, aId);
    expect(await getAlignmentReport(fs, key, groupId)).toBeNull();
    expect(
      (await listAllInsights(fs, key)).some((i) => i.provenance.compatibilityGroupId === groupId),
    ).toBe(false);
    expect(await getAssignment(fs, key, aId)).toBeNull();
  });

  it('purgeCompatibilityGroup removes the report + Insight', async () => {
    const fs = memFileSystem();
    const { groupId } = await seedAnsweredGroup(fs);
    await generateAlignment(deps(fs, fakeClient(ALIGNMENT)), { compatibilityGroupId: groupId });
    await purgeCompatibilityGroup(fs, key, groupId);
    expect(await getAlignmentReport(fs, key, groupId)).toBeNull();
    expect((await listAllInsights(fs, key)).length).toBe(0);
  });
});

describe('compatibilityDisclosure', () => {
  it('derives honest recipient text per visibility mode', () => {
    expect(compatibilityDisclosure('sharedReport', 'Sam')).toContain('stay private');
    expect(compatibilityDisclosure('eachSeesOwn', 'Sam')).toContain('your own answers');
    expect(compatibilityDisclosure('senderSeesAll', 'Sam')).toContain('shared with Sam');
  });
});

import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { ClaudeClient, FileSystem } from '../host';
import { listAllInsights } from '../insights';
import type { Question } from '../schemas';
import {
  deleteCompatibilityReport,
  distillContextOnly,
  generateAlignment,
  getAlignmentReport,
} from './alignmentService';
import { getAssignment, getAssignmentSnapshot, listAssignments } from './assignmentService';
import { createCompatibilitySend } from './compatibilityService';
import { deleteSend } from './deletionService';
import { compatibilityDisclosure } from './disclosure';
import { buildVariantUserMessage } from './aiPrompts';
import { generateVariant, type AiDeps } from './generationService';
import { listInsightsForPerson } from '../insights';
import { saveQuestionnaire } from './questionnaireService';
import { saveResponse } from './responseService';
import type { CompatibilityVisibility } from '../schemas';

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
  visibility: CompatibilityVisibility = 'sharedReport',
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
  visibility: CompatibilityVisibility = 'sharedReport',
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

const targetCtx = {
  authorPersonId: 'sender',
  includeAuthor: false,
  targetPersonId: 'alex',
  includeTarget: true,
  includeRelationship: true,
} as const;

describe('generateVariant', () => {
  it('personalizes prompts while preserving type + count + canonicalId', async () => {
    const fs = memFileSystem();
    const text = JSON.stringify([
      { prompt: 'For Alex: rate connection', options: null },
      { prompt: 'For Alex: want more time?', options: null },
    ]);
    const result = await generateVariant(deps(fs, fakeClient(text)), {
      forName: 'Alex',
      aboutName: 'Sam',
      questions: canonicalQuestions,
      targetContext: targetCtx,
    });
    expect(result.ok).toBe(true);
    expect(result.questions).toHaveLength(2);
    expect(result.questions?.[0]?.prompt).toBe('For Alex: rate connection');
    expect(result.questions?.[0]?.type).toBe('rating'); // structure preserved
    expect(result.questions?.[0]?.canonicalId).toBe('c1'); // alignment key set
    expect(result.questions?.[1]?.canonicalId).toBe('c2');
  });

  it('rewrites the OPTIONS too (gendered pronouns), keeping the count (§17.14e)', async () => {
    const fs = memFileSystem();
    const withOptions: Question[] = [
      {
        id: 'c1',
        type: 'singleChoice',
        prompt: 'Where does desire start?',
        required: true,
        options: ['I want him to lead', 'I want to lead'],
      },
    ];
    // The model returns rewritten options referring to the female partner as "her" (the bug was leaving the
    // canonical "him" un-rewritten so the answers read as if the other person were answering).
    const text = JSON.stringify([
      {
        prompt: 'Where does your desire start with Angel?',
        options: ['I want her to lead', 'I want to lead'],
      },
    ]);
    const result = await generateVariant(deps(fs, fakeClient(text)), {
      forName: 'Ben',
      forGender: 'Male',
      aboutName: 'Angel',
      aboutGender: 'Female',
      questions: withOptions,
      targetContext: targetCtx,
    });
    expect(result.ok).toBe(true);
    expect(result.questions?.[0]?.options).toEqual(['I want her to lead', 'I want to lead']);
    expect(JSON.stringify(result.questions)).not.toContain('him'); // no wrong-gender partner pronoun
  });

  it('keeps the canonical options when the rewrite changes the option COUNT (safety)', async () => {
    const fs = memFileSystem();
    const withOptions: Question[] = [
      {
        id: 'c1',
        type: 'singleChoice',
        prompt: 'Pick one',
        required: true,
        options: ['A', 'B'],
      },
    ];
    // A bad rewrite drops an option → keep the canonical options (alignment + structure must hold).
    const text = JSON.stringify([{ prompt: 'Pick one (for Alex)', options: ['only A'] }]);
    const result = await generateVariant(deps(fs, fakeClient(text)), {
      forName: 'Alex',
      aboutName: 'Sam',
      questions: withOptions,
      targetContext: targetCtx,
    });
    expect(result.ok).toBe(true);
    expect(result.questions?.[0]?.options).toEqual(['A', 'B']); // canonical kept
    expect(result.questions?.[0]?.prompt).toBe('Pick one (for Alex)'); // prompt still personalized
  });

  it('maps what the model returns and keeps the canonical for the rest when fewer come back (37 §3.1)', async () => {
    // A short/partial reply (one variant for two questions) no longer fails — it personalizes the first and
    // keeps the second canonical (still aligned, just un-personalized), per the tolerant-mapping decision.
    const fs = memFileSystem();
    const result = await generateVariant(
      deps(fs, fakeClient(JSON.stringify([{ prompt: 'only one', options: null }]))),
      {
        forName: 'Alex',
        aboutName: 'Sam',
        questions: canonicalQuestions,
        targetContext: targetCtx,
      },
    );
    expect(result.ok).toBe(true);
    expect(result.questions).toHaveLength(2);
    expect(result.questions?.[0]?.prompt).toBe('only one'); // first personalized
    expect(result.questions?.[1]?.prompt).toBe('Do you want more time together?'); // second canonical kept
    expect(result.questions?.[1]?.canonicalId).toBe('c2'); // alignment key still set
  });

  it('returns an honest parse-failure (not REFUSED) when the variant reply is unparseable', async () => {
    const fs = memFileSystem();
    const result = await generateVariant(deps(fs, fakeClient('no json here at all')), {
      forName: 'Alex',
      aboutName: 'Sam',
      questions: canonicalQuestions,
      targetContext: targetCtx,
    });
    expect(result).toMatchObject({ ok: false, reason: 'MALFORMED' });
  });
});

describe('buildVariantUserMessage gender plumbing', () => {
  it('names each participant with their pronouns + instructs not to use the wrong gender (§17.14e)', () => {
    const msg = buildVariantUserMessage({
      forName: 'Ben',
      forGender: 'Male',
      aboutName: 'Angel',
      aboutGender: 'Female',
      questions: [{ prompt: 'Where does desire start?', options: ['I want him to lead'] }],
    });
    expect(msg).toContain('Ben (he/him)');
    expect(msg).toContain('Angel (she/her)');
    expect(msg).toMatch(/NEVER the wrong gender's pronoun for Angel/);
    // The options are passed through for rewriting.
    expect(msg).toContain('I want him to lead');
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
    // Stamped WHO it's about (#129) — a participant other than the sender — so Memory groups it as a
    // response, not an "about you" fact.
    expect(['alex', 'bri']).toContain(drafted?.provenance.aboutPersonId);
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

  it('deleting a member tears down the report + send, but KEEPS the drafted Insight (spec 20 §3.7)', async () => {
    const fs = memFileSystem();
    const { groupId, aId } = await seedAnsweredGroup(fs);
    await generateAlignment(deps(fs, fakeClient(ALIGNMENT)), { compatibilityGroupId: groupId });
    await deleteSend(fs, key, aId);
    expect(await getAlignmentReport(fs, key, groupId)).toBeNull();
    // The sender's drafted compatibility Insight persists as the coach's memory.
    expect(
      (await listAllInsights(fs, key)).some((i) => i.provenance.compatibilityGroupId === groupId),
    ).toBe(true);
    expect(await getAssignment(fs, key, aId)).toBeNull();
  });

  it('deleteCompatibilityReport removes the joint report but KEEPS the Insight (spec 20 §3.7)', async () => {
    const fs = memFileSystem();
    const { groupId } = await seedAnsweredGroup(fs);
    await generateAlignment(deps(fs, fakeClient(ALIGNMENT)), { compatibilityGroupId: groupId });
    await deleteCompatibilityReport(fs, key, groupId);
    expect(await getAlignmentReport(fs, key, groupId)).toBeNull();
    // The sender's derived Insight persists as the coach's memory.
    expect((await listAllInsights(fs, key)).length).toBe(1);
  });
});

describe('distillContextOnly (§16.2)', () => {
  // The distillation distils each member's OWN answers into an own-context Insight (a JSON object).
  const DISTILL = JSON.stringify({
    summary: 'They value steady connection and clear communication.',
    facts: [{ text: 'Feels most connected through shared time.' }],
    confidence: 'medium',
    crisisFlag: false,
  });

  it('auto-approves an own-context Insight for EACH participant; no report; facts never cross-shared', async () => {
    const fs = memFileSystem();
    const { groupId } = await seedAnsweredGroup(fs, 'contextOnly');
    const result = await distillContextOnly(deps(fs, fakeClient(DISTILL)), {
      compatibilityGroupId: groupId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.updated).toBe(2);
    expect(result.usage).toHaveLength(2);

    // No alignment report is produced for a context-only group.
    expect(await getAlignmentReport(fs, key, groupId)).toBeNull();

    // Each participant gets their OWN auto-approved Insight (subject = themselves), own-context-only.
    for (const subject of ['alex', 'bri']) {
      const insight = (await listInsightsForPerson(fs, key, subject)).find(
        (i) => i.provenance.compatibilityGroupId === groupId,
      );
      expect(insight, `insight for ${subject}`).toBeDefined();
      expect(insight?.subjectPersonId).toBe(subject);
      expect(insight?.approved).toBe(true); // auto-approved → feeds their own context
      expect(insight?.facts.every((f) => f.shareable === false)).toBe(true); // never cross-shared
    }
    // The sender gets no insight (they're not a participant in this two-others group).
    expect(
      (await listInsightsForPerson(fs, key, 'sender')).some(
        (i) => i.provenance.compatibilityGroupId === groupId,
      ),
    ).toBe(false);
  });

  it('re-running reuses each participant’s Insight (no duplicates)', async () => {
    const fs = memFileSystem();
    const { groupId } = await seedAnsweredGroup(fs, 'contextOnly');
    await distillContextOnly(deps(fs, fakeClient(DISTILL)), { compatibilityGroupId: groupId });
    await distillContextOnly(deps(fs, fakeClient(DISTILL)), { compatibilityGroupId: groupId });
    for (const subject of ['alex', 'bri']) {
      const insights = (await listInsightsForPerson(fs, key, subject)).filter(
        (i) => i.provenance.compatibilityGroupId === groupId,
      );
      expect(insights).toHaveLength(1);
    }
  });

  it('is NOT_READY until both have submitted, with NO partial spend or saved Insight', async () => {
    const fs = memFileSystem();
    const { groupId, bId } = await seedAnsweredGroup(fs, 'contextOnly');
    await fs.remove(`questionnaires/sends/${bId}/response.enc`);
    expect(
      await distillContextOnly(deps(fs, fakeClient(DISTILL)), { compatibilityGroupId: groupId }),
    ).toMatchObject({ ok: false, reason: 'NOT_READY' });
    // Pre-validation means A's (still-submitted) answers were NOT distilled before discovering B is absent.
    expect((await listAllInsights(fs, key)).length).toBe(0);
  });

  it('deleting a context-only group’s report KEEPS both participants’ Insights (spec 20 §3.7)', async () => {
    const fs = memFileSystem();
    const { groupId } = await seedAnsweredGroup(fs, 'contextOnly');
    await distillContextOnly(deps(fs, fakeClient(DISTILL)), { compatibilityGroupId: groupId });
    await deleteCompatibilityReport(fs, key, groupId);
    // Each participant's own-context Insight persists — only the joint report folder is removed.
    expect((await listAllInsights(fs, key)).length).toBe(2);
  });
});

describe('compatibilityDisclosure', () => {
  // The viewer is the partner (a non-sender participant); the sender is Sam, the other participant Sam.
  const asPartner = { otherParticipantName: 'Sam', senderName: 'Sam', viewerIsSender: false };

  it('derives honest recipient text per visibility mode, naming the OTHER participant', () => {
    expect(compatibilityDisclosure('sharedReport', asPartner)).toContain('neither you nor Sam');
    expect(compatibilityDisclosure('eachSeesOwn', asPartner)).toContain('your own answers');
    expect(compatibilityDisclosure('senderSeesAll', asPartner)).toContain('shared with Sam');
  });

  it('names the OTHER participant, never the sender as a neutral third party (§16.1)', () => {
    // Two-others mode: viewer is Alex, the other participant is Bri, the sender is a third party (Sam).
    const text = compatibilityDisclosure('sharedReport', {
      otherParticipantName: 'Bri',
      senderName: 'Sam',
      viewerIsSender: false,
    });
    expect(text).toContain('neither you nor Bri');
    expect(text).not.toContain('Sam'); // the sender is never named as the "other" answerer
  });

  it('reads naturally when the sender is a participant (senderSeesAll, viewerIsSender)', () => {
    const text = compatibilityDisclosure('senderSeesAll', {
      otherParticipantName: 'Angel',
      senderName: 'You',
      viewerIsSender: true,
    });
    expect(text).toContain('both your own answers and Angel');
  });

  it('contextOnly promises no report and no one sees the answers (§16.2)', () => {
    const text = compatibilityDisclosure('contextOnly', asPartner);
    expect(text).toMatch(/no report/i);
    expect(text).toMatch(/no one in this exchange sees your answers/i);
  });
});

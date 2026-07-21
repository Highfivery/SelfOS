import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import { upsertPerson } from '../people/peopleService';
import { saveInsight } from '../insights';
import { saveQuestionnaire } from './questionnaireService';
import { createAssignment } from './assignmentService';
import { saveResponse } from './responseService';
import {
  buildDedupReference,
  gatherRecipientHistory,
  gatherRecipientPriorAnswers,
  gatherRecipientQuestionnaireTitles,
} from './recipientHistory';

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

  it('OMITS a per-question decline — a skip is not biography material nor known data (§25.5)', async () => {
    const fs = memFileSystem();
    const mara = await upsertPerson(fs, key, { displayName: 'Mara', isSubject: true, tags: [] });
    const def = await saveQuestionnaire(fs, key, {
      title: 'Last week',
      type: 'general',
      sensitivity: 'standard',
      recipient: { kind: 'person', personId: mara.id },
      questions: [
        { id: 'q1', type: 'shortText', prompt: 'What lifted you up?', required: true },
        { id: 'q2', type: 'shortText', prompt: 'What drained you?', required: false },
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
      answers: [
        { questionId: 'q1', value: 'A quiet hike.' },
        { questionId: 'q2', value: { declined: true, reason: 'Prefer not to say' } },
      ],
      submittedAt: now,
    });

    const answers = await gatherRecipientPriorAnswers(fs, key, mara.id);
    expect(answers).toMatch(/A: A quiet hike\./); // the real answer is included
    expect(answers).not.toContain('What drained you?'); // the skipped question is not
    expect(answers).not.toContain('Skipped'); // and no "Skipped" leaks in as an answer
  });
});

describe('gatherRecipientQuestionnaireTitles (08 §23.5 — topic-level de-dup signal)', () => {
  it('returns the deduped titles of questionnaires already sent to the recipient', async () => {
    const fs = memFileSystem();
    const mara = await upsertPerson(fs, key, { displayName: 'Mara', isSubject: true, tags: [] });
    const send = async (title: string): Promise<void> => {
      const def = await saveQuestionnaire(fs, key, {
        title,
        type: 'general',
        sensitivity: 'standard',
        recipient: { kind: 'person', personId: mara.id },
        questions: [{ id: 'q1', type: 'yesNo', prompt: 'q?', required: false }],
      });
      await createAssignment(fs, key, {
        questionnaireId: def.id,
        senderPersonId: 'owner',
        recipient: { kind: 'person', personId: mara.id },
        channel: 'inApp',
        privacy: 'private',
        senderVisibleToRecipient: true,
      });
    };
    await send('Money & roots');
    await send('Partner discovery');
    await send('Money & roots'); // a re-send of the same topic → deduped

    const titles = await gatherRecipientQuestionnaireTitles(fs, key, mara.id);
    expect(titles.sort()).toEqual(['Money & roots', 'Partner discovery']);
    // A different recipient shares none of these.
    expect(await gatherRecipientQuestionnaireTitles(fs, key, 'someone-else')).toEqual([]);
  });
});

describe('buildDedupReference (08 §23.5b — the shared budgeting rule)', () => {
  it('leads with the onboarding block, then prior answers, then insight facts, then asked prompts', async () => {
    const ref = buildDedupReference({
      intakeText: 'They said they love hiking and hate mornings.',
      priorAnswers: 'From "Last week":\n  Q: What lifted you up?\n  A: A hike.',
      insightFacts: 'Themes they have already explored:\n- Feeling stretched at work.',
      priorPrompts: ['How was your week at work?'],
    });
    // Onboarding leads (the authoritative "we already have data for this"), followed by the other sections
    // in priority order — asserted by their positions in the assembled reference.
    const onboarding = ref.indexOf('ALREADY ANSWERED in their onboarding');
    const answers = ref.indexOf('ALREADY ANSWERED in prior questionnaires');
    const known = ref.indexOf('ALREADY KNOWN about them');
    const asked = ref.indexOf('ALREADY ASKED in prior questionnaires');
    expect(onboarding).toBeGreaterThanOrEqual(0);
    expect(onboarding).toBeLessThan(answers);
    expect(answers).toBeLessThan(known);
    expect(known).toBeLessThan(asked);
    // The actual material rides along under each heading.
    expect(ref).toContain('love hiking and hate mornings');
    expect(ref).toContain('How was your week at work?');
  });

  it('includes only the sections whose input is non-empty; a wholly-empty input is an empty reference', () => {
    // Only prior answers present → only that block, nothing else.
    const answersOnly = buildDedupReference({
      intakeText: '   ',
      priorAnswers: 'From "Last week":\n  Q: X?\n  A: Y.',
      insightFacts: '',
      priorPrompts: [],
    });
    expect(answersOnly).toContain('ALREADY ANSWERED in prior questionnaires');
    expect(answersOnly).not.toContain('ALREADY ANSWERED in their onboarding');
    expect(answersOnly).not.toContain('ALREADY KNOWN about them');
    expect(answersOnly).not.toContain('ALREADY ASKED in prior questionnaires');
    // Nothing on record at all → the reference is empty (so `willSemanticDedup` stays off for a fresh person).
    expect(
      buildDedupReference({ intakeText: '', priorAnswers: '', insightFacts: '', priorPrompts: [] }),
    ).toBe('');
  });

  it('caps each section independently so a heavy onboarding can never truncate the other sections away', () => {
    const bigIntake = 'i'.repeat(14100); // > the 14000 onboarding cap (raised so a full intake isn't cut)
    const bigAnswers = 'a'.repeat(4100); // > the 4000 prior-answers cap
    const bigFacts = 'f'.repeat(3100); // > the 3000 insight-facts cap
    const manyPrompts = Array.from({ length: 200 }, (_, n) => `Prompt number ${n} about a thing`); // > 2000 chars joined
    const ref = buildDedupReference({
      intakeText: bigIntake,
      priorAnswers: bigAnswers,
      insightFacts: bigFacts,
      priorPrompts: manyPrompts,
    });
    // Each over-long section is truncated with the "\n…" tail — but every section survives (independent budgets).
    expect(ref).toContain('ALREADY ANSWERED in their onboarding');
    expect(ref).toContain('ALREADY ANSWERED in prior questionnaires');
    expect(ref).toContain('ALREADY KNOWN about them');
    expect(ref).toContain('ALREADY ASKED in prior questionnaires');
    // A truncated onboarding keeps only the first 14000 chars + the ellipsis marker.
    expect(ref).toContain(`${'i'.repeat(14000)}\n…`);
    expect(ref).not.toContain('i'.repeat(14001)); // never the full over-long block
    // The lower-priority sections are truncated too (their own budgets), each ending in the ellipsis marker.
    expect(ref).toContain(`${'a'.repeat(4000)}\n…`);
    expect(ref).toContain(`${'f'.repeat(3000)}\n…`);
  });
});

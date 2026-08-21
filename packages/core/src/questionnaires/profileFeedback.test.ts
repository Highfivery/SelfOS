import { describe, expect, it } from 'vitest';

import { generateMasterKey } from '../crypto';
import type { FileSystem } from '../host';
import { memFileSystem } from '../host/memFileSystem';
import { upsertPerson } from '../people/peopleService';

import { buildGenerationUserMessage } from './aiPrompts';
import {
  NOT_APPLICABLE_SKIP_REASON,
  PREFER_NOT_TO_SAY_SKIP_REASON,
  UNCLEAR_SKIP_REASON,
} from './answering';
import { openAssignment, submitResponse } from './answerService';
import { createAssignment } from './assignmentService';
import { readProfile } from './personalizationProfile';
import { captureResponseFeedback } from './profileFeedback';
import { saveQuestionnaire } from './questionnaireService';
import { gatherRecipientFeedbackGuidance } from './recipientHistory';

const key = generateMasterKey();

async function seed(fs: FileSystem, recipientId?: string): Promise<string> {
  const q = await saveQuestionnaire(fs, key, {
    title: 'Check-in',
    type: 'general',
    sensitivity: 'standard',
    questions: [
      { id: 'q1', type: 'shortText', prompt: 'How is work going?', required: false },
      { id: 'q2', type: 'yesNo', prompt: 'Feeling good lately?', required: false },
    ],
  });
  const a = await createAssignment(fs, key, {
    questionnaireId: q.id,
    senderPersonId: 'author',
    recipient: recipientId
      ? { kind: 'person', personId: recipientId }
      : { kind: 'external', displayName: 'A friend' },
    channel: 'inApp',
    privacy: 'private',
    senderVisibleToRecipient: true,
  });
  return a.id;
}

describe('captureResponseFeedback (via submitResponse) → the Personalization Profile', () => {
  it('records a household recipient’s "doesn’t apply" decline and it steers future generation', async () => {
    const fs = memFileSystem();
    await upsertPerson(fs, key, { id: 'p2', displayName: 'Pat', isSubject: true, tags: [] });
    const id = await seed(fs, 'p2');

    await submitResponse(fs, key, {
      assignmentId: id,
      answers: [
        { questionId: 'q1', value: { declined: true, reason: NOT_APPLICABLE_SKIP_REASON } },
        { questionId: 'q2', value: true },
      ],
    });

    const profile = await readProfile(fs, key, 'p2');
    expect(profile.feedback).toHaveLength(1);
    expect(profile.feedback[0]).toMatchObject({
      kind: 'not-applicable',
      questionPrompt: 'How is work going?',
    });

    const guidance = await gatherRecipientFeedbackGuidance(fs, key, 'p2');
    expect(guidance).toContain("DON'T APPLY");
    expect(guidance).toContain('How is work going?');
    // And that guidance reaches the generation prompt (spec 69 §5.9 — assert the PROMPT, not just the count).
    const prompt = buildGenerationUserMessage({
      type: 'general',
      sensitivity: 'standard',
      existingPrompts: [],
      count: 4,
      feedbackGuidance: guidance,
    });
    expect(prompt).toContain("DON'T APPLY");
    expect(prompt).toContain('How is work going?');
  });

  it('stamps the TOPIC a declined question covered, not just its wording (08 §34 / 2b)', async () => {
    const fs = memFileSystem();
    await upsertPerson(fs, key, { id: 'p2', displayName: 'Pat', isSubject: true, tags: [] });
    // A planner-written question carries the ground it covers (71 §5.3 tags it at write time).
    const q = await saveQuestionnaire(fs, key, {
      title: 'Check-in',
      type: 'general',
      sensitivity: 'standard',
      questions: [
        {
          id: 'q1',
          type: 'shortText',
          prompt: 'How is work going?',
          required: false,
          topicIds: ['work-stress', 'career'],
        },
      ],
    });
    const a = await createAssignment(fs, key, {
      questionnaireId: q.id,
      senderPersonId: 'author',
      recipient: { kind: 'person', personId: 'p2' },
      channel: 'inApp',
      privacy: 'private',
      senderVisibleToRecipient: true,
    });
    await submitResponse(fs, key, {
      assignmentId: a.id,
      answers: [
        { questionId: 'q1', value: { declined: true, reason: NOT_APPLICABLE_SKIP_REASON } },
      ],
    });

    const profile = await readProfile(fs, key, 'p2');
    const entry = profile.feedback.find((f) => f.kind === 'not-applicable');
    // The PRIMARY ground the planner picked it for. Without this the mark is about one wording only, so the
    // subject can be re-asked forever in slightly different words, and the Explored panel has nothing to
    // hang the mark on.
    expect(entry?.topicId).toBe('work-stress');
    expect(entry?.questionPrompt).toBe('How is work going?');
  });

  it('leaves a hand-authored question’s decline topic-less (nothing to stamp)', async () => {
    const fs = memFileSystem();
    await upsertPerson(fs, key, { id: 'p2', displayName: 'Pat', isSubject: true, tags: [] });
    const id = await seed(fs, 'p2'); // no topicIds on these questions
    await submitResponse(fs, key, {
      assignmentId: id,
      answers: [
        { questionId: 'q1', value: { declined: true, reason: NOT_APPLICABLE_SKIP_REASON } },
      ],
    });
    const profile = await readProfile(fs, key, 'p2');
    expect(profile.feedback.find((f) => f.kind === 'not-applicable')?.topicId).toBeUndefined();
  });

  it('captures an "unclear" skip as reword guidance', async () => {
    const fs = memFileSystem();
    await upsertPerson(fs, key, { id: 'p3', displayName: 'Sam', isSubject: true, tags: [] });
    const id = await seed(fs, 'p3');
    await submitResponse(fs, key, {
      assignmentId: id,
      answers: [{ questionId: 'q1', value: { declined: true, reason: UNCLEAR_SKIP_REASON } }],
    });
    const guidance = await gatherRecipientFeedbackGuidance(fs, key, 'p3');
    expect(guidance).toContain('UNCLEAR');
    expect(guidance).toContain('How is work going?');
  });

  it('captures a "prefer not to say" as a boundary', async () => {
    const fs = memFileSystem();
    await upsertPerson(fs, key, { id: 'p5', displayName: 'Ari', isSubject: true, tags: [] });
    const id = await seed(fs, 'p5');
    await submitResponse(fs, key, {
      assignmentId: id,
      answers: [
        { questionId: 'q1', value: { declined: true, reason: PREFER_NOT_TO_SAY_SKIP_REASON } },
      ],
    });
    expect((await readProfile(fs, key, 'p5')).feedback[0]?.kind).toBe('prefer-not-to-say');
  });

  it('skips capture for a non-household recipient (no Person record → no profile)', async () => {
    const fs = memFileSystem();
    // 'p9' is used as a recipient id but no Person exists for it → the household gate skips capture.
    const id = await seed(fs, 'p9');
    await submitResponse(fs, key, {
      assignmentId: id,
      answers: [
        { questionId: 'q1', value: { declined: true, reason: NOT_APPLICABLE_SKIP_REASON } },
      ],
    });
    expect((await readProfile(fs, key, 'p9')).feedback).toEqual([]);
  });

  it('records RICH engagement (spec 69 §5.2) when the person answers substantively, steering deeper', async () => {
    const fs = memFileSystem();
    await upsertPerson(fs, key, { id: 'p4', displayName: 'Lee', isSubject: true, tags: [] });
    const id = await seed(fs, 'p4');
    // Both questions answered substantively → 2/2 ≥ 0.6 → a productive vein.
    await submitResponse(fs, key, {
      assignmentId: id,
      answers: [
        { questionId: 'q1', value: 'work has been busy but genuinely rewarding' },
        { questionId: 'q2', value: true },
      ],
    });
    const profile = await readProfile(fs, key, 'p4');
    expect(profile.feedback.every((f) => f.kind === 'answered-richly')).toBe(true);
    expect(profile.feedback.map((f) => f.questionPrompt)).toContain('How is work going?');
    // …and it steers generation to go DEEPER on that productive ground (never a re-ask).
    const guidance = await gatherRecipientFeedbackGuidance(fs, key, 'p4');
    expect(guidance).toMatch(/engaged RICHLY/);
    expect(guidance).toContain('How is work going?');
  });

  it('does NOT claim rich engagement on a mostly-skipped submit', async () => {
    const fs = memFileSystem();
    await upsertPerson(fs, key, { id: 'p5', displayName: 'Sam', isSubject: true, tags: [] });
    const id = await seed(fs, 'p5');
    // Only 1 of 2 answered (0.5 < 0.6) → no rich claim; just the decline.
    await submitResponse(fs, key, {
      assignmentId: id,
      answers: [
        { questionId: 'q1', value: 'fine' },
        { questionId: 'q2', value: { declined: true, reason: NOT_APPLICABLE_SKIP_REASON } },
      ],
    });
    const profile = await readProfile(fs, key, 'p5');
    expect(profile.feedback.some((f) => f.kind === 'answered-richly')).toBe(false);
    expect(profile.feedback.some((f) => f.kind === 'not-applicable')).toBe(true);
  });
});

describe('captureResponseFeedback → the "bailed" abandonment signal (spec 69 §5.2)', () => {
  async function ask(fs: FileSystem, recipientId: string, title: string): Promise<string> {
    const q = await saveQuestionnaire(fs, key, {
      title,
      type: 'general',
      sensitivity: 'standard',
      questions: [{ id: 'q1', type: 'shortText', prompt: 'Tell me?', required: false }],
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

  it('records a stale opened-but-unsubmitted check-in as bailed → a "keep it short" steer', async () => {
    const fs = memFileSystem();
    await upsertPerson(fs, key, { id: 'p1', displayName: 'Pat', isSubject: true, tags: [] });
    // Abandoned: opened, never submitted.
    const abandoned = await ask(fs, 'p1', 'A long survey');
    await openAssignment(fs, key, abandoned);
    // A different one they DO finish (gives capture a submitted response to run against).
    const finished = await ask(fs, 'p1', 'A quick one');
    await submitResponse(fs, key, {
      assignmentId: finished,
      answers: [{ questionId: 'q1', value: 'ok' }],
    });

    // Run capture at a point where the abandoned one is stale.
    const later = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    await captureResponseFeedback(fs, key, finished, later);

    const profile = await readProfile(fs, key, 'p1');
    expect(profile.feedback.some((f) => f.kind === 'bailed' && f.topicId === abandoned)).toBe(true);
    // …and it steers generation toward shorter/simpler questionnaires (topic-agnostic).
    const guidance = await gatherRecipientFeedbackGuidance(fs, key, 'p1', later);
    expect(guidance).toMatch(/left check-ins UNFINISHED/);
  });
});

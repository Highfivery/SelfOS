import { describe, expect, it } from 'vitest';
import type {
  AnswersUpdatedSummary,
  Insight,
  Questionnaire,
  QuestionnaireSentOverview,
  ReminderDueSummary,
  ResponsesArrivedSummary,
} from '@shared/channels';
import {
  needsYou,
  questionnaireInsights,
  rollupStats,
  unsentTypes,
} from './questionnaireDashboard';

function overview(
  id: string,
  patch: Partial<QuestionnaireSentOverview> = {},
): QuestionnaireSentOverview {
  return {
    questionnaireId: id,
    lastSentAt: 'now',
    recipients: [{ name: 'Angel', status: 'submitted', answered: true }],
    answeredCount: 1,
    newResponses: 0,
    analyzed: true,
    ...patch,
  };
}

function insight(id: string, patch: Partial<Insight> = {}): Insight {
  return {
    id,
    schemaVersion: 1,
    source: 'questionnaire',
    subjectPersonId: 'me',
    summary: `Insight ${id}`,
    facts: [],
    confidence: 'medium',
    categories: [],
    approved: true,
    provenance: { at: 'now' },
    createdAt: 'now',
    updatedAt: '2026-07-01',
    ...patch,
  };
}

describe('rollupStats (59 §3.2)', () => {
  it('sums recipients, answered, and new replies across all questionnaires', () => {
    const r = rollupStats({
      q1: overview('q1', {
        recipients: [
          { name: 'A', status: 'submitted', answered: true },
          { name: 'B', status: 'sent', answered: false },
        ],
        answeredCount: 1,
        newResponses: 1,
      }),
      q2: overview('q2', {
        recipients: [{ name: 'C', status: 'submitted', answered: true }],
        answeredCount: 1,
        newResponses: 0,
      }),
    });
    expect(r.sentCount).toBe(2);
    expect(r.totalSends).toBe(3);
    expect(r.answeredSends).toBe(2);
    expect(r.responseRate).toBeCloseTo(2 / 3);
    expect(r.newReplies).toBe(1);
  });

  it('is all-zero (never divides by zero) with no sends', () => {
    const r = rollupStats({});
    expect(r).toEqual({
      sentCount: 0,
      totalSends: 0,
      answeredSends: 0,
      responseRate: 0,
      newReplies: 0,
    });
  });
});

describe('questionnaireInsights (59 §3.4)', () => {
  it('counts + returns the newest approved questionnaire insight for the subject, with aboutName', () => {
    const result = questionnaireInsights(
      [
        insight('old', { updatedAt: '2026-06-01' }),
        insight('new', {
          updatedAt: '2026-07-10',
          provenance: { at: 'now', aboutName: 'Angel' },
        }),
        insight('session-src', { source: 'session' }), // wrong source → excluded
        insight('unapproved', { approved: false }), // not approved → excluded
        insight('other-person', { subjectPersonId: 'someone-else' }), // wrong subject → excluded
      ],
      'me',
    );
    expect(result.count).toBe(2); // old + new (the questionnaire+approved+me ones)
    expect(result.latest?.id).toBe('new');
    expect(result.latest?.aboutName).toBe('Angel');
  });

  it('is empty when there are no questionnaire insights', () => {
    expect(questionnaireInsights([insight('s', { source: 'session' })], 'me')).toEqual({
      count: 0,
      latest: null,
    });
  });
});

describe('needsYou (59 §3.3)', () => {
  const answered: ResponsesArrivedSummary = {
    questionnaireId: 'q1',
    title: 'Check-in',
    submittedCount: 1,
    latestRecipientName: 'Angel',
    at: 'now',
  };
  const edit: AnswersUpdatedSummary = {
    assignmentId: 'as9',
    questionnaireId: 'q2',
    title: 'Date night',
    recipientName: 'Sam',
    revision: 2,
    at: 'now',
  };
  const reminder: ReminderDueSummary = {
    questionnaireId: 'q3',
    title: 'The move',
    recipientName: 'Dad',
    count: 1,
  };

  it('ranks analyze > answer > re-analyze > resend and caps at the max', () => {
    const items = needsYou({
      sentOverview: { q1: overview('q1', { analyzableAssignmentId: 'as1', newResponses: 1 }) },
      responsesArrived: [answered],
      answersUpdated: [edit],
      remindersDue: [reminder],
      inboxCount: 2,
      canAnswer: true,
      max: 3,
    });
    expect(items.map((i) => i.kind)).toEqual(['analyze', 'answer', 'reAnalyze']); // resend dropped by the cap
    expect(items[0]).toMatchObject({
      kind: 'analyze',
      assignmentId: 'as1',
      recipientName: 'Angel',
    });
  });

  it('drops an analyze row when the send is already analysed (no analyzableAssignmentId)', () => {
    const items = needsYou({
      sentOverview: { q1: overview('q1') }, // analyzed, no analyzableAssignmentId
      responsesArrived: [answered],
      answersUpdated: [],
      remindersDue: [],
      inboxCount: 0,
      canAnswer: true,
    });
    expect(items).toEqual([]);
  });

  it('omits the answer row when the person cannot answer', () => {
    const items = needsYou({
      sentOverview: {},
      responsesArrived: [],
      answersUpdated: [],
      remindersDue: [],
      inboxCount: 3,
      canAnswer: false,
    });
    expect(items).toEqual([]);
  });
});

describe('unsentTypes (59 §3.5)', () => {
  function q(id: string, type: string): Questionnaire {
    return {
      id,
      schemaVersion: 1,
      version: 1,
      title: id,
      type,
      sensitivity: 'standard',
      questions: [],
      createdAt: 'now',
      updatedAt: 'now',
    } as Questionnaire;
  }

  it('returns inviting starter types the person has SENT none of', () => {
    const sent = unsentTypes(
      [q('a', 'appreciation'), q('b', 'general')],
      { a: overview('a') }, // only the appreciation one was actually sent
    );
    const values = sent.map((t) => t.value);
    expect(values).not.toContain('appreciation'); // sent → excluded
    expect(values).toContain('perspective'); // never sent, inviting → included
    expect(values).not.toContain('intimacy'); // not in the inviting subset
  });
});

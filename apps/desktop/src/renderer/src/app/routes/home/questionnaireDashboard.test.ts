import { describe, expect, it } from 'vitest';
import type {
  AnswersUpdatedSummary,
  Insight,
  Person,
  Questionnaire,
  QuestionnaireSentOverview,
  ReminderDueSummary,
  ResponsesArrivedSummary,
} from '@shared/channels';
import {
  engagementSummary,
  goDeeperThemes,
  needsYou,
  questionnaireInsights,
  questionnaireTrend,
  richInsights,
  rollupStats,
  sentTypeCount,
  unsentTypes,
} from './questionnaireDashboard';

function q(id: string, type: string, title = id): Questionnaire {
  return {
    id,
    schemaVersion: 1,
    version: 1,
    title,
    type,
    sensitivity: 'standard',
    questions: [],
    createdAt: 'now',
    updatedAt: 'now',
  } as Questionnaire;
}

function personFix(id: string, displayName: string): Person {
  return {
    id,
    schemaVersion: 1,
    displayName,
    isSubject: true,
    tags: [],
    createdAt: 'now',
    updatedAt: 'now',
  };
}

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

describe('questionnaireTrend (59 §3.4)', () => {
  it('reports a metric with ≥2 readings, direction earliest→latest', () => {
    const t = questionnaireTrend(
      [
        insight('a', { updatedAt: '2026-06-01', metrics: { connection: 3 } }),
        insight('b', { updatedAt: '2026-07-01', metrics: { connection: 5 } }),
      ],
      'me',
    );
    expect(t).toEqual({ label: 'connection', direction: 'up', points: 2 });
  });

  it('humanizes a camelCase metric key and detects a downward move', () => {
    const t = questionnaireTrend(
      [
        insight('a', { updatedAt: '2026-06-01', metrics: { moodValence: 0.6 } }),
        insight('b', { updatedAt: '2026-07-01', metrics: { moodValence: 0.2 } }),
      ],
      'me',
    );
    expect(t?.label).toBe('mood valence');
    expect(t?.direction).toBe('down');
  });

  it('returns null when no metric has ≥2 readings, or the subject is null', () => {
    expect(questionnaireTrend([insight('a', { metrics: { connection: 3 } })], 'me')).toBeNull();
    expect(
      questionnaireTrend(
        [
          insight('a', { updatedAt: '2026-06-01', metrics: { connection: 3 } }),
          insight('b', { updatedAt: '2026-07-01', metrics: { connection: 5 } }),
        ],
        null,
      ),
    ).toBeNull();
  });

  it('picks the metric with the most readings', () => {
    const t = questionnaireTrend(
      [
        insight('a', { updatedAt: '2026-06-01', metrics: { connection: 3, desire: 2 } }),
        insight('b', { updatedAt: '2026-06-15', metrics: { connection: 4 } }),
        insight('c', { updatedAt: '2026-07-01', metrics: { connection: 5, desire: 4 } }),
      ],
      'me',
    );
    expect(t?.label).toBe('connection'); // 3 readings vs desire's 2
    expect(t?.points).toBe(3);
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

describe('engagementSummary (59 §3.1a)', () => {
  it('counts insights + the people they are about, and lists household people never sent to', () => {
    const e = engagementSummary(
      [
        insight('i1', { provenance: { at: 'now', aboutName: 'Angel' } }),
        insight('i2', { provenance: { at: 'now', aboutName: 'Angel' } }), // same person → 1
        insight('i3', { source: 'session' }), // not a questionnaire → excluded
      ],
      [personFix('me', 'Me'), personFix('angel', 'Angel'), personFix('dad', 'Dad')],
      {
        q1: overview('q1', {
          recipients: [{ name: 'Angel', status: 'submitted', answered: true }],
        }),
      },
      'me',
    );
    expect(e.insightCount).toBe(2);
    expect(e.peopleCount).toBe(1); // both insights are about Angel
    expect(e.notAsked).toEqual(['Dad']); // Angel was sent to; Dad never; self excluded
  });
});

describe('richInsights (59 §3.4)', () => {
  it('names who it is about + which questionnaire + the life-area, from an analysed send', () => {
    const cards = richInsights(
      {
        q1: overview('q1', {
          analyzed: true,
          insightId: 'ins1',
          insightSummary: 'Angel loves slow mornings.',
          answeredAt: '2026-07-10',
          recipients: [{ name: 'Angel', status: 'submitted', answered: true }],
        }),
      },
      [q('q1', 'general', 'Morning routines')],
      [
        insight('ins1', {
          categories: ['Relationships'],
          provenance: { at: 'now', aboutName: 'Angel' },
        }),
      ],
      [],
      'me',
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      title: 'Morning routines',
      aboutName: 'Angel',
      summary: 'Angel loves slow mornings.',
      area: 'Relationships',
    });
  });

  it('labels a self check-in with a null aboutName (no provenance about)', () => {
    const cards = richInsights(
      {
        q1: overview('q1', {
          analyzed: true,
          insightId: 'ins1',
          insightSummary: 'You value quiet time.',
          recipients: [{ name: 'Me', status: 'submitted', answered: true }],
        }),
      },
      [q('q1', 'general', 'Self check-in')],
      [insight('ins1', { provenance: { at: 'now' } })], // no aboutName/aboutPersonId → self
      [],
      'me',
    );
    expect(cards[0]?.aboutName).toBeNull();
  });

  it('resolves a household aboutPersonId to the display name (not the first answerer)', () => {
    const cards = richInsights(
      {
        q1: overview('q1', {
          analyzed: true,
          insightId: 'ins1',
          insightSummary: 'Ben wants more spontaneity.',
          recipients: [
            { name: 'Angel', status: 'submitted', answered: true },
            { name: 'Ben', status: 'submitted', answered: true },
          ],
        }),
      },
      [q('q1', 'general', 'Date ideas')],
      [insight('ins1', { provenance: { at: 'now', aboutPersonId: 'ben-id' } })],
      [personFix('ben-id', 'Ben')],
      'me',
    );
    expect(cards[0]?.aboutName).toBe('Ben'); // resolved from aboutPersonId, not the first answerer "Angel"
  });

  it('skips un-analysed + unapproved sends and returns [] for a null subject', () => {
    const overviewMap = { q1: overview('q1') }; // analyzed but no insightId/summary
    expect(richInsights(overviewMap, [q('q1', 'general')], [], [], 'me')).toEqual([]);
    // An unapproved insight is not shown (matches the approved-only count).
    const withUnapproved = {
      q1: overview('q1', { analyzed: true, insightId: 'ins1', insightSummary: 'draft' }),
    };
    expect(
      richInsights(
        withUnapproved,
        [q('q1', 'general')],
        [insight('ins1', { approved: false })],
        [],
        'me',
      ),
    ).toEqual([]);
    expect(richInsights({}, [], [], [], null)).toEqual([]);
  });
});

describe('goDeeperThemes (59 §3.5a)', () => {
  const sessionInsight = (cat: string, id: string): Insight =>
    insight(id, { source: 'session', categories: [cat] });

  it('surfaces the most-mentioned session area (≥2), a recurring dream, and a Together partner', () => {
    const themes = goDeeperThemes({
      sessionInsights: [sessionInsight('Work', 's1'), sessionInsight('Work', 's2')],
      dreamSymbols: [{ label: 'the ocean', count: 3 }],
      togetherPartnerName: 'Angel',
    });
    expect(themes).toEqual([
      { kind: 'session', area: 'Work' },
      { kind: 'dream', symbol: 'the ocean' },
      { kind: 'together', partnerName: 'Angel' },
    ]);
  });

  it('needs ≥2 for a session area and ≥2 for a dream symbol', () => {
    const themes = goDeeperThemes({
      sessionInsights: [sessionInsight('Work', 's1')], // only 1 → no session theme
      dreamSymbols: [{ label: 'a door', count: 1 }], // only 1 → no dream theme
    });
    expect(themes).toEqual([]);
  });
});

describe('sentTypeCount (59 §3.6)', () => {
  it('counts distinct STARTER types the person has actually sent', () => {
    const count = sentTypeCount(
      [q('a', 'appreciation'), q('b', 'appreciation'), q('c', 'scenario'), q('d', 'my-custom')],
      { a: overview('a'), c: overview('c'), d: overview('d') }, // b never sent; d is custom (not a starter)
    );
    expect(count).toBe(2); // appreciation + scenario
  });
});

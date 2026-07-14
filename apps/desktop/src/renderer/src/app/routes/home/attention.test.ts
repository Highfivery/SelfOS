import { describe, expect, it } from 'vitest';
import type {
  Goal,
  QuestionnaireSentOverview,
  TestResult,
  TogetherSessionSummary,
} from '@shared/schemas';
import { needsAttention, type AttentionInput } from './attention';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-07-14T00:00:00.000Z');

const ALL_CAPS = {
  memory: true,
  tests: true,
  questionnaires: true,
  viewResults: true,
  together: true,
};

function base(over: Partial<AttentionInput> = {}): AttentionInput {
  return {
    now: NOW,
    activePersonId: 'me',
    goals: [],
    sentOverview: {},
    togetherSessions: [],
    resultsByTest: {},
    insightDraftCount: 0,
    otherPeopleCount: 1,
    suppressNudges: false,
    can: ALL_CAPS,
    ...over,
  };
}

const goal = (over: Partial<Goal> & { id: string }): Goal => ({
  schemaVersion: 1,
  subjectPersonId: 'me',
  text: over.id,
  status: 'open',
  provenance: { at: '2026-06-01T00:00:00.000Z' },
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
  ...over,
});

const session = (over: Partial<TogetherSessionSummary>): TogetherSessionSummary => ({
  id: 's1',
  pairKey: 'me~angel',
  initiatorPersonId: 'me',
  participants: [
    { personId: 'me', displayName: 'Me' },
    { personId: 'angel', displayName: 'Angel' },
  ],
  status: 'active',
  yourTurn: false,
  unreadCount: 0,
  createdAt: 'now',
  ...over,
});

const overview = (over: Partial<QuestionnaireSentOverview>): QuestionnaireSentOverview => ({
  questionnaireId: 'q1',
  lastSentAt: '2026-07-13T00:00:00.000Z',
  recipients: [],
  answeredCount: 0,
  newResponses: 0,
  analyzed: true,
  ...over,
});

const result = (takenAt: string): TestResult => ({
  id: 'r',
  schemaVersion: 1,
  testId: 'phq9',
  testVersion: 1,
  subjectPersonId: 'me',
  answers: [],
  scores: [],
  takenAt,
  createdAt: takenAt,
  updatedAt: takenAt,
});

describe('needsAttention (60 §3.1.2a)', () => {
  it('is empty when nothing is pending', () => {
    expect(needsAttention(base())).toEqual([]);
  });

  it('surfaces a Together turn and leads the queue', () => {
    const items = needsAttention(
      base({
        togetherSessions: [session({ yourTurn: true })],
        goals: [goal({ id: 'g', due: '2026-06-01' })], // stale nudge
      }),
    );
    expect(items[0]?.kind).toBe('together-turn');
    expect(items[0]?.label).toMatch(/your turn with Angel/i);
  });

  it('shows a pending invite only when it is not already your turn', () => {
    const invite = needsAttention(
      base({
        togetherSessions: [session({ status: 'invited', initiatorPersonId: 'angel' })],
      }),
    );
    expect(invite.map((i) => i.kind)).toContain('together-invite');
    // A your-turn session takes precedence over an invite (never both).
    const both = needsAttention(
      base({
        togetherSessions: [
          session({ id: 's1', yourTurn: true }),
          session({ id: 's2', status: 'invited', initiatorPersonId: 'angel' }),
        ],
      }),
    );
    expect(both.map((i) => i.kind)).toContain('together-turn');
    expect(both.map((i) => i.kind)).not.toContain('together-invite');
  });

  it('surfaces responses to analyze, insights to review, and their counts', () => {
    const items = needsAttention(
      base({ sentOverview: { q1: overview({ newResponses: 3 }) }, insightDraftCount: 2 }),
    );
    const analyze = items.find((i) => i.kind === 'analyze-responses');
    const review = items.find((i) => i.kind === 'review-insights');
    expect(analyze?.count).toBe(3);
    expect(analyze?.label).toMatch(/3 responses/i);
    expect(review?.count).toBe(2);
  });

  it('nudges the weekly check-in only when a prior check-in has gone ≥7 days', () => {
    const stale = needsAttention(base({ resultsByTest: { phq9: [result(iso(NOW - 9 * DAY))] } }));
    expect(stale.some((i) => i.kind === 'check-in')).toBe(true);
    const recent = needsAttention(base({ resultsByTest: { phq9: [result(iso(NOW - 3 * DAY))] } }));
    expect(recent.some((i) => i.kind === 'check-in')).toBe(false);
    // Never for someone who has NEVER checked in (no first-time nag).
    expect(needsAttention(base()).some((i) => i.kind === 'check-in')).toBe(false);
  });

  it('nudges stale goals with a count', () => {
    const items = needsAttention(
      base({ goals: [goal({ id: 'a', due: '2026-06-01' }), goal({ id: 'b', due: '2026-06-02' })] }),
    );
    const stale = items.find((i) => i.kind === 'stale-goals');
    expect(stale?.count).toBe(2);
    expect(stale?.label).toMatch(/2 goals/i);
  });

  it('nudges "ask someone" only when a prior send has gone ≥30 days', () => {
    expect(
      needsAttention(
        base({ sentOverview: { q1: overview({ lastSentAt: iso(NOW - 40 * DAY) }) } }),
      ).some((i) => i.kind === 'send-questionnaire'),
    ).toBe(true);
    expect(
      needsAttention(
        base({ sentOverview: { q1: overview({ lastSentAt: iso(NOW - 5 * DAY) }) } }),
      ).some((i) => i.kind === 'send-questionnaire'),
    ).toBe(false);
    // Never when there are no other people to ask.
    expect(
      needsAttention(
        base({
          otherPeopleCount: 0,
          sentOverview: { q1: overview({ lastSentAt: iso(NOW - 40 * DAY) }) },
        }),
      ).some((i) => i.kind === 'send-questionnaire'),
    ).toBe(false);
  });

  it('suppresses the gentle NUDGES under crisis / proactivity-off, keeping genuinely-pending items (§8)', () => {
    const input = base({
      suppressNudges: true,
      togetherSessions: [session({ yourTurn: true })], // pending
      sentOverview: { q1: overview({ newResponses: 1, lastSentAt: iso(NOW - 40 * DAY) }) }, // pending + nudge
      goals: [goal({ id: 'g', due: '2026-06-01' })], // nudge
      resultsByTest: { phq9: [result(iso(NOW - 9 * DAY))] }, // nudge
    });
    const kinds = needsAttention(input).map((i) => i.kind);
    expect(kinds).toContain('together-turn');
    expect(kinds).toContain('analyze-responses');
    expect(kinds).not.toContain('stale-goals');
    expect(kinds).not.toContain('check-in');
    expect(kinds).not.toContain('send-questionnaire');
  });

  it('respects capability gates', () => {
    const input = base({
      can: {
        memory: false,
        tests: false,
        questionnaires: false,
        viewResults: false,
        together: false,
      },
      togetherSessions: [session({ yourTurn: true })],
      goals: [goal({ id: 'g', due: '2026-06-01' })],
      insightDraftCount: 2,
      resultsByTest: { phq9: [result(iso(NOW - 9 * DAY))] },
      sentOverview: { q1: overview({ newResponses: 1 }) },
    });
    expect(needsAttention(input)).toEqual([]);
  });
});

function iso(ms: number): string {
  // Deterministic ISO from an epoch offset (no Date.now() in the derivation itself).
  return new Date(ms).toISOString();
}

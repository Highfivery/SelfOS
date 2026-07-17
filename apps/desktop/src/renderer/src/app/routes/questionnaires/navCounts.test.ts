import { describe, expect, it } from 'vitest';
import type { InboxItem, QuestionnaireSentOverview } from '@shared/channels';
import { questionnaireNavCount, readyToAnalyzeCount, receivedToAnswerCount } from './navCounts';

function overview(over: Partial<QuestionnaireSentOverview>): QuestionnaireSentOverview {
  return {
    questionnaireId: 'q',
    lastSentAt: 'now',
    recipients: [],
    answeredCount: 0,
    newResponses: 0,
    analyzed: false,
    ...over,
  };
}

function item(over: Partial<InboxItem>): InboxItem {
  return {
    assignmentId: 'a',
    title: 't',
    type: 'general',
    questionCount: 1,
    status: 'sent',
    privacy: 'standard',
    senderName: 'Sam',
    createdAt: 'now',
    favorite: false,
    answerable: true,
    hasDraft: false,
    fromSelf: false,
    ...over,
  };
}

describe('readyToAnalyzeCount', () => {
  it('counts only sent questionnaires with a submitted response waiting to analyse', () => {
    const o = {
      q1: overview({ analyzableAssignmentId: 'a1' }), // ready
      q2: overview({ analyzed: true }), // already analysed → no
      q3: overview({}), // awaiting → no
      q4: overview({ analyzableAssignmentId: 'a4' }), // ready
    };
    expect(readyToAnalyzeCount(o)).toBe(2);
    expect(readyToAnalyzeCount({})).toBe(0);
  });
});

describe('receivedToAnswerCount', () => {
  it('counts answerable items NOT from yourself (a self check-in lives under Sent)', () => {
    const items = [
      item({ assignmentId: 'a1' }), // answerable, from someone else → yes
      item({ assignmentId: 'a2', answerable: false }), // already answered → no
      item({ assignmentId: 'a3', fromSelf: true }), // your own → no (it's under Sent)
      item({ assignmentId: 'a4' }), // yes
    ];
    expect(receivedToAnswerCount(items)).toBe(2);
    expect(receivedToAnswerCount([])).toBe(0);
  });
});

describe('questionnaireNavCount', () => {
  it('is the aggregate of ready-to-analyze + received-to-answer', () => {
    const o = { q1: overview({ analyzableAssignmentId: 'a1' }) };
    const items = [item({ assignmentId: 'r1' }), item({ assignmentId: 'r2', fromSelf: true })];
    expect(questionnaireNavCount(o, items)).toBe(2); // 1 analyze + 1 answer
    expect(questionnaireNavCount({}, [])).toBe(0);
  });
});

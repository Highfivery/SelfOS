import { describe, expect, it } from 'vitest';
import type { QuestionnaireSentOverview } from '@shared/channels';
import { questionnaireNavCount, readyToAnalyzeCount } from './navCounts';

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

describe('questionnaireNavCount', () => {
  it('counts ONLY responses ready to analyse — answering is the Inbox badge (§36.3)', () => {
    const o = {
      q1: overview({ analyzableAssignmentId: 'a1' }),
      q2: overview({ analyzed: true }),
    };
    expect(questionnaireNavCount(o)).toBe(1);
    expect(questionnaireNavCount({})).toBe(0);
  });
});

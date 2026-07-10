import { describe, expect, it } from 'vitest';
import { AssignmentStatusSchema, type AssignmentStatus, type SendResult } from '@shared/schemas';
import { groupSendsByStatus, summarizeSends } from './resultsSummary';

function send(id: string, status: AssignmentStatus): SendResult {
  return {
    assignmentId: id,
    recipientName: id,
    channel: 'inApp',
    relayLinked: false,
    status,
    privacy: 'standard',
    createdAt: 'now',
    analyzed: status === 'analyzed',
    analysisStale: false,
  };
}

describe('resultsSummary (08 §20.6)', () => {
  it('summarizes headline counts + a response rate over all sends', () => {
    const s = summarizeSends([
      send('a', 'submitted'),
      send('b', 'analyzed'),
      send('c', 'sent'),
      send('d', 'declined'),
    ]);
    expect(s).toMatchObject({ total: 4, answered: 2, awaiting: 1, inProgress: 0, declined: 1 });
    expect(s.responseRate).toBeCloseTo(0.5); // 2 answered of 4 sent
  });

  it('summary tiles mirror the card groups exactly (awaiting excludes inProgress, §20.6)', () => {
    const s = summarizeSends([send('a', 'sent'), send('b', 'inProgress')]);
    // The band's "awaiting" must match the "Awaiting" group (sent/opened), NOT fold in inProgress —
    // otherwise "2 awaiting" in the band would collide with "Awaiting (1)" + "In progress (1)" below.
    expect(s.awaiting).toBe(1);
    expect(s.inProgress).toBe(1);
  });

  it('every AssignmentStatus lands in exactly one group (the ?? closed fallback never silently drops)', () => {
    for (const status of AssignmentStatusSchema.options) {
      const groups = groupSendsByStatus([send('x', status)]);
      expect(groups).toHaveLength(1);
      expect(groups[0]?.sends).toHaveLength(1);
    }
  });

  it('response rate is 0 with no sends (no divide-by-zero)', () => {
    expect(summarizeSends([]).responseRate).toBe(0);
  });

  it('groups sends by status into ordered, non-empty groups', () => {
    const groups = groupSendsByStatus([
      send('a', 'sent'),
      send('b', 'submitted'),
      send('c', 'analyzed'),
      send('d', 'inProgress'),
      send('e', 'declined'),
      send('f', 'revoked'),
    ]);
    // Order follows RESULT_GROUPS: Answered · In progress · Awaiting · Declined · Closed.
    expect(groups.map((g) => g.key)).toEqual([
      'answered',
      'inProgress',
      'awaiting',
      'declined',
      'closed',
    ]);
    // Answered folds submitted + analyzed; awaiting folds sent (+ opened); closed folds revoked/expired.
    expect(groups[0]?.sends.map((s) => s.assignmentId)).toEqual(['b', 'c']);
    expect(groups[2]?.sends.map((s) => s.assignmentId)).toEqual(['a']);
    expect(groups[4]?.sends.map((s) => s.assignmentId)).toEqual(['f']);
  });

  it('omits empty groups', () => {
    const groups = groupSendsByStatus([send('a', 'submitted')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe('answered');
  });
});

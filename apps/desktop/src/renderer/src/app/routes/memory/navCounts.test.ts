import { describe, expect, it } from 'vitest';
import type { Insight, MergeProposal } from '@shared/schemas';
import { memoryReviewCount } from './navCounts';

const at = '2026-07-17T12:00:00.000Z';

function insight(id: string, approved: boolean, subjectPersonId = 'p1'): Insight {
  return {
    id,
    schemaVersion: 1,
    source: 'session',
    subjectPersonId,
    summary: 's',
    facts: [],
    confidence: 'medium',
    categories: [],
    approved,
    provenance: { at },
    createdAt: at,
    updatedAt: at,
  };
}

function proposal(id: string): MergeProposal {
  return {
    id,
    schemaVersion: 1,
    subjectPersonId: 'p1',
    fromId: 'a',
    intoId: 'b',
    fromSummary: 'a',
    intoSummary: 'b',
    createdAt: at,
  };
}

describe('memoryReviewCount', () => {
  it('counts the active person’s draft insights + merge proposals', () => {
    const insights = [insight('d1', false), insight('d2', false), insight('ok', true)];
    expect(memoryReviewCount(insights, [proposal('p')], 'p1')).toBe(3); // 2 drafts + 1 proposal
  });

  it('ignores another person’s drafts (own-only)', () => {
    const insights = [insight('mine', false, 'p1'), insight('theirs', false, 'p2')];
    expect(memoryReviewCount(insights, [], 'p1')).toBe(1);
  });

  it('is 0 with no drafts/proposals or no active person', () => {
    expect(memoryReviewCount([insight('ok', true)], [], 'p1')).toBe(0);
    expect(memoryReviewCount([insight('d', false)], [proposal('p')], null)).toBe(0);
  });
});

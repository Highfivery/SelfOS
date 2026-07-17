import type { Insight, MergeProposal } from '@shared/schemas';

/**
 * The count shown on the Memory sidebar badge (62 §nav) — things awaiting the person's review: their draft
 * (unapproved) own insights **plus** merge/duplicate proposals. Matches the total in the in-page "Needs
 * your review" callout (`Memory.tsx`), so the badge and the callout never disagree.
 */
export function memoryReviewCount(
  insights: Insight[],
  proposals: MergeProposal[],
  activePersonId: string | null,
): number {
  if (!activePersonId) return 0;
  const drafts = insights.filter((i) => i.subjectPersonId === activePersonId && !i.approved).length;
  return drafts + proposals.length;
}

import type { InboxItem, QuestionnaireSentOverview } from '@shared/channels';

/**
 * Nav-badge counts for the Questionnaires sidebar link (08 §3.1). The badge aggregates the two things that
 * need the SIGNED-IN person's action — never passive "waiting on them" — so it reads as a to-do count:
 *   • responses ready to analyze (a submitted-but-un-analysed send you can turn into an Insight)
 *   • questionnaires received (from someone else) that you still have to answer
 * Passive "awaiting their response" is deliberately excluded — there's nothing for you to do there.
 */

/** How many sent questionnaires have a submitted response waiting for you to analyse. */
export function readyToAnalyzeCount(overview: Record<string, QuestionnaireSentOverview>): number {
  return Object.values(overview).filter((o) => o.analyzableAssignmentId !== undefined).length;
}

/** How many received questionnaires (sent to you by someone else) you still have to answer. */
export function receivedToAnswerCount(items: InboxItem[]): number {
  return items.filter((i) => i.answerable && !i.fromSelf).length;
}

/** The single aggregate for the sidebar badge (§3.1): analyze-waiting + answer-waiting. */
export function questionnaireNavCount(
  overview: Record<string, QuestionnaireSentOverview>,
  items: InboxItem[],
): number {
  return readyToAnalyzeCount(overview) + receivedToAnswerCount(items);
}

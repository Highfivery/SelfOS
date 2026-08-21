import type { QuestionnaireSentOverview } from '@shared/channels';

/**
 * The nav-badge count for the Questionnaires sidebar link (08 §3.1 / §36.3). Each of the two nav badges owns
 * one side of the divide the redesign draws: the INBOX badge counts what other people are waiting on from you
 * (check-ins, invitations, books shared with you — everything in the queue), and this one counts YOUR OWN
 * work in Questionnaires. Answering used to be counted twice, once in each badge, which made the two numbers
 * describe overlapping things and neither of them a to-do list.
 *
 * So it is exactly one thing: responses that came back and are ready for you to analyse. Passive "awaiting
 * their response" is still deliberately excluded — there is nothing for you to do there.
 */

/** How many sent questionnaires have a submitted response waiting for you to analyse. */
export function readyToAnalyzeCount(overview: Record<string, QuestionnaireSentOverview>): number {
  return Object.values(overview).filter((o) => o.analyzableAssignmentId !== undefined).length;
}

/** The sidebar badge (§3.1): responses ready to analyse. Answering is counted by the Inbox badge (§36.3). */
export function questionnaireNavCount(overview: Record<string, QuestionnaireSentOverview>): number {
  return readyToAnalyzeCount(overview);
}

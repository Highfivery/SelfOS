import type { AssignmentStatus, SendResult } from '@shared/schemas';

/**
 * The sender's Results, reorganised (08-questionnaires §20.6): a summary band + per-recipient cards grouped
 * by status. Pure derivations over the already-loaded `SendResult[]`, so they're unit-testable and carry no
 * raw answers.
 */

/** Ordered status groups for the per-recipient cards. A send lands in the first group whose set holds its
 * status; anything unmatched (shouldn't happen) falls through to none and is appended by the caller. */
export const RESULT_GROUPS: { key: string; label: string; statuses: AssignmentStatus[] }[] = [
  { key: 'answered', label: 'Answered', statuses: ['submitted', 'analyzed'] },
  { key: 'inProgress', label: 'In progress', statuses: ['inProgress'] },
  { key: 'awaiting', label: 'Awaiting', statuses: ['sent', 'opened'] },
  { key: 'declined', label: 'Declined', statuses: ['declined'] },
  { key: 'closed', label: 'Closed', statuses: ['expired', 'revoked', 'draft'] },
];

const groupKeyOf = (status: AssignmentStatus): string =>
  RESULT_GROUPS.find((g) => g.statuses.includes(status))?.key ?? 'closed';

/** Group sends by status into the ordered `RESULT_GROUPS`, dropping empty groups; order within a group is
 * preserved from the input (the store already orders sends). */
export function groupSendsByStatus(
  results: SendResult[],
): { key: string; label: string; sends: SendResult[] }[] {
  return RESULT_GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    sends: results.filter((r) => groupKeyOf(r.status) === g.key),
  })).filter((g) => g.sends.length > 0);
}

/** A send counts as answered once submitted (whether or not it's been analysed yet). */
export function isAnsweredStatus(status: AssignmentStatus): boolean {
  return status === 'submitted' || status === 'analyzed';
}

export interface ResultsSummary {
  total: number;
  answered: number;
  // The summary tiles mirror the card groups exactly (§20.6) so a count never reads differently in the band
  // than under its heading: `awaiting` = the "Awaiting" group (sent / opened), `inProgress` = the "In
  // progress" group. Keeping them separate avoids the awaiting-vs-Awaiting collision.
  awaiting: number;
  inProgress: number;
  declined: number;
  /** answered / total, 0..1 (0 when there are no sends). Rounded to a percent by the view. */
  responseRate: number;
}

/** Headline counts across all of a questionnaire's sends, for the Results summary band. */
export function summarizeSends(results: SendResult[]): ResultsSummary {
  const total = results.length;
  const answered = results.filter((r) => isAnsweredStatus(r.status)).length;
  const awaiting = results.filter((r) => r.status === 'sent' || r.status === 'opened').length;
  const inProgress = results.filter((r) => r.status === 'inProgress').length;
  const declined = results.filter((r) => r.status === 'declined').length;
  return {
    total,
    answered,
    awaiting,
    inProgress,
    declined,
    responseRate: total === 0 ? 0 : answered / total,
  };
}

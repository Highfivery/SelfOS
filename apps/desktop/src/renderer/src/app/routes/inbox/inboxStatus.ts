import type { InboxItem } from '@shared/channels';

/**
 * A short status chip for a received questionnaire (08-questionnaires §3.3), shared by the Inbox route and
 * the Questionnaires landing "Received" section so the two never drift. `isNew` flags an unstarted, still-
 * open item (the accented "New" state).
 */
export function receivedStatus(item: InboxItem): { label: string; isNew: boolean } {
  if (item.status === 'submitted' || item.status === 'analyzed') {
    return { label: 'Submitted', isNew: false };
  }
  if (item.status === 'declined') return { label: 'Declined', isNew: false };
  if (!item.answerable) return { label: 'Closed', isNew: false };
  if (item.hasDraft) return { label: 'In progress', isNew: false };
  return { label: 'New', isNew: true };
}

/** The recipient's call-to-action verb for a received item, matched to its state. */
export function receivedCta(item: InboxItem): string {
  if (item.status === 'submitted' || item.status === 'analyzed') return 'View';
  if (item.hasDraft) return 'Continue';
  return 'Answer';
}

import type { SessionStatus } from '@shared/schemas';

/** Display metadata for each session lifecycle status (09 §14.1). Order = filter/menu order. */
export const SESSION_STATUSES: SessionStatus[] = ['inProgress', 'onHold', 'complete'];

export const SESSION_STATUS_LABEL: Record<SessionStatus, string> = {
  inProgress: 'In progress',
  onHold: 'On hold',
  complete: 'Complete',
};

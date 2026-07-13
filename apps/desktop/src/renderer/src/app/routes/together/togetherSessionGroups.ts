import type { TogetherSessionSummary } from '@shared/schemas';

/**
 * Grouping for the "Your sessions" board (58 §3.2), ordered by what needs the viewer's attention first:
 *   - yourTurn        — an active session where it's your move (you owe a reply)
 *   - openInvitation  — someone invited YOU (you accept/decline)
 *   - waiting         — an active session where it's your partner's move
 *   - invitedByYou    — an invitation you sent, still pending (or expired) — withdrawable
 *   - wrappedUp       — complete / ended / on-hold / an expired invite you received (collapsed by default)
 * A `declined` session never reaches the list (the bridge omits the decliner's, §3.5), so there's no group.
 */
export type TogetherGroupKey =
  | 'yourTurn'
  | 'openInvitation'
  | 'waiting'
  | 'invitedByYou'
  | 'wrappedUp';

export interface TogetherSessionGroup {
  key: TogetherGroupKey;
  sessions: TogetherSessionSummary[];
}

const ORDER: TogetherGroupKey[] = [
  'yourTurn',
  'openInvitation',
  'waiting',
  'invitedByYou',
  'wrappedUp',
];

export function groupKeyFor(
  session: TogetherSessionSummary,
  myId: string | null,
): TogetherGroupKey {
  const iInitiated = session.initiatorPersonId === myId;
  switch (session.status) {
    case 'active':
      return session.yourTurn ? 'yourTurn' : 'waiting';
    case 'invited':
      return iInitiated ? 'invitedByYou' : 'openInvitation';
    case 'expired':
      // An expired invite you SENT stays actionable (withdraw / re-send); one you received is just past.
      return iInitiated ? 'invitedByYou' : 'wrappedUp';
    case 'onHold':
    case 'ended':
    case 'complete':
    case 'declined':
      return 'wrappedUp';
  }
}

/** Bucket the viewer's sessions into ordered, non-empty groups (each preserving input order). */
export function groupTogetherSessions(
  sessions: TogetherSessionSummary[],
  myId: string | null,
): TogetherSessionGroup[] {
  const byKey = new Map<TogetherGroupKey, TogetherSessionSummary[]>();
  for (const session of sessions) {
    const key = groupKeyFor(session, myId);
    const list = byKey.get(key);
    if (list) list.push(session);
    else byKey.set(key, [session]);
  }
  return ORDER.filter((key) => byKey.has(key)).map((key) => ({
    key,
    sessions: byKey.get(key)!,
  }));
}

/** The group heading — names the partner where it clarifies whose move it is (single-partner board). */
export function groupTitle(key: TogetherGroupKey, partnerName: string): string {
  switch (key) {
    case 'yourTurn':
      return 'Your turn';
    case 'openInvitation':
      return 'Open invitation';
    case 'waiting':
      return `Waiting on ${partnerName}`;
    case 'invitedByYou':
      return 'Invitations you sent';
    case 'wrappedUp':
      return 'Wrapped up';
  }
}

import { describe, expect, it } from 'vitest';
import type { TogetherSessionSummary } from '@shared/schemas';
import { groupKeyFor, groupTitle, groupTogetherSessions } from './togetherSessionGroups';

const ME = 'me';

function s(over: Partial<TogetherSessionSummary>): TogetherSessionSummary {
  return {
    id: 's',
    pairKey: 'me~p',
    initiatorPersonId: ME,
    participants: [
      { personId: ME, displayName: 'Me' },
      { personId: 'p', displayName: 'Angel' },
    ],
    status: 'active',
    yourTurn: false,
    unreadCount: 0,
    createdAt: 'now',
    ...over,
  };
}

describe('togetherSessionGroups', () => {
  it('buckets each session by whose move it is', () => {
    expect(groupKeyFor(s({ status: 'active', yourTurn: true }), ME)).toBe('yourTurn');
    expect(groupKeyFor(s({ status: 'active', yourTurn: false }), ME)).toBe('waiting');
    expect(groupKeyFor(s({ status: 'invited', initiatorPersonId: 'p' }), ME)).toBe(
      'openInvitation',
    );
    expect(groupKeyFor(s({ status: 'invited', initiatorPersonId: ME }), ME)).toBe('invitedByYou');
    // An expired invite you SENT stays actionable; one you received is just past.
    expect(groupKeyFor(s({ status: 'expired', initiatorPersonId: ME }), ME)).toBe('invitedByYou');
    expect(groupKeyFor(s({ status: 'expired', initiatorPersonId: 'p' }), ME)).toBe('wrappedUp');
    expect(groupKeyFor(s({ status: 'complete' }), ME)).toBe('wrappedUp');
    expect(groupKeyFor(s({ status: 'onHold' }), ME)).toBe('wrappedUp');
    expect(groupKeyFor(s({ status: 'ended' }), ME)).toBe('wrappedUp');
  });

  it('returns only non-empty groups, in priority order (what needs you first)', () => {
    const groups = groupTogetherSessions(
      [
        s({ id: 'a', status: 'complete' }),
        s({ id: 'b', status: 'active', yourTurn: true }),
        s({ id: 'c', status: 'invited', initiatorPersonId: 'p' }),
        s({ id: 'd', status: 'active', yourTurn: false }),
        s({ id: 'e', status: 'invited', initiatorPersonId: ME }),
      ],
      ME,
    );
    expect(groups.map((g) => g.key)).toEqual([
      'yourTurn',
      'openInvitation',
      'waiting',
      'invitedByYou',
      'wrappedUp',
    ]);
    expect(groups[0]!.sessions.map((x) => x.id)).toEqual(['b']);
  });

  it('names the partner where it clarifies whose move it is', () => {
    expect(groupTitle('waiting', 'Angel')).toBe('Waiting on Angel');
    expect(groupTitle('yourTurn', 'Angel')).toBe('Your turn');
    expect(groupTitle('invitedByYou', 'Angel')).toBe('Invitations you sent');
  });
});

import { describe, expect, it } from 'vitest';
import type { TogetherSessionSummary } from '@shared/schemas';
import { togetherNotificationCandidates } from './notifications';
import { togetherWaitingCount } from '../../../stores/togetherStore';

const ME = 'me';
const PARTNER = 'partner';

function summary(over: Partial<TogetherSessionSummary>): TogetherSessionSummary {
  return {
    id: 's1',
    pairKey: 'me~partner',
    initiatorPersonId: ME,
    participants: [
      { personId: ME, displayName: 'Ben' },
      { personId: PARTNER, displayName: 'Angel' },
    ],
    status: 'active',
    yourTurn: false,
    unreadCount: 0,
    createdAt: '2026-07-10T00:00:00.000Z',
    ...over,
  };
}

describe('togetherNotificationCandidates (§3.11)', () => {
  it('fires together-invite for a session you were invited to (not the initiator)', () => {
    const out = togetherNotificationCandidates(
      [summary({ status: 'invited', initiatorPersonId: PARTNER })],
      ME,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: 'together-invite',
      coalesceKey: 'together-invite:s1',
      signature: 's1',
      title: 'Angel invited you to a Together session',
      action: { type: 'navigate', to: '/together/session/s1' },
    });
  });

  it('does NOT fire an invite for the INITIATOR (they started it — §3.5 they only see invited/waiting)', () => {
    expect(
      togetherNotificationCandidates([summary({ status: 'invited', initiatorPersonId: ME })], ME),
    ).toHaveLength(0);
  });

  it('fires together-turn for an active your-turn session, signed by the latest message time', () => {
    const out = togetherNotificationCandidates(
      [
        summary({
          status: 'active',
          yourTurn: true,
          topic: 'Us',
          lastMessageAt: '2026-07-11T00:00:00.000Z',
        }),
      ],
      ME,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: 'together-turn',
      coalesceKey: 'together-turn:s1',
      signature: '2026-07-11T00:00:00.000Z',
      title: 'Your turn with Angel — “Us”',
    });
  });

  it('carries names/topic, never message content (§3.11) — no snippet leaks', () => {
    const out = togetherNotificationCandidates(
      [summary({ status: 'active', yourTurn: true, lastMessageSnippet: 'a private thing I said' })],
      ME,
    );
    expect(JSON.stringify(out)).not.toContain('a private thing I said');
  });

  it('is silent for a not-your-turn / ended / complete session', () => {
    expect(
      togetherNotificationCandidates([summary({ status: 'active', yourTurn: false })], ME),
    ).toEqual([]);
    expect(togetherNotificationCandidates([summary({ status: 'ended' })], ME)).toEqual([]);
    expect(togetherNotificationCandidates([summary({ status: 'complete' })], ME)).toEqual([]);
  });

  it('fires together-private when the coach left a private note, signed by the note ts, no content (§3.14 Part B)', () => {
    const out = togetherNotificationCandidates(
      [
        summary({
          status: 'active',
          yourTurn: false, // a note is independent of turn state
          topic: 'Us',
          lastPrivateCoachAt: '2026-07-12T00:00:00.000Z',
          lastMessageSnippet: 'the private note text',
        }),
      ],
      ME,
    );
    const priv = out.find((c) => c.kind === 'together-private');
    expect(priv).toMatchObject({
      kind: 'together-private',
      coalesceKey: 'together-private:s1',
      signature: '2026-07-12T00:00:00.000Z',
      title: 'The coach has a private note for you — “Us”',
      action: { type: 'navigate', to: '/together/session/s1' },
    });
    // Never carries the note's text.
    expect(JSON.stringify(out)).not.toContain('the private note text');
  });
});

describe('togetherWaitingCount (§3.1 nav badge)', () => {
  it('counts invitations RECEIVED + your-turn sessions, NOT your own outgoing invites', () => {
    const sessions = [
      summary({ id: 's1', status: 'invited', initiatorPersonId: PARTNER }), // received → counts
      summary({ id: 's2', status: 'invited', initiatorPersonId: ME }), // my own outgoing → does NOT count
      summary({ id: 's3', status: 'active', yourTurn: true }), // your turn → counts
      summary({ id: 's4', status: 'active', yourTurn: false }), // not your turn → no
      summary({ id: 's5', status: 'complete' }), // done → no
    ];
    expect(togetherWaitingCount(sessions, ME)).toBe(2);
  });
});

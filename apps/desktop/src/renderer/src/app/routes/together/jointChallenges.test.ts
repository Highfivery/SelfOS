import { describe, expect, it } from 'vitest';
import type { Challenge, JointChallengeStatus } from '@shared/schemas';
import {
  closedOutcomeLabel,
  isTwinCheckedIn,
  jointStateLine,
  ownTwin,
  partnerCheckedIn,
  splitJointChallenges,
} from './jointChallenges';

const twin = (over: Partial<Challenge> = {}): Challenge =>
  ({
    id: 'ch1',
    schemaVersion: 1,
    subjectPersonId: 'me',
    action: 'Share one appreciation a day',
    status: 'active',
    comfort: 3,
    provenance: { conversationId: 's1', at: '2026-07-01T00:00:00.000Z' },
    groupId: 'g1',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...over,
  }) as Challenge;

const status = (over: Partial<JointChallengeStatus> = {}): JointChallengeStatus => ({
  groupId: 'g1',
  action: 'Share one appreciation a day',
  memberCount: 2,
  checkedInCount: 0,
  allCheckedIn: false,
  active: true,
  updatedAt: '2026-07-01T00:00:00.000Z',
  ...over,
});

describe('isTwinCheckedIn', () => {
  it('counts an outcome or a done status, and nothing else', () => {
    expect(isTwinCheckedIn(undefined)).toBe(false);
    expect(isTwinCheckedIn(twin())).toBe(false);
    expect(isTwinCheckedIn(twin({ outcome: 'didnt' }))).toBe(true);
    expect(isTwinCheckedIn(twin({ status: 'done' }))).toBe(true);
  });
});

describe('ownTwin', () => {
  it('matches by groupId and ignores unrelated challenges', () => {
    const mine = twin({ id: 'a' });
    const other = twin({ id: 'b', groupId: 'g2' });
    const solo = twin({ id: 'c', groupId: undefined });
    expect(ownTwin([other, solo, mine], 'g1')?.id).toBe('a');
    expect(ownTwin([other, solo], 'g1')).toBeUndefined();
  });

  it('takes the NEWEST twin when a re-mint left two records under one group', () => {
    // The 52 dedup only reuses an `active` record, so checking in then re-minting leaves a stale pair.
    const stale = twin({ id: 'old', status: 'done', updatedAt: '2026-07-01T00:00:00.000Z' });
    const fresh = twin({ id: 'new', updatedAt: '2026-07-09T00:00:00.000Z' });
    expect(ownTwin([stale, fresh], 'g1')?.id).toBe('new');
    expect(ownTwin([fresh, stale], 'g1')?.id).toBe('new');
  });
});

describe('partnerCheckedIn', () => {
  it('derives the partner’s state from the count without reading their record', () => {
    expect(partnerCheckedIn(status({ checkedInCount: 0 }), false)).toBe(false);
    expect(partnerCheckedIn(status({ checkedInCount: 1 }), false)).toBe(true);
    // The single check-in is the viewer's own — so the partner has NOT checked in.
    expect(partnerCheckedIn(status({ checkedInCount: 1 }), true)).toBe(false);
    expect(partnerCheckedIn(status({ checkedInCount: 2 }), true)).toBe(true);
  });
});

describe('jointStateLine', () => {
  it('names whose turn it is for a two-person pair', () => {
    expect(jointStateLine(status(), false, 'Angel')).toBe('Neither of you has checked in yet');
    expect(jointStateLine(status({ checkedInCount: 1 }), false, 'Angel')).toBe(
      'Angel checked in · your turn',
    );
    expect(jointStateLine(status({ checkedInCount: 1 }), true, 'Angel')).toBe(
      'You’ve checked in · waiting on Angel',
    );
    expect(jointStateLine(status({ checkedInCount: 2, allCheckedIn: true }), true, 'Angel')).toBe(
      'You both did it',
    );
  });

  it('falls back to counts beyond two people, where naming one partner would be wrong', () => {
    expect(jointStateLine(status({ memberCount: 3, checkedInCount: 2 }), true, 'Angel')).toBe(
      '2 of 3 checked in',
    );
    expect(jointStateLine(status({ memberCount: 3 }), false, 'Angel')).toBe('No check-ins yet');
  });

  // Guessing "not me" while the per-person store is still loading would credit the viewer's OWN
  // follow-through to their partner — false copy, the content-correctness failure class.
  it('stays neutral while the viewer’s own state is unknown, never crediting it to the partner', () => {
    expect(jointStateLine(status({ checkedInCount: 1 }), null, 'Angel')).toBe('1 of 2 checked in');
    expect(jointStateLine(status(), null, 'Angel')).toBe('No check-ins yet');
    // Once known, it resolves to the named line.
    expect(jointStateLine(status({ checkedInCount: 1 }), true, 'Angel')).toBe(
      'You’ve checked in · waiting on Angel',
    );
  });
});

describe('splitJointChallenges', () => {
  it('keeps a finished joint challenge instead of dropping it', () => {
    const live = status({ groupId: 'live' });
    const done = status({ groupId: 'done', active: false, allCheckedIn: true, checkedInCount: 2 });
    // Still active but not everyone has checked in → the pair is mid-flight, so it stays open.
    const halfway = status({ groupId: 'half', active: true, checkedInCount: 1 });
    const { open, closed } = splitJointChallenges([live, done, halfway]);
    expect(open.map((o) => o.groupId)).toEqual(['live', 'half']);
    expect(closed.map((c) => c.groupId)).toEqual(['done']);
  });

  // The regression the "Let it go" action makes reachable: both twins abandoned is
  // `active:false, allCheckedIn:false`. Keying on `!allCheckedIn` stranded it in `open` forever with
  // no live twin — so no buttons, and no way to clear it.
  it('closes a LET-GO pair rather than stranding it in the open list', () => {
    const letGo = status({
      groupId: 'gone',
      active: false,
      allCheckedIn: false,
      checkedInCount: 0,
    });
    const { open, closed } = splitJointChallenges([letGo]);
    expect(open).toEqual([]);
    expect(closed.map((c) => c.groupId)).toEqual(['gone']);
  });
});

describe('closedOutcomeLabel', () => {
  it('distinguishes following through from letting it go', () => {
    expect(closedOutcomeLabel(status({ allCheckedIn: true }))).toBe('You both did it');
    expect(closedOutcomeLabel(status({ allCheckedIn: false }))).toBe('Let go');
  });
});

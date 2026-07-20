import type { Challenge, JointChallengeStatus } from '@shared/schemas';

/**
 * Pure joins/derivations behind the Together joint-challenge tile (58 §5.6, amended 2026-07-20).
 *
 * The tile shows an ACTIONABLE row per joint challenge, but `JointChallengeStatus` is deliberately a pure
 * cross-partner AGGREGATE — it carries counts, never a twin id and never a partner's reflection text. So the
 * viewer's own twin is matched HERE, client-side, against their own per-person `challengeStore`, and the
 * partner's state is DERIVED from the count. That keeps the §8 boundary by construction: the aggregate comes
 * from the gated bridge read, the viewer's record from their own store, and a partner's `reflection`/`outcome`
 * never reaches the renderer at all — only a number ever crosses.
 */

/** A twin counts as checked in once it carries an outcome or is done — mirrors core `isCheckedIn` (§5.6). */
export function isTwinCheckedIn(twin: Challenge | undefined): boolean {
  if (!twin) return false;
  return twin.outcome !== undefined || twin.status === 'done';
}

/**
 * The viewer's OWN twin for a group. A re-mint after the person already checked in can leave TWO records under
 * one `groupId` (the 52 dedup only reuses an `active` one), so take the NEWEST — the same collapse
 * `listJointChallenges` does server-side, or the tile would act on a stale twin.
 */
export function ownTwin(challenges: Challenge[], groupId: string): Challenge | undefined {
  let newest: Challenge | undefined;
  for (const c of challenges) {
    if (c.groupId !== groupId) continue;
    if (!newest || c.updatedAt > newest.updatedAt) newest = c;
  }
  return newest;
}

/** Whether a partner (anyone who isn't the viewer) has checked in — derived, never read from their record. */
export function partnerCheckedIn(status: JointChallengeStatus, mine: boolean): boolean {
  return status.checkedInCount - (mine ? 1 : 0) > 0;
}

/**
 * The named state line (§5.6) — who the ball is with, replacing the neutral "N of M checked in". Falls back to
 * counts when the pair is larger than two (naming one partner would be wrong) and when the viewer's own twin
 * isn't known yet: `mine: null` means the per-person store hasn't loaded, and guessing `false` there would
 * credit the viewer's OWN follow-through to their partner ("Angel checked in · your turn"). Stay neutral
 * under uncertainty rather than print something false.
 */
export function jointStateLine(
  status: JointChallengeStatus,
  mine: boolean | null,
  partnerName: string,
): string {
  if (status.allCheckedIn) return 'You both did it';
  if (status.memberCount > 2 || mine === null) {
    return status.checkedInCount > 0
      ? `${status.checkedInCount} of ${status.memberCount} checked in`
      : 'No check-ins yet';
  }
  if (mine) return `You’ve checked in · waiting on ${partnerName}`;
  if (partnerCheckedIn(status, mine)) return `${partnerName} checked in · your turn`;
  return 'Neither of you has checked in yet';
}

/**
 * Split the pair's groups into the LIVE ones and the closed ones.
 *
 * "Closed" is keyed on `active` ALONE, not on everyone having checked in. A pair who let a challenge go (both
 * twins `abandoned`) is `active: false, allCheckedIn: false` — keying on `!allCheckedIn` would strand that row
 * in `open` forever, un-actionable (no live twin ⇒ no buttons) and with no way to clear it. A closed row is
 * kept in a collapsed group rather than dropping off — the shared record of what the pair actually did (the 39
 * Goals "Completed & closed" precedent) — and reports its own outcome, since "closed" covers both endings.
 */
export function splitJointChallenges(items: JointChallengeStatus[]): {
  open: JointChallengeStatus[];
  closed: JointChallengeStatus[];
} {
  const open: JointChallengeStatus[] = [];
  const closed: JointChallengeStatus[] = [];
  for (const i of items) (i.active ? open : closed).push(i);
  return { open, closed };
}

/** How a closed joint challenge ended — both followed through, or the pair let it go. */
export function closedOutcomeLabel(status: JointChallengeStatus): string {
  return status.allCheckedIn ? 'You both did it' : 'Let go';
}

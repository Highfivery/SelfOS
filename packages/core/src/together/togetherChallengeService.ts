import type { FileSystem } from '../host';
import { uuid } from '../id';
import type { Challenge, JointChallengeStatus } from '../schemas';
import { captureFromMarker, listChallenges } from '../challenges/challengeService';
import type { ChallengeMarker } from '../conversations/guidedSteps';

export type { JointChallengeStatus };

// ── Joint (couples) challenges (58 §5.6) — the couples coach mints ONE stretch action for BOTH partners as
// twin `Challenge` records linked by a shared `groupId`. Each partner keeps their OWN check-in cadence, Home
// card, and reflection (the 52 per-person machinery, unchanged); "both checked in" is surfaced in the next
// session's grounding pack + the Together home strip. Twins are per-person files (people/<id>/challenges/…),
// so per-person isolation holds; the `groupId` is the only cross-link.

/**
 * Mint (or refine) a JOINT challenge from a couples-coach marker — a twin for every participant, sharing one
 * `groupId`. Re-minting in the same session UPDATES the existing twins (the 52 one-active-per-conversation
 * dedup, reused per participant), so a second marker never spawns a competing group. Returns the twins.
 */
export async function captureJointChallengeFromMarker(
  fs: FileSystem,
  key: Uint8Array,
  participantIds: string[],
  marker: ChallengeMarker,
  sessionId: string,
  now: Date,
): Promise<Challenge[]> {
  const ids = [...new Set(participantIds)];
  if (ids.length < 2 || !marker.action.trim()) return [];
  // Reuse an existing group for THIS session (so a re-mint updates the twins, keeping the groupId stable).
  let groupId: string | undefined;
  for (const pid of ids) {
    const twin = (await listChallenges(fs, key, pid)).find(
      (c) => c.conversationId === sessionId && c.groupId && c.status === 'active',
    );
    if (twin?.groupId) {
      groupId = twin.groupId;
      break;
    }
  }
  const gid = groupId ?? uuid();
  const out: Challenge[] = [];
  for (const pid of ids) {
    const c = await captureFromMarker({
      fs,
      key,
      personId: pid,
      conversationId: sessionId,
      marker,
      now,
      groupId: gid,
    });
    if (c) out.push(c);
  }
  return out;
}

const isCheckedIn = (c: Challenge): boolean => c.outcome !== undefined || c.status === 'done';

/**
 * The pair's joint challenges (§5.6), derived from the participants' twin records grouped by `groupId`. Only
 * groups whose twin appears for ≥2 of the pair's members count (a real joint challenge). Newest first.
 */
export async function listJointChallenges(
  fs: FileSystem,
  key: Uint8Array,
  participantIds: string[],
): Promise<JointChallengeStatus[]> {
  const ids = [...new Set(participantIds)];
  const byGroup = new Map<string, Challenge[]>();
  for (const pid of ids) {
    for (const c of await listChallenges(fs, key, pid)) {
      if (!c.groupId) continue;
      const arr = byGroup.get(c.groupId) ?? [];
      arr.push(c);
      byGroup.set(c.groupId, arr);
    }
  }
  const out: JointChallengeStatus[] = [];
  for (const [groupId, records] of byGroup) {
    // ONE twin per person: a re-mint after a person checked in (their record went `done`) can leave TWO
    // records for that person under the same group (the dedup only reuses an `active` one). Collapse to the
    // NEWEST record per subject so `memberCount`/`checkedInCount` reflect PEOPLE, not records.
    const perPerson = new Map<string, Challenge>();
    for (const c of records) {
      const prior = perPerson.get(c.subjectPersonId);
      if (!prior || c.updatedAt > prior.updatedAt) perPerson.set(c.subjectPersonId, c);
    }
    const twins = [...perPerson.values()];
    if (twins.length < 2) continue; // not a real cross-partner joint challenge
    const checkedInCount = twins.filter(isCheckedIn).length;
    out.push({
      groupId,
      action: twins[0]!.action,
      memberCount: twins.length,
      checkedInCount,
      allCheckedIn: checkedInCount === twins.length,
      active: twins.some((c) => c.status === 'active'),
      updatedAt:
        twins
          .map((c) => c.updatedAt)
          .sort()
          .at(-1) ?? twins[0]!.updatedAt,
    });
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * A grounding-pack line describing where the pair's OPEN joint challenges stand (§5.6). Empty when none.
 *
 * Keyed on `active` alone: a pair who LET A CHALLENGE GO leaves every twin `abandoned`, which is
 * `active: false, allCheckedIn: false` — the old `active || !allCheckedIn` test kept grounding the coach on it
 * as a live commitment forever. Only a still-live challenge belongs in the pack.
 */
export function jointChallengeGroundingLines(statuses: JointChallengeStatus[]): string[] {
  return statuses
    .filter((s) => s.active)
    .map((s) => {
      const where = s.allCheckedIn
        ? 'both of you have checked in'
        : s.checkedInCount > 0
          ? `${s.checkedInCount} of ${s.memberCount} of you have checked in`
          : 'neither of you has checked in yet';
      return `A joint challenge you both took on: "${s.action}" — ${where}.`;
    });
}

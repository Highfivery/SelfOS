import type { TogetherSessionSummary } from '../schemas';

// ── Together Home presence (58 §3.12) — a PURE helper deriving the one Home "For you" nudge from the
// viewer's session summaries. No AI, no I/O: the renderer already holds the projected summaries (the
// bridge only returns them when a live partner edge exists), so the provider stays unit-testable + portable.

/** The §11 "quiet couple" window — >14 days since the last completed session is a gentle re-engage nudge. */
export const TOGETHER_QUIET_DAYS = 14;

/** The single Home nudge for Together, if any (priority: a pending invite → your turn → a quiet pair). */
export interface TogetherHomeNudge {
  kind: 'invite' | 'turn' | 'quiet';
  /** The session to deep-link to (absent for `quiet` — that routes to the Together home). */
  sessionId?: string;
  /** The pair this nudge concerns — the stable dismissal identity (a display name can collide/change). */
  pairKey: string;
  /** The other participant's display name, for the relational copy. */
  partnerName: string;
  /** The signal stamp that makes the dismissal re-surface when the situation advances (§3.12). */
  stamp: string;
}

function partnerNameOf(summary: TogetherSessionSummary, viewerId: string): string {
  return summary.participants.find((p) => p.personId !== viewerId)?.displayName ?? 'your partner';
}

function mostRecent(summaries: TogetherSessionSummary[]): TogetherSessionSummary | undefined {
  return [...summaries].sort((a, b) =>
    (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt),
  )[0];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Derive the Together Home nudge (§3.12) — capability + live-edge gating is the caller's (the provider's
 * `capabilityGate` + the fact that summaries only exist with an edge). Priority: a pending invitation the
 * viewer must answer → an active session where it's the viewer's turn → a pair gone quiet >14 days since
 * their last completed session. Returns `null` when nothing is worth surfacing.
 */
export function computeTogetherHomeNudge(
  summaries: TogetherSessionSummary[],
  viewerId: string,
  now: Date,
): TogetherHomeNudge | null {
  // 1. A pending invitation the viewer was SENT (they are not the initiator) → the highest-value nudge.
  const invite = mostRecent(
    summaries.filter((s) => s.status === 'invited' && s.initiatorPersonId !== viewerId),
  );
  if (invite) {
    return {
      kind: 'invite',
      sessionId: invite.id,
      pairKey: invite.pairKey,
      partnerName: partnerNameOf(invite, viewerId),
      stamp: invite.createdAt,
    };
  }

  // 2. An active session where it's the viewer's turn to reply.
  const turn = mostRecent(summaries.filter((s) => s.status === 'active' && s.yourTurn));
  if (turn) {
    return {
      kind: 'turn',
      sessionId: turn.id,
      pairKey: turn.pairKey,
      partnerName: partnerNameOf(turn, viewerId),
      stamp: turn.lastMessageAt ?? turn.createdAt,
    };
  }

  // 3. A pair that has worked together before but has gone quiet >14 days (the §11 re-engage figure).
  // A pair with ANY in-flight session (invited/active/onHold) is NOT quiet — nudging "it's been a while"
  // mid-session (e.g. an active session waiting on the partner) would contradict the current state (§7).
  const inFlightPairs = new Set(
    summaries
      .filter((s) => s.status === 'invited' || s.status === 'active' || s.status === 'onHold')
      .map((s) => s.pairKey),
  );
  const lastCompleted = mostRecent(
    summaries.filter(
      (s) => (s.status === 'complete' || s.status === 'ended') && !inFlightPairs.has(s.pairKey),
    ),
  );
  if (lastCompleted) {
    const at = lastCompleted.lastMessageAt ?? lastCompleted.createdAt;
    const quietDays = (now.getTime() - Date.parse(at)) / DAY_MS;
    if (Number.isFinite(quietDays) && quietDays > TOGETHER_QUIET_DAYS) {
      return {
        kind: 'quiet',
        pairKey: lastCompleted.pairKey,
        partnerName: partnerNameOf(lastCompleted, viewerId),
        stamp: at,
      };
    }
  }

  return null;
}

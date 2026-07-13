import type { TogetherSessionSummary } from '@shared/schemas';
import type { NotificationCandidate } from '../../notifications/notificationKinds';

/**
 * The Together notification candidates (58 §3.11), derived over the viewer's projection (the summaries are
 * already projection-computed in the bridge). Carry names/topic, NEVER message content. `together-invite`
 * fires for a session you were invited to (not the initiator); `together-turn` for an active your-turn
 * session, coalesced per session, its signature the latest message time so it re-surfaces `onChange` — an
 * aside never changes the partner's summary, so it never re-pops here. `together-private` (§3.14 Part B) fires
 * when the coach has left a private note just for this viewer; its signature is the note's ts (a new private
 * note re-surfaces `onChange`), and it never carries the note's text. Pure → unit-tested without a DOM.
 */
export function togetherNotificationCandidates(
  sessions: TogetherSessionSummary[],
  myId: string | null,
): NotificationCandidate[] {
  const out: NotificationCandidate[] = [];
  for (const session of sessions) {
    const other = session.participants.find((p) => p.personId !== myId);
    const withName = other?.displayName ?? 'your partner';
    if (session.status === 'invited' && session.initiatorPersonId !== myId) {
      out.push({
        kind: 'together-invite',
        coalesceKey: `together-invite:${session.id}`,
        signature: session.id, // a fresh invite (a new session id) re-surfaces
        title: `${withName} invited you to a Together session`,
        action: { type: 'navigate', to: `/together/session/${session.id}` },
      });
    }
    if (session.status === 'active' && session.yourTurn) {
      out.push({
        kind: 'together-turn',
        coalesceKey: `together-turn:${session.id}`,
        signature: session.lastMessageAt ?? session.createdAt,
        title: session.topic
          ? `Your turn with ${withName} — “${session.topic}”`
          : `Your turn with ${withName}`,
        action: { type: 'navigate', to: `/together/session/${session.id}` },
      });
    }
    // A private coach note just for this viewer (§3.14 Part B) — never carries the note's text; a new note
    // re-surfaces `onChange` via its ts. Independent of `yourTurn` (a note is not a turn).
    if (session.lastPrivateCoachAt) {
      out.push({
        kind: 'together-private',
        coalesceKey: `together-private:${session.id}`,
        signature: session.lastPrivateCoachAt,
        title: session.topic
          ? `The coach has a private note for you — “${session.topic}”`
          : `The coach has a private note for you`,
        action: { type: 'navigate', to: `/together/session/${session.id}` },
      });
    }
  }
  return out;
}

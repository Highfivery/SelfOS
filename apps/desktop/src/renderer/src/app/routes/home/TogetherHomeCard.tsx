import { useNavigate } from 'react-router-dom';
import { Heart } from 'lucide-react';
import type { TogetherSessionSummary } from '@shared/schemas';
import { Button, Card, Heading, Stack, Text } from '../../../design-system/components';
import styles from './Home.module.css';

/** The other participant's display name for a session (the viewer excluded). */
function partnerName(session: TogetherSessionSummary, myId: string | null): string {
  return session.participants.find((p) => p.personId !== myId)?.displayName ?? 'your partner';
}

/** A snippet is raw model text (markdown) — strip emphasis/heading/quote markers for a clean one-line preview. */
function plain(text: string): string {
  return text
    .replace(/[*_~`]/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Pick the one session to feature: your-turn first, then a pending invite, then most recently active. */
function primarySession(
  sessions: TogetherSessionSummary[],
  myId: string | null,
): TogetherSessionSummary | undefined {
  const yourTurn = sessions.find((s) => s.yourTurn && s.status !== 'complete');
  if (yourTurn) return yourTurn;
  const invited = sessions.find((s) => s.status === 'invited' && s.initiatorPersonId !== myId);
  if (invited) return invited;
  return [...sessions]
    .filter((s) => s.status !== 'complete')
    .sort((a, b) =>
      (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt),
    )[0];
}

/**
 * The Together hero card (60 §3.1.5) — the one couples session that most wants the person's attention
 * (your turn / a pending invite / the most recent active pair), with unread + a snippet + a CTA into
 * Together. Self-hides when there are no live sessions (the "start a session" nudge lives in "For you").
 * Per-person + gated by a live partner edge (the bridge only returns summaries when one exists).
 */
export function TogetherHomeCard({
  sessions,
  myId,
}: {
  sessions: TogetherSessionSummary[];
  myId: string | null;
}): JSX.Element | null {
  const navigate = useNavigate();
  const session = primarySession(sessions, myId);
  if (!session) return null;

  const name = partnerName(session, myId);
  // Show WHOSE turn it is explicitly: yours, the partner's, or a pending invite.
  const pill =
    session.status === 'invited' ? 'Invitation' : session.yourTurn ? 'Your turn' : `${name}’s turn`;

  return (
    <Card>
      <Stack gap={3}>
        <div className={styles.cardHead}>
          <Heading level={2} className={styles.sectionTitle}>
            <Heart size={16} aria-hidden="true" /> Together · {name}
          </Heading>
          <span className={session.yourTurn ? styles.statusPill : styles.statusPillMuted}>
            {pill}
          </span>
        </div>
        <Text tone="secondary" size="sm">
          {session.status === 'invited'
            ? `${name} invited you to a session.`
            : session.lastMessageSnippet
              ? `“${plain(session.lastMessageSnippet)}”`
              : session.topic
                ? session.topic
                : 'Pick up where you left off.'}
          {session.unreadCount > 0 ? ` · ${session.unreadCount} unread` : ''}
        </Text>
        <Button variant="secondary" size="sm" onClick={() => navigate('/together')}>
          {session.status === 'invited' ? 'View invitation' : 'Open session'}
        </Button>
      </Stack>
    </Card>
  );
}

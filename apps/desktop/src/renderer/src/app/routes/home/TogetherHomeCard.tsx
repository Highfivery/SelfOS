import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Heart } from 'lucide-react';
import type { TogetherPulseView, TogetherSessionSummary } from '@shared/schemas';
import { Button, Card, Heading, Stack, Text } from '../../../design-system/components';
import { Ring } from './Ring';
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

/** A 0..1 dyad metric → a gentle level word (never a score to chase). */
function levelFor(value: number): string {
  if (value < 0.2) return 'Quiet';
  if (value < 0.4) return 'Tender';
  if (value < 0.6) return 'Steady';
  if (value < 0.8) return 'Warm';
  return 'Close';
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
 * The Together hero card (60 §3.1.5) — the one couples session that most wants attention (your turn / a
 * pending invite / the most recent active pair), with WHOSE turn it is, a clean snippet, a **pulse ring**
 * (the dyad Connection trend) and the **desire alignment** (only when both partners have consented to share
 * it — 58 §3.10a), and a CTA into Together. The pulse is a free, deterministic read (no spend). Self-hides
 * when there are no live sessions. Per-person + gated by a live partner edge.
 */
export function TogetherHomeCard({
  sessions,
  myId,
}: {
  sessions: TogetherSessionSummary[];
  myId: string | null;
}): JSX.Element | null {
  const navigate = useNavigate();
  const [pulse, setPulse] = useState<TogetherPulseView | null>(null);
  const session = primarySession(sessions, myId);
  const partnerId = session?.participants.find((p) => p.personId !== myId)?.personId;

  useEffect(() => {
    setPulse(null);
    if (!partnerId) return undefined;
    let cancelled = false;
    void window.selfos
      ?.togetherPulse?.({ partnerPersonId: partnerId })
      ?.then((view) => {
        if (!cancelled) setPulse(view);
      })
      .catch(() => {
        /* a calm no-pulse card */
      });
    return () => {
      cancelled = true;
    };
  }, [partnerId]);

  if (!session) return null;

  const name = partnerName(session, myId);
  // Show WHOSE turn it is explicitly: yours, the partner's, or a pending invite.
  const pill =
    session.status === 'invited' ? 'Invitation' : session.yourTurn ? 'Your turn' : `${name}’s turn`;

  const connection = pulse?.series.find((s) => /connection/i.test(s.label));
  const connectionValue = connection?.points.at(-1)?.y;
  const alignment = pulse?.alignment;
  const showPulse =
    connectionValue !== undefined || (alignment?.ready === true && alignment.read !== undefined);

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

        {showPulse ? (
          <div className={styles.pulseRow}>
            {connectionValue !== undefined ? (
              <div className={styles.pulseItem}>
                <Ring fill={connectionValue} color="var(--color-chart-4)" size={46} stroke={5}>
                  <span className={styles.pulseRingLevel}>{levelFor(connectionValue)}</span>
                </Ring>
                <span className={styles.pulseLabel}>
                  Connection{connection?.direction ? ` · ${connection.direction}` : ''}
                </span>
              </div>
            ) : null}
            {alignment?.ready && alignment.read ? (
              <span
                className={alignment.read === 'aligned' ? styles.pulseAlignGood : styles.pulseAlign}
              >
                Desire · {alignment.read}
              </span>
            ) : null}
          </div>
        ) : null}

        <Button variant="secondary" size="sm" onClick={() => navigate('/together')}>
          {session.status === 'invited' ? 'View invitation' : 'Open session'}
        </Button>
      </Stack>
    </Card>
  );
}

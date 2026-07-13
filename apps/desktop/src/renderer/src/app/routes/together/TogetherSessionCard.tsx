import type { TogetherCatalogEntry, TogetherSessionSummary } from '@shared/schemas';
import { Text } from '../../../design-system/components';
import { practiceEyebrow } from './PracticeCard';
import styles from './Together.module.css';

type Tone = 'accent' | 'warning' | 'neutral';

/** The status label + tone for a session, from the viewer's perspective (§3 — viewer projection). */
export function sessionStatus(
  session: TogetherSessionSummary,
  myId: string | null,
): { label: string; tone: Tone } {
  const iInitiated = session.initiatorPersonId === myId;
  switch (session.status) {
    case 'active':
      return session.yourTurn
        ? { label: 'Your turn', tone: 'accent' }
        : { label: 'Waiting for you both', tone: 'neutral' };
    case 'invited':
      return iInitiated
        ? { label: 'Invited · waiting', tone: 'neutral' }
        : { label: 'Open invitation', tone: 'accent' };
    case 'expired':
      return { label: 'Invitation expired', tone: 'warning' };
    case 'onHold':
      return { label: 'Paused', tone: 'neutral' };
    case 'ended':
      return { label: 'Ended', tone: 'neutral' };
    case 'complete':
      return { label: 'Completed', tone: 'neutral' };
    case 'declined':
      return { label: 'Declined', tone: 'neutral' };
  }
}

/** A short, human relative time from an ISO timestamp — "just now", "2h ago", "yesterday", "5 days ago". */
export function relativeTime(iso: string | undefined): string {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const mins = Math.floor((Date.now() - then) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(then).toLocaleDateString();
}

/**
 * A rich session card (58 §3.2 redesign, §166): a clear title (the guide name or the topic), an eyebrow
 * (framework + steps, or "Open conversation"), a subject line so it's obvious what the session is about, the
 * last-message excerpt, the partner + when, and an unread dot — with a clear status pill. The ball-in-your-
 * court session is accent-bordered so it stands out.
 */
export function TogetherSessionCard({
  session,
  myId,
  guide,
  onOpen,
}: {
  session: TogetherSessionSummary;
  myId: string | null;
  guide: TogetherCatalogEntry | undefined;
  onOpen: () => void;
}): JSX.Element {
  const partner = session.participants.find((p) => p.personId !== myId);
  const partnerName = partner?.displayName ?? 'your partner';
  const status = sessionStatus(session, myId);

  const eyebrow = guide
    ? practiceEyebrow(guide)
    : session.guideId
      ? 'Guided session'
      : 'Open conversation';
  const title = guide?.title ?? session.topic ?? 'Open session';
  const subject = guide
    ? guide.blurb
    : session.topic
      ? `A free session you started with ${partnerName}.`
      : `A free conversation to talk something through with ${partnerName}.`;
  const when = relativeTime(session.lastMessageAt ?? session.createdAt);

  return (
    <button
      type="button"
      className={styles.sessionCard}
      data-turn={status.tone === 'accent' ? 'you' : undefined}
      onClick={onOpen}
    >
      <div className={styles.sessionCardHead}>
        <div>
          <div className={styles.sessionEyebrow}>{eyebrow}</div>
          <div className={styles.sessionCardTitle}>{title}</div>
        </div>
        <span className={styles.statusPill} data-tone={status.tone}>
          {status.label}
        </span>
      </div>
      <div className={styles.sessionSubject}>{subject}</div>
      {session.lastMessageSnippet ? (
        <div className={styles.sessionExcerpt}>“{session.lastMessageSnippet}”</div>
      ) : null}
      <div className={styles.sessionFoot}>
        <span className={styles.sessionWho}>
          <span className={styles.miniAvatar} aria-hidden="true">
            {(partnerName[0] ?? '?').toUpperCase()}
          </span>
          <Text size="xs" tone="secondary">
            {partnerName}
            {when ? ` · ${when}` : ''}
          </Text>
        </span>
        {session.unreadCount > 0 ? (
          <span className={styles.unreadDot} aria-label={`${session.unreadCount} unread`} />
        ) : null}
      </div>
    </button>
  );
}

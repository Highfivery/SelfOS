import type { ReactNode } from 'react';
import { formatMessageTime } from './messageTimeFormat';
import styles from './MessageTime.module.css';

/** The muted "3:42 PM" meta below a chat bubble. Renders nothing if the ISO can't be parsed. */
export function MessageTime({
  iso,
  align = 'start',
}: {
  iso: string;
  align?: 'start' | 'end';
}): JSX.Element | null {
  const text = formatMessageTime(iso);
  if (!text) return null;
  return (
    <time className={styles.time} data-align={align} dateTime={iso}>
      {text}
    </time>
  );
}

/** A centered "Today" / "Yesterday" / date divider between messages from different days. */
export function MessageDayDivider({ label }: { label: string }): JSX.Element {
  return (
    <div className={styles.divider} role="separator" aria-label={label}>
      <span className={styles.dividerLine} aria-hidden="true" />
      {/* The separator names itself via aria-label; hide the visible copy so it isn't announced twice. */}
      <span className={styles.dividerLabel} aria-hidden="true">
        {label}
      </span>
      <span className={styles.dividerLine} aria-hidden="true" />
    </div>
  );
}

/**
 * A message group: the bubble (passed as children) with its timestamp below, aligned to the sender's side
 * — right for the user, left for the coach. Owns the bubble's max-width + alignment so the plain-bubble
 * surfaces (Sessions, Dreams, Onboarding) share one layout. Omit `iso` for an in-flight (streaming /
 * "thinking") bubble so it aligns without a timestamp.
 */
export function MessageRow({
  side,
  iso,
  actions,
  children,
}: {
  side: 'user' | 'coach';
  iso?: string;
  /**
   * Optional per-message rewind controls (66 §3.3), rendered on the timestamp line. Putting the slot
   * here is what lets Sessions, Dreams and Onboarding share one affordance instead of three copies.
   * The `messageRowHost` class is the hover target `MessageActions` reveals itself from.
   */
  actions?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className={`${styles.row} messageRowHost`} data-side={side}>
      {children}
      <div className={styles.meta} data-side={side}>
        {iso ? <MessageTime iso={iso} align={side === 'user' ? 'end' : 'start'} /> : null}
        {actions}
      </div>
    </div>
  );
}

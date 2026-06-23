import { X } from 'lucide-react';
import type { Notification } from '@shared/channels';
import { notificationIcon } from './notificationKinds';
import { actionLabel } from './notificationActions';
import { relativeTime } from './relativeTime';
import styles from './NotificationCenter.module.css';

interface NotificationCenterProps {
  notifications: Notification[];
  onAction: (notification: Notification) => void;
  onDismiss: (coalesceKey: string) => void;
  onDismissAll: () => void;
  onMarkAllRead: () => void;
}

/**
 * The notification center dropdown list (35-notification-system §3.1). Presentational — the bell wires the
 * store + open state; this just renders. Newest first; unread rows carry a non-color-only dot; each row has
 * its kind icon, title, one-line body, relative time, an optional action, and a per-row dismiss. Vertical
 * scroll only (CLAUDE.md §12). Showcased in /gallery with sample data.
 */
export function NotificationCenter({
  notifications,
  onAction,
  onDismiss,
  onDismissAll,
  onMarkAllRead,
}: NotificationCenterProps): JSX.Element {
  const hasAny = notifications.length > 0;
  const hasUnread = notifications.some((n) => !n.read);

  return (
    <div className={styles.center} role="menu" aria-label="Notifications">
      <div className={styles.header}>
        <span className={styles.heading}>Notifications</span>
        {hasAny ? (
          <div className={styles.headerActions}>
            {hasUnread ? (
              <button type="button" className={styles.headerButton} onClick={onMarkAllRead}>
                Mark all read
              </button>
            ) : null}
            <button type="button" className={styles.headerButton} onClick={onDismissAll}>
              Dismiss all
            </button>
          </div>
        ) : null}
      </div>

      {hasAny ? (
        <ul className={styles.list}>
          {notifications.map((n) => {
            const Icon = notificationIcon(n.kind);
            const label = actionLabel(n.action);
            const time = relativeTime(n.createdAt);
            return (
              <li
                key={n.id}
                role="menuitem"
                className={n.read ? styles.row : `${styles.row} ${styles.unread}`}
              >
                <span className={styles.rowIcon} data-severity={n.severity}>
                  <Icon size={16} aria-hidden="true" />
                </span>
                <div className={styles.rowBody}>
                  <div className={styles.rowTitleLine}>
                    {n.read ? null : (
                      <span className={styles.unreadDot} aria-label="Unread" role="img" />
                    )}
                    <span className={styles.rowTitle}>{n.title}</span>
                    {time ? (
                      <span className={styles.rowTime} aria-hidden="true">
                        {time}
                      </span>
                    ) : null}
                  </div>
                  {n.body ? <p className={styles.rowText}>{n.body}</p> : null}
                  {label && n.action ? (
                    <button type="button" className={styles.rowAction} onClick={() => onAction(n)}>
                      {label}
                    </button>
                  ) : null}
                </div>
                <button
                  type="button"
                  className={styles.rowDismiss}
                  aria-label="Dismiss notification"
                  onClick={() => onDismiss(n.coalesceKey)}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className={styles.empty}>
          <p className={styles.emptyText}>You’re all caught up.</p>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import type { Notification } from '@shared/channels';
import { TitlebarControl } from '../../design-system/components';
import { selectUnreadCount, useNotificationStore } from '../../stores/notificationStore';
import { NotificationCenter } from './NotificationCenter';
import { runNotificationAction } from './notificationActions';
import styles from './NotificationBell.module.css';

/**
 * The titlebar notification bell + count badge (35-notification-system §3.1). Opens the center dropdown
 * (the AccountMenu menu/backdrop/Esc pattern, so it's not clipped or off-screen). Opening marks shown items
 * read (the badge clears) but does not dismiss them. `flex:none` so the bell can't shrink (CLAUDE.md §12).
 */
export function NotificationBell(): JSX.Element {
  const notifications = useNotificationStore((s) => s.notifications);
  const unread = useNotificationStore(selectUnreadCount);
  const markRead = useNotificationStore((s) => s.markRead);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const dismiss = useNotificationStore((s) => s.dismiss);
  const dismissAll = useNotificationStore((s) => s.dismissAll);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Opening the center marks shown items read (clears the badge) but keeps them in the list (§3.1).
  useEffect(() => {
    if (open && unread > 0) markAllRead();
  }, [open, unread, markAllRead]);

  const onAction = (notification: Notification): void => {
    runNotificationAction(notification.action, navigate);
    markRead(notification.coalesceKey);
    setOpen(false);
  };

  return (
    <div className={styles.wrap}>
      <TitlebarControl
        className={styles.trigger}
        tone={unread > 0 ? 'warning' : 'default'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={18} aria-hidden="true" />
        {unread > 0 ? (
          <span className={styles.badge} aria-hidden="true">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </TitlebarControl>
      {open ? (
        <>
          <button
            type="button"
            className={styles.backdrop}
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setOpen(false)}
          />
          <NotificationCenter
            notifications={notifications}
            onAction={onAction}
            onDismiss={dismiss}
            onDismissAll={() => {
              dismissAll();
              setOpen(false);
            }}
            onMarkAllRead={markAllRead}
          />
        </>
      ) : null}
    </div>
  );
}

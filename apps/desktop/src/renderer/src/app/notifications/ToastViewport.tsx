import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Notification } from '@shared/channels';
import { Toast } from '../../design-system/components';
import { useNotificationStore } from '../../stores/notificationStore';
import { runNotificationAction, actionLabel } from './notificationActions';
import styles from './ToastViewport.module.css';

const MAX_VISIBLE = 3; // overflow folds into the center (35-notification-system §3.2)
const AUTO_DISMISS_MS = 5000; // info/success; warning is sticky (§11)

/**
 * Renders top-right toasts for newly-arrived unread notifications (35-notification-system §3.2). Each item
 * is toasted once per session (tracked in the store so a recompute never re-toasts); after it fades it
 * stays in the center. Mounted once in the AppShell. `info`/`success` auto-dismiss; `warning` is sticky.
 */
export function ToastViewport(): JSX.Element | null {
  const notifications = useNotificationStore((s) => s.notifications);
  const toastedIds = useNotificationStore((s) => s.toastedIds);
  const markToasted = useNotificationStore((s) => s.markToasted);
  const markRead = useNotificationStore((s) => s.markRead);
  const navigate = useNavigate();
  const [visible, setVisible] = useState<Notification[]>([]);

  useEffect(() => {
    // Toasts represent UNACKNOWLEDGED items: surface each fresh unread one once, and drop any that became
    // read (the user opened the center) or were dismissed — so a sticky warning toast can't linger forever.
    const unread = notifications.filter((n) => !n.read);
    const unreadIds = new Set(unread.map((n) => n.id));
    const fresh = unread.filter((n) => !toastedIds.includes(n.id));
    if (fresh.length > 0) markToasted(fresh.map((n) => n.id));
    setVisible((prev) => {
      const kept = prev.filter((v) => unreadIds.has(v.id));
      const additions = fresh.filter((f) => !kept.some((k) => k.id === f.id));
      return [...additions, ...kept].slice(0, MAX_VISIBLE);
    });
  }, [notifications, toastedIds, markToasted]);

  const remove = (id: string): void => setVisible((prev) => prev.filter((v) => v.id !== id));

  if (visible.length === 0) return null;

  return (
    <div className={styles.viewport} aria-live="polite">
      {visible.map((n) => {
        const label = actionLabel(n.action);
        return (
          <Toast
            key={n.id}
            severity={n.severity}
            title={n.title}
            {...(n.body !== undefined ? { body: n.body } : {})}
            {...(label && n.action
              ? {
                  actionLabel: label,
                  onAction: () => {
                    runNotificationAction(n.action, navigate);
                    markRead(n.coalesceKey);
                    remove(n.id);
                  },
                }
              : {})}
            onClose={() => remove(n.id)}
            {...(n.severity === 'warning' ? {} : { autoDismissMs: AUTO_DISMISS_MS })}
          />
        );
      })}
    </div>
  );
}

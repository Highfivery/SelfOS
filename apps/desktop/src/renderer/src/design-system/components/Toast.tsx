import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, type LucideIcon } from 'lucide-react';
import styles from './Toast.module.css';

export type ToastSeverity = 'info' | 'success' | 'warning';

const ICONS: Record<ToastSeverity, LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
};

interface ToastProps {
  severity: ToastSeverity;
  title: string;
  body?: string;
  /** Optional single action (e.g. "View results"). */
  actionLabel?: string;
  onAction?: () => void;
  /** Manual close (the × ) — and what the auto-dismiss timer calls. */
  onClose: () => void;
  /**
   * Auto-dismiss after this many ms, paused while hovered/focused (35-notification-system §3.2/§11).
   * Omit for a sticky toast (warning / update-available) that only a manual close removes.
   */
  autoDismissMs?: number;
}

/**
 * A brief, non-blocking pop-up (35-notification-system §3.2). `warning` uses `role="alert"` (assertive);
 * `info`/`success` use `role="status"` (polite) — §9. Severity maps to the design-system Banner tones (no
 * new colors). Auto-dismiss pauses on hover/focus; enter motion is disabled under reduced-motion via tokens.
 */
export function Toast({
  severity,
  title,
  body,
  actionLabel,
  onAction,
  onClose,
  autoDismissMs,
}: ToastProps): JSX.Element {
  const Icon = ICONS[severity];
  const [paused, setPaused] = useState(false);
  // Keep the latest onClose without restarting the timer when the parent re-renders.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (autoDismissMs === undefined || paused) return undefined;
    const timer = setTimeout(() => closeRef.current(), autoDismissMs);
    return () => clearTimeout(timer);
  }, [autoDismissMs, paused]);

  return (
    <div
      className={`${styles.toast} ${styles[severity]}`}
      role={severity === 'warning' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon size={18} aria-hidden="true" className={styles.icon} />
      <div className={styles.content}>
        <p className={styles.title}>{title}</p>
        {body ? <p className={styles.text}>{body}</p> : null}
        {actionLabel && onAction ? (
          <button type="button" className={styles.action} onClick={onAction}>
            {actionLabel}
          </button>
        ) : null}
      </div>
      <button type="button" className={styles.close} aria-label="Dismiss" onClick={onClose}>
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

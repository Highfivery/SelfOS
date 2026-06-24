import type { ReactNode } from 'react';
import { Lightbulb, X } from 'lucide-react';
import { IconButton } from './IconButton';
import styles from './OneTimeTip.module.css';

/**
 * A quiet, dismissible inline hint (41 §3.2) — a calm one-liner that points at an easy-to-miss affordance,
 * shown at most once. Purely presentational: the caller decides whether to render it (from the device-local
 * per-person dismissal state) and handles `onDismiss`. It is an inline note, never a modal/overlay, and does
 * not trap focus. The dismiss control is keyboard-operable with a clear accessible name.
 */
export function OneTimeTip({
  children,
  onDismiss,
}: {
  children: ReactNode;
  onDismiss: () => void;
}): JSX.Element {
  return (
    <div className={styles.tip} role="note">
      <Lightbulb size={15} aria-hidden="true" className={styles.icon} />
      <div className={styles.body}>{children}</div>
      <IconButton aria-label="Dismiss tip" onClick={onDismiss} className={styles.dismiss}>
        <X size={15} aria-hidden="true" />
      </IconButton>
    </div>
  );
}

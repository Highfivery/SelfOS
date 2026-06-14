import type { SessionStatus } from '@shared/schemas';
import { SESSION_STATUS_LABEL } from './sessionStatus';
import styles from './sessionLifecycle.module.css';

/**
 * A small status pill for a session (09 §14.5). Display-only — the status is set via the per-item menu.
 * The state is conveyed by label text (not colour alone, §9); a tone class adds a subtle hue.
 */
export function SessionStatusPill({ status }: { status: SessionStatus }): JSX.Element {
  return (
    <span className={`${styles.pill} ${styles[status]}`} data-status={status}>
      {SESSION_STATUS_LABEL[status]}
    </span>
  );
}

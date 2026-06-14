import { useEffect, useState } from 'react';
import { MoreVertical } from 'lucide-react';
import { IconButton } from '../../../design-system/components';
import type { SessionStatus } from '@shared/schemas';
import { SESSION_STATUS_LABEL, SESSION_STATUSES } from './sessionStatus';
import styles from './sessionLifecycle.module.css';

interface SessionStatusMenuProps {
  title: string;
  status: SessionStatus;
  onSetStatus: (status: SessionStatus) => void;
  /** Offered only when AI is configured: complete the session AND summarize it in one action. */
  onCompleteAndSummarize?: () => void;
}

/**
 * A per-session "⋯" menu to change lifecycle status (09 §14.5). Keyboard + screen-reader friendly:
 * a labelled trigger with `aria-expanded`, Escape to close, and a backdrop to dismiss on outside click.
 */
export function SessionStatusMenu({
  title,
  status,
  onSetStatus,
  onCompleteAndSummarize,
}: SessionStatusMenuProps): JSX.Element {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const choose = (action: () => void): void => {
    action();
    setOpen(false);
  };

  return (
    <div className={styles.menuWrap}>
      <IconButton
        aria-label={`Session options for ${title}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreVertical size={14} aria-hidden="true" />
      </IconButton>
      {open ? (
        <>
          <button
            type="button"
            className={styles.backdrop}
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setOpen(false)}
          />
          <div className={styles.menu} role="menu">
            {SESSION_STATUSES.filter((s) => s !== status).map((s) => (
              <button
                key={s}
                type="button"
                role="menuitem"
                className={styles.menuItem}
                onClick={() => choose(() => onSetStatus(s))}
              >
                {s === 'complete'
                  ? 'Mark complete'
                  : `Mark ${SESSION_STATUS_LABEL[s].toLowerCase()}`}
              </button>
            ))}
            {onCompleteAndSummarize ? (
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                onClick={() => choose(onCompleteAndSummarize)}
              >
                Complete &amp; summarize
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

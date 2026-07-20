import { useState, type JSX } from 'react';
import { RefreshCw, Trash2 } from 'lucide-react';
import { Button } from './Button';
import styles from './MessageActions.module.css';

/**
 * Per-message rewind actions (66 §3.3) — "retry from here" and "delete from here".
 *
 * Both are destructive and linear: they drop this message and everything after it. That's deliberate
 * (no branching), so the delete is confirmed inline, naming how many messages go with it, rather than
 * silently discarding half a conversation.
 *
 * The inline two-step matches the app's existing habit — there is no ConfirmDialog primitive, and
 * whole-conversation delete already confirms this way.
 */
export function MessageActions({
  followingCount,
  onRegenerate,
  onDelete,
  busy = false,
  label,
}: {
  /** How many messages come AFTER this one — what the confirm has to be honest about. */
  followingCount: number;
  onRegenerate?: () => void;
  onDelete: () => void;
  busy?: boolean;
  /** Distinguishes this row's controls for screen readers (e.g. "your message at 3:42 PM"). */
  label: string;
}): JSX.Element {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    const total = followingCount + 1;
    return (
      <div className={styles.confirm} role="group" aria-label={`Delete ${label}?`}>
        <span className={styles.confirmText}>
          {total === 1
            ? 'Delete this message?'
            : `Delete this message and the ${followingCount} after it?`}
        </span>
        <Button
          variant="secondary"
          onClick={() => {
            setConfirming(false);
            onDelete();
          }}
        >
          Delete
        </Button>
        <Button variant="ghost" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.actions}>
      {onRegenerate ? (
        <button
          type="button"
          className={styles.button}
          onClick={onRegenerate}
          disabled={busy}
          aria-label={`Retry from ${label}`}
          title="Retry from here"
        >
          <RefreshCw size={15} aria-hidden="true" />
        </button>
      ) : null}
      <button
        type="button"
        className={`${styles.button} ${styles.danger}`}
        onClick={() => setConfirming(true)}
        disabled={busy}
        aria-label={`Delete from ${label}`}
        title="Delete from here"
      >
        <Trash2 size={15} aria-hidden="true" />
      </button>
    </div>
  );
}

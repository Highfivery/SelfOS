import { Sparkles, X } from 'lucide-react';
import { Button, IconButton } from '../../../design-system/components';
import styles from './sessionLifecycle.module.css';

/**
 * The dismissible "this feels wrapped up — summarize & complete?" prompt (09 §14.1/§14.5). Surfaces only
 * when the AI set the turn-embedded hint and the session isn't already complete; never auto-acts. Accepting
 * completes the session and summarizes it (the explicit confirmation to spend); dismissing hides it until a
 * later turn re-sets the hint.
 */
export function WrapUpSuggestion({
  busy,
  onAccept,
  onDismiss,
}: {
  busy: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}): JSX.Element {
  return (
    <div className={styles.suggestion} role="status">
      <Sparkles size={16} aria-hidden="true" className={styles.suggestionIcon} />
      <span className={styles.suggestionText}>
        This feels wrapped up — complete and summarize it?
      </span>
      <Button variant="secondary" onClick={onAccept} disabled={busy}>
        {busy ? 'Summarizing…' : 'Complete & summarize'}
      </Button>
      <IconButton aria-label="Dismiss suggestion" onClick={onDismiss}>
        <X size={14} aria-hidden="true" />
      </IconButton>
    </div>
  );
}

import { Sparkles } from 'lucide-react';
import { Button } from '../../../design-system/components';
import styles from '../sessions/sessionLifecycle.module.css';

/**
 * The "this feels ready to reflect on — analyze it?" prompt (12-dreams §15.4). Surfaces only when the coach
 * set the turn-embedded `[[SELFOS:DREAM_READY]]` hint and the dream isn't analyzed yet. It never gates —
 * "Create analysis" stays available regardless; this is a gentle, highlighted nudge (mirrors the session
 * wrap-up suggestion). Accepting runs the synthesis (the explicit spend).
 */
export function DreamAnalyzeSuggestion({
  busy,
  onAnalyze,
}: {
  busy: boolean;
  onAnalyze: () => void;
}): JSX.Element {
  return (
    <div className={styles.suggestion} role="status">
      <Sparkles size={16} aria-hidden="true" className={styles.suggestionIcon} />
      <span className={styles.suggestionText}>
        This feels ready to reflect on — analyze this dream?
      </span>
      <Button variant="primary" onClick={onAnalyze} disabled={busy}>
        {busy ? 'Writing your analysis…' : 'Analyze this dream'}
      </Button>
    </div>
  );
}

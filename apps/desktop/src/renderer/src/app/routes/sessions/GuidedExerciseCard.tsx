import { ArrowRight, ListChecks } from 'lucide-react';
import type { GuidedExercise } from '@selfos/core/conversations';
import styles from './Launcher.module.css';

/**
 * A guided-exercise card — a real button whose accessible name is title + framework + blurb (16 §9).
 * Compact, scannable layout: a tight eyebrow row (framework tag + a "Steps" marker for structured
 * exercises), the title, and a 2-line-clamped blurb (or the personalized `reason` for a suggestion).
 */
export function GuidedExerciseCard({
  exercise,
  onPick,
  disabled,
  reason,
}: {
  exercise: Pick<GuidedExercise, 'id' | 'title' | 'framework' | 'blurb' | 'kind'>;
  onPick: () => void;
  disabled?: boolean;
  reason?: string;
}): JSX.Element {
  const description = reason ?? exercise.blurb;
  return (
    <button
      type="button"
      className={styles.card}
      onClick={onPick}
      disabled={disabled}
      aria-label={`Start ${exercise.title} — ${exercise.framework}. ${description}`}
    >
      <span className={styles.cardEyebrow}>
        <span className={styles.cardTag}>{exercise.framework}</span>
        {exercise.kind === 'structured' ? (
          <span className={styles.cardSteps}>
            <ListChecks size={12} aria-hidden="true" />
            Steps
          </span>
        ) : null}
        <ArrowRight className={styles.cardGo} size={15} aria-hidden="true" />
      </span>
      <span className={styles.cardTitle}>{exercise.title}</span>
      <span className={reason ? styles.cardReason : styles.cardBlurb}>{description}</span>
    </button>
  );
}

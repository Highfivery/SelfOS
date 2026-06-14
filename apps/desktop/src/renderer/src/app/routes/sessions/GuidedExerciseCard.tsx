import type { GuidedExercise } from '@selfos/core/conversations';
import styles from './Launcher.module.css';

/**
 * A guided-exercise card — a real button whose accessible name is title + framework + blurb (16 §9). When
 * a `reason` is given (a personalized "Suggested for you" pick), it replaces the static blurb.
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
      <span className={styles.cardHead}>
        <span className={styles.cardTitle}>{exercise.title}</span>
        <span className={styles.cardTag}>{exercise.framework}</span>
      </span>
      <span className={reason ? styles.reason : styles.cardBlurb}>{description}</span>
      {exercise.kind === 'structured' ? (
        <span className={styles.cardKind}>Step-by-step exercise</span>
      ) : null}
    </button>
  );
}

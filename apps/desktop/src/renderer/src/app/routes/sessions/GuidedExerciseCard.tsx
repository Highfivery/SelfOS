import { ListChecks } from 'lucide-react';
import type { GuidedExercise } from '@selfos/core/conversations';
import styles from './Launcher.module.css';

/**
 * A guided-exercise card — a real button whose accessible name is title + framework + blurb (16 §9). The
 * framework tag is an eyebrow ABOVE the title so the title always has full width to wrap (never per-word).
 * When a `reason` is given (a personalized "Suggested for you" pick), it replaces the static blurb.
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
      <span className={styles.cardTag}>{exercise.framework}</span>
      <span className={styles.cardTitle}>{exercise.title}</span>
      <span className={reason ? styles.reason : styles.cardBlurb}>{description}</span>
      {exercise.kind === 'structured' ? (
        <span className={styles.cardKind}>
          <ListChecks size={13} aria-hidden="true" />
          Step-by-step
        </span>
      ) : null}
    </button>
  );
}

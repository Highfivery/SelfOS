import { Check } from 'lucide-react';
import styles from './Launcher.module.css';

/**
 * Orientation stepper for a structured guided exercise (16 §3.3). Shows the named steps with the current
 * one marked via `aria-current` + a distinct number/check (never colour alone, §9). It reflects best-effort
 * progress (`guideStep`); it never gates free input.
 */
export function GuidedStepper({
  steps,
  current,
}: {
  steps: string[];
  current: number | null;
}): JSX.Element {
  const at = current ?? 0;
  return (
    <ol className={styles.stepper} aria-label="Exercise steps">
      {steps.map((label, i) => {
        const active = i === at;
        const done = i < at;
        const cls = active
          ? `${styles.step} ${styles.stepActive}`
          : done
            ? `${styles.step} ${styles.stepDone}`
            : styles.step;
        return (
          <li key={label} className={cls} aria-current={active ? 'step' : undefined}>
            <span className={styles.stepIndex} aria-hidden="true">
              {done ? <Check size={12} /> : i + 1}
            </span>
            <span>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

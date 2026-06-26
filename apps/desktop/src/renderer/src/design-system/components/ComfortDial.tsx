import styles from './ComfortDial.module.css';

/** The comfort/stretch descriptors (1 = a gentle nudge … 5 = a big leap) — 52-challenge-sessions §3.4. */
const DESCRIPTOR: Record<number, string> = {
  1: 'a gentle nudge',
  2: 'an easy stretch',
  3: 'a real stretch',
  4: 'a bold step',
  5: 'a big leap',
};

const LEVELS = [1, 2, 3, 4, 5] as const;

/**
 * A compact, labelled comfort/difficulty indicator (52-challenge-sessions §3.4 / §9) — the stretch level the
 * person settled on (1..5). Conveyed as **text + shape** (filled vs hollow pips), never colour alone (§9). A
 * read-only display in v1 (the durable signal a future suggester calibrates on); the "make it smaller / ready
 * for more?" re-dial is a build nicety.
 */
export function ComfortDial({ value }: { value: number }): JSX.Element {
  const level = Math.max(1, Math.min(5, Math.round(value)));
  return (
    <span
      className={styles.dial}
      role="img"
      aria-label={`Comfort level ${level} of 5 — ${DESCRIPTOR[level] ?? ''}`}
    >
      <span className={styles.pips} aria-hidden="true">
        {LEVELS.map((l) => (
          <span key={l} className={styles.pip} data-on={l <= level ? 'true' : undefined} />
        ))}
      </span>
      <span className={styles.label}>
        {level}/5 · {DESCRIPTOR[level]}
      </span>
    </span>
  );
}

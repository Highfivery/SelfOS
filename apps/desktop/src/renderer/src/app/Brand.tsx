import styles from './Brand.module.css';

/** The sprout mark: a stem with two leaves (growth/wellness), in the dusty-blue accent. */
function SproutMark(): JSX.Element {
  return (
    <svg className={styles.mark} viewBox="0 0 28 28" aria-hidden="true">
      <path
        className={styles.leafBack}
        d="M14 17 C 9.5 17.5 6 14 5.5 8 C 11 8.5 13.5 12.5 14 17 Z"
      />
      <path
        className={styles.leafFront}
        d="M14 15 C 18.5 15.5 22 12 22.5 6 C 17 6.5 14.5 10.5 14 15 Z"
      />
      <path className={styles.stem} d="M14 25 C 13 21 13.4 17 14 13" />
    </svg>
  );
}

/**
 * The SelfOS brand lockup (02-app-shell §13.5): the sprout mark in a soft accent tile + the wordmark.
 * Presentational only — the AppHeader wraps it in a Home link, while gates like the lock screen render
 * it inert. Below `--bp-sm` the wordmark hides and only the tile shows (the compact mobile mark). The
 * wordmark carries the visible name; provide an accessible name on the wrapper when used as a control.
 */
export function Brand(): JSX.Element {
  return (
    <span className={styles.brand}>
      <span className={styles.tile} aria-hidden="true">
        <SproutMark />
      </span>
      <span className={styles.word}>SelfOS</span>
    </span>
  );
}

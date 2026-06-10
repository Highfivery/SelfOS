import styles from './Brand.module.css';

/** The sprout mark: a stem with two leaves (growth/wellness), tuned to the dusty-blue accent. */
function SproutMark({ titled }: { titled: boolean }): JSX.Element {
  return (
    <svg
      className={styles.mark}
      viewBox="0 0 28 28"
      {...(titled ? { role: 'img', 'aria-label': 'SelfOS' } : { 'aria-hidden': true })}
    >
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
 * SelfOS brand lockup for the sidebar header: the sprout mark + wordmark, collapsing to mark-only on
 * the icon rail. When the wordmark shows it carries the accessible name (the mark is decorative);
 * when collapsed the mark itself is labelled.
 */
export function Brand({ collapsed = false }: { collapsed?: boolean }): JSX.Element {
  return (
    <span className={styles.brand}>
      <SproutMark titled={collapsed} />
      {collapsed ? null : <span className={styles.word}>SelfOS</span>}
    </span>
  );
}

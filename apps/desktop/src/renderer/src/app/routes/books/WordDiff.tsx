import styles from './Books.module.css';
import { wordDiff } from '@selfos/core/story-diff';
import { useMemo } from 'react';

/** The word-level "What changed" render — added words as <ins>, removed as <del>, in reading order (§13.5). */
export function WordDiff({
  previous,
  current,
}: {
  previous: string;
  current: string;
}): JSX.Element {
  // Memoize the LCS so an unrelated re-render (while the diff is open) doesn't recompute the whole table.
  const tokens = useMemo(() => wordDiff(previous, current), [previous, current]);
  return (
    <p className={styles.diff} role="group" aria-label="What changed in this rewrite">
      {tokens.map((t, i) =>
        t.op === 'added' ? (
          <ins key={i} className={styles.diffAdd}>
            {t.text}
          </ins>
        ) : t.op === 'removed' ? (
          <del key={i} className={styles.diffRemove}>
            {t.text}
          </del>
        ) : (
          <span key={i}>{t.text}</span>
        ),
      )}
    </p>
  );
}

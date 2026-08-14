import styles from './Books.module.css';
import { useState } from 'react';

/** The hero's "more" menu (§13.4) — a compact popover with a backdrop catcher (no clipping). */
export function StudioKebab({
  onExport,
  onShare,
  onRename,
  onSettings,
  onFinish,
  onReopen,
  finished,
}: {
  onExport: () => void;
  onShare: () => void;
  onRename: () => void;
  onSettings: () => void;
  onFinish: () => void;
  onReopen: () => void;
  finished: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div className={styles.kebabWrap}>
      <button
        type="button"
        className={styles.kebabButton}
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>
      {open ? (
        <>
          <div className={styles.kebabBackdrop} onClick={() => setOpen(false)} aria-hidden="true" />
          <div className={styles.kebabMenu} role="menu">
            <button
              type="button"
              role="menuitem"
              className={styles.kebabItem}
              onClick={pick(onShare)}
            >
              Share &amp; readers
            </button>
            <button
              type="button"
              role="menuitem"
              className={styles.kebabItem}
              onClick={pick(onExport)}
            >
              Export…
            </button>
            <button
              type="button"
              role="menuitem"
              className={styles.kebabItem}
              onClick={pick(onRename)}
            >
              Rename
            </button>
            <button
              type="button"
              role="menuitem"
              className={styles.kebabItem}
              onClick={pick(onSettings)}
            >
              Book settings…
            </button>
            {/* A book has no natural end, so it needs a way to say "this one is done" (72 §3.6). Reversible:
                the frozen edition stays and the living book carries on from where it was. */}
            <button
              type="button"
              role="menuitem"
              className={styles.kebabItem}
              onClick={pick(finished ? onReopen : onFinish)}
            >
              {finished ? 'Reopen this book' : 'Finish this edition'}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

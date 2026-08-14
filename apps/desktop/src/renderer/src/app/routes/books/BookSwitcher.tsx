import styles from './Books.module.css';
import { useState } from 'react';
import type { BookManifest } from '@shared/schemas';

/**
 * The book shelf switcher (§19.2, #299) — a compact header control for a person who keeps more than one book.
 * The current book's title is a menu button; the menu lists the OTHER books (switch by opening them) + "Start
 * another book". Shown only when the person has ≥1 book (it always offers "Start another book", so a second book
 * is reachable from a single-book Studio); with just one book it's a small "one of your books" affordance.
 */
export function BookSwitcher({
  books,
  currentId,
  onSwitch,
  onStartNew,
}: {
  books: BookManifest[];
  currentId: string;
  onSwitch: (bookId: string) => void;
  onStartNew: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const others = books.filter((b) => b.id !== currentId);
  // "Book 2 of 4" reads as "chapter 2 of 4" at a glance — say what the number counts, or nothing.
  const label = books.length > 1 ? `Your books (${books.length})` : 'Your books';
  return (
    <div className={styles.kebabWrap}>
      <button
        type="button"
        className={styles.switcherButton}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {label} ▾
      </button>
      {open ? (
        <>
          <div className={styles.kebabBackdrop} onClick={() => setOpen(false)} aria-hidden="true" />
          <div className={styles.kebabMenu} role="menu">
            {others.map((b) => (
              <button
                key={b.id}
                type="button"
                role="menuitem"
                className={styles.kebabItem}
                onClick={() => {
                  setOpen(false);
                  onSwitch(b.id);
                }}
              >
                {b.title}
              </button>
            ))}
            <button
              type="button"
              role="menuitem"
              className={styles.kebabItem}
              onClick={() => {
                setOpen(false);
                onStartNew();
              }}
            >
              + Start another book
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

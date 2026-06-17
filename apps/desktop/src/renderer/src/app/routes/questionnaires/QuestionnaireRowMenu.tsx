import { useEffect, useState } from 'react';
import { MoreVertical } from 'lucide-react';
import { IconButton } from '../../../design-system/components';
import styles from './Questionnaires.module.css';

/**
 * A per-questionnaire "⋯" menu in the list (08-questionnaires §3.9): currently just Delete, but a self-
 * contained menu so the row stays uncluttered and more actions can join later. Keyboard + screen-reader
 * friendly: a labelled trigger with `aria-expanded`, Escape to close, and a backdrop for outside-click.
 * Deletion itself is confirmed by the parent (it's destructive — it removes any responses + insights).
 */
export function QuestionnaireRowMenu({
  title,
  onShare,
  onDelete,
}: {
  title: string;
  /** Shown only for a SENT questionnaire (§17.14c) — opens it + fetches a fresh shareable link. */
  onShare?: () => void;
  onDelete: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className={styles.menuWrap}>
      <IconButton
        aria-label={`Options for ${title}`}
        aria-expanded={open}
        variant="secondary"
        onClick={() => setOpen((value) => !value)}
      >
        <MoreVertical size={14} aria-hidden="true" />
      </IconButton>
      {open ? (
        <>
          <button
            type="button"
            className={styles.menuBackdrop}
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setOpen(false)}
          />
          <div className={styles.menu} role="menu">
            {onShare ? (
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                onClick={() => {
                  setOpen(false);
                  onShare();
                }}
              >
                Share link
              </button>
            ) : null}
            <button
              type="button"
              role="menuitem"
              className={`${styles.menuItem} ${styles.menuItemDanger}`}
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
            >
              Delete
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

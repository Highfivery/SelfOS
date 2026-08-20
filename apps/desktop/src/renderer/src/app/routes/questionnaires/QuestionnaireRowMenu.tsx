import { useEffect, useState } from 'react';
import { MoreVertical } from 'lucide-react';
import { IconButton } from '../../../design-system/components';
import styles from './Questionnaires.module.css';

/**
 * A per-questionnaire "⋯" menu in the list (08-questionnaires §3.9). It carries the card's secondary
 * actions — see-what-was-sent, copy-share-link, Duplicate, Delete — so the card header holds only the
 * favourite and this trigger. That is not tidiness: four 32px icon buttons in a `flex: none` cluster took
 * 134px that could not shrink, and the type label (a `flex: 1` sibling) absorbed the entire shortfall,
 * clipping 36-character labels to ~9 characters at the grid floor (§3.1).
 * Keyboard + screen-reader friendly: a labelled trigger with `aria-expanded`, Escape to close, and a
 * backdrop for outside-click. Deletion is confirmed by the parent (it removes responses + insights).
 */
export function QuestionnaireRowMenu({
  title,
  onView,
  onShare,
  onDuplicate,
  onDelete,
}: {
  title: string;
  /** Open the frozen snapshot of what was actually sent (present only once sent). */
  onView?: () => void;
  /** Copy the recipient's secure link (present only while a send is open + unanswered). */
  onShare?: () => void;
  /** Copy this questionnaire into a new draft to edit + re-send (e.g. to refresh stale answers). */
  onDuplicate?: () => void;
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
            {onView ? (
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                onClick={() => {
                  setOpen(false);
                  onView();
                }}
              >
                See what was sent
              </button>
            ) : null}
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
                Copy share link
              </button>
            ) : null}
            {onDuplicate ? (
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                onClick={() => {
                  setOpen(false);
                  onDuplicate();
                }}
              >
                Duplicate
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

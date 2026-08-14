import { Heading, Text } from '../../../design-system/components';
import { useStoryStore } from '../../../stores/storyStore';
import styles from './Story.module.css';
import { useEffect } from 'react';
import type { StoryTodoEntry } from '@shared/schemas';
import { TODO_KIND_LABEL } from './markupHelpers';

/** The book-level "To do" roll-up (§3.3.2), in a right-hand sheet opened from the Needs-you strip. */
export function TodoSheet({
  bookId,
  todos,
  onClose,
}: {
  bookId: string;
  todos: StoryTodoEntry[];
  onClose: () => void;
}): JSX.Element {
  const updateMark = useStoryStore((s) => s.updateMark);
  const loadTodos = useStoryStore((s) => s.loadTodos);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className={styles.sheetWrap}>
      <div className={styles.sheetBackdrop} onClick={onClose} aria-hidden="true" />
      <aside className={styles.sheetPanel} role="dialog" aria-label="To do">
        <div className={styles.sheetHead}>
          <Heading level={2}>To do</Heading>
          <button
            type="button"
            className={styles.sourcesToggle}
            aria-label="Close"
            onClick={onClose}
          >
            ✕ Close
          </button>
        </div>
        <div className={styles.sheetBody}>
          {todos.map((t) => (
            <div key={t.id} className={styles.markRow}>
              <Text size="sm">
                {TODO_KIND_LABEL[t.kind] ?? 'To-do'}: {t.text}
              </Text>
              {t.kind === 'remind' && t.status === 'open' ? (
                <button
                  type="button"
                  className={styles.sourcesToggle}
                  onClick={async () => {
                    await updateMark(bookId, t.chapterId, t.id, { status: 'done' });
                    await loadTodos(bookId);
                  }}
                >
                  Mark done
                </button>
              ) : (
                <Text size="sm" tone="secondary">
                  {t.status === 'questionsSent'
                    ? 'Questions sent'
                    : 'Folds into your next revision'}
                </Text>
              )}
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

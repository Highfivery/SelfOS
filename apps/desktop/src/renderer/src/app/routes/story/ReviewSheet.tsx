import { Button, Heading, Stack, Text } from '../../../design-system/components';
import styles from './Story.module.css';
import { useEffect } from 'react';
import type { ChapterMarkup } from '@shared/schemas';
import { INTENT_LABEL } from './markupHelpers';

/** One grouped section inside the Review & apply sheet (Cuts / Comments / For your biographer). */
export function ReviewGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className={styles.reviewGroup}>
      <span className={styles.reviewGroupTitle}>{title}</span>
      <Stack gap={2}>{children}</Stack>
    </div>
  );
}
/** One pending mark in the Review & apply sheet: a short description, its anchor excerpt, and a per-mark
 *  "Remove from this batch" (= the existing mark undo). */
export function ReviewRow({
  label,
  excerpt,
  struck,
  onRemove,
}: {
  label?: string;
  excerpt?: string | undefined;
  struck?: boolean;
  onRemove: () => void;
}): JSX.Element {
  return (
    <div className={styles.reviewRow}>
      <div className={styles.reviewRowBody}>
        {label ? <Text size="sm">{label}</Text> : null}
        {excerpt ? (
          <Text size="sm" tone="tertiary" className={styles.reviewExcerpt}>
            {struck ? <del className={styles.deleteQuote}>{excerpt}</del> : `“${excerpt}”`}
          </Text>
        ) : null}
      </div>
      <button type="button" className={styles.sourcesToggle} onClick={onRemove}>
        Remove from this batch
      </button>
    </div>
  );
}
/**
 * The Review & apply sheet (§13.5) — a right-hand sheet over the dimmed chapter listing the pending marks
 * grouped, each removable from the batch, plus the one metered revision (`applyMarkup`, unchanged). Reuses the
 * shared `.sheet*` chrome (the same right-hand sheet the to-do list uses). Instant changes (inline edits, pins)
 * are not marks, so they never appear here — a calm note says so.
 */
export function ReviewSheet({
  markup,
  busy,
  onRemove,
  onApply,
  onClose,
}: {
  markup: ChapterMarkup | null;
  busy: boolean;
  onRemove: (markId: string) => void;
  onApply: () => void | Promise<void>;
  onClose: () => void;
}): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  type Mark = ChapterMarkup['marks'][number];
  const marks = markup?.marks ?? [];
  const cuts = marks.filter(
    (m): m is Extract<Mark, { kind: 'delete' }> => m.kind === 'delete' && m.status === 'pending',
  );
  const comments = marks.filter(
    (m): m is Extract<Mark, { kind: 'comment' }> =>
      m.kind === 'comment' && m.status === 'open' && m.intent !== 'question',
  );
  const asks = marks.filter(
    (m): m is Extract<Mark, { kind: 'todo' }> =>
      m.kind === 'todo' && m.status === 'open' && m.todoKind === 'ask',
  );

  return (
    <div className={styles.sheetWrap}>
      <div className={styles.sheetBackdrop} onClick={onClose} aria-hidden="true" />
      <aside className={styles.sheetPanel} role="dialog" aria-label="Review and apply changes">
        <div className={styles.sheetHead}>
          <Heading level={2}>Review &amp; apply</Heading>
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
          {cuts.length > 0 ? (
            <ReviewGroup title="Cuts">
              {cuts.map((m) => (
                <ReviewRow
                  key={m.id}
                  excerpt={m.anchor.quote}
                  struck
                  onRemove={() => onRemove(m.id)}
                />
              ))}
            </ReviewGroup>
          ) : null}
          {comments.length > 0 ? (
            <ReviewGroup title="Comments">
              {comments.map((m) => (
                <ReviewRow
                  key={m.id}
                  label={`${INTENT_LABEL[m.intent]}: ${m.text}`}
                  excerpt={m.anchor.quote}
                  onRemove={() => onRemove(m.id)}
                />
              ))}
            </ReviewGroup>
          ) : null}
          {asks.length > 0 ? (
            <ReviewGroup title="For your biographer">
              {asks.map((m) => (
                <ReviewRow
                  key={m.id}
                  label={m.text}
                  excerpt={m.anchor?.quote}
                  onRemove={() => onRemove(m.id)}
                />
              ))}
            </ReviewGroup>
          ) : null}
          <Text size="sm" tone="tertiary">
            Your inline edits and pins are already in — they apply the moment you make them.
          </Text>
        </div>
        <div className={styles.sheetFoot}>
          <Button variant="primary" disabled={busy} onClick={() => void onApply()}>
            {busy ? 'Applying…' : 'Apply with your biographer'}
          </Button>
        </div>
      </aside>
    </div>
  );
}

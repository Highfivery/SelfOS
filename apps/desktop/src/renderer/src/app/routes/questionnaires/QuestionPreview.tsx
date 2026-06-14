import { useId, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { AnswerMap } from '@selfos/core/questionnaires';
import type { Question } from '@shared/schemas';
import { QuestionnaireForm, type LoadImage } from '@selfos/answering';
import { Text } from '../../../design-system/components';
import styles from './Questionnaires.module.css';

/**
 * Live inline preview of a SINGLE question as the recipient will see it (08-questionnaires §15.5). It
 * reuses the shared `@selfos/answering` renderer — the same components the Inbox + relay use — so the
 * preview is byte-identical to the real thing, not a separate mock. It is **non-interactive for data**:
 * you can poke the control to feel it, but nothing is saved (local answer state, like the full
 * Preview/Test-on-self dry run). Collapsible — the builder keeps the edited question's preview expanded
 * and the rest collapsed (density on long questionnaires), and each is independently toggleable.
 *
 * A question mid-edit (no prompt yet, options not filled in) previews gracefully — an empty prompt shows
 * a placeholder; an incomplete control renders empty rather than throwing.
 */
export function QuestionPreview({
  question,
  open,
  onToggle,
  loadImage,
}: {
  /** The question to preview, or `null` while it has no prompt yet. */
  question: Question | null;
  open: boolean;
  onToggle: () => void;
  loadImage: LoadImage;
}): JSX.Element {
  // Local, throwaway answers so the controls feel real without persisting anything (a dry run).
  const [answers, setAnswers] = useState<AnswerMap>({});
  const bodyId = useId();

  return (
    <div className={styles.previewPanel}>
      <button
        type="button"
        className={styles.previewHeader}
        aria-expanded={open}
        aria-controls={bodyId}
        aria-label={open ? 'Hide preview' : 'Show preview'}
        onClick={onToggle}
      >
        {open ? (
          <ChevronDown size={14} aria-hidden="true" />
        ) : (
          <ChevronRight size={14} aria-hidden="true" />
        )}
        <Text size="xs" weight={600}>
          Preview
        </Text>
      </button>

      {open ? (
        <div id={bodyId} className={styles.previewBody}>
          {question ? (
            <QuestionnaireForm
              questions={[question]}
              answers={answers}
              loadImage={loadImage}
              onChange={(id, value) => setAnswers((prev) => ({ ...prev, [id]: value }))}
              footer={<></>}
            />
          ) : (
            <Text size="sm" tone="tertiary">
              Add a prompt to preview this question.
            </Text>
          )}
        </div>
      ) : null}
    </div>
  );
}

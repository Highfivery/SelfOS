import { useState } from 'react';
import { unansweredRequired } from '@selfos/core/questionnaires';
import type { AnswerMap } from '@selfos/core/questionnaires';
import type { Question } from '@shared/schemas';
import { QuestionnaireForm } from '@selfos/answering';
import { Banner, Button, Stack } from '../../../design-system/components';
import { useQuestionnaireStore } from '../../../stores/questionnaireStore';
import { CrisisFooter } from '../sessions/CrisisFooter';
import styles from './Questionnaires.module.css';

/**
 * Preview / test-on-self (08-questionnaires §3.1): renders the questionnaire exactly as the recipient
 * sees it, fully interactive (branching + required behave live). It is a dry run — **nothing is ever
 * saved and no coaching Insight is produced**. "Finish" only checks that the required questions are
 * answered, then confirms (ephemerally) that nothing was kept.
 *
 * `readOnly` (the SENT/locked preview, §17.14f): drop the test-on-yourself "Finish" + required-validation —
 * a sent questionnaire is just shown for reference, so an interactive Finish there only confuses.
 */
export function QuestionnairePreview({
  questions,
  readOnly,
}: {
  questions: Question[];
  readOnly?: boolean;
}): JSX.Element {
  const getImage = useQuestionnaireStore((s) => s.getImage);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const onFinish = (): void => {
    const missing = unansweredRequired(questions, answers);
    setResult(
      missing.length === 0
        ? { ok: true, message: 'Looks good — this is a dry run, so nothing you entered was saved.' }
        : {
            ok: false,
            message: `Answer the ${missing.length} required question${
              missing.length === 1 ? '' : 's'
            } to finish.`,
          },
    );
  };

  return (
    <Stack gap={4}>
      <Banner tone="info">
        {readOnly
          ? 'This is exactly what your recipient sees.'
          : 'This is exactly what your recipient sees. Answer it to test on yourself — it’s a dry run, so nothing here is saved.'}
      </Banner>

      <QuestionnaireForm
        questions={questions}
        answers={answers}
        loadImage={getImage}
        onChange={(id, value) => {
          setResult(null);
          setAnswers((prev) => ({ ...prev, [id]: value }));
        }}
        footer={<CrisisFooter />}
      />

      {/* The test-on-yourself "Finish" + validation is for an UNSENT draft only — a sent questionnaire's
          preview is read-only, so no Finish there (it only confused). */}
      {readOnly ? null : (
        <>
          {result ? <Banner tone={result.ok ? 'info' : 'warning'}>{result.message}</Banner> : null}
          <div className={styles.footer}>
            <Button variant="primary" onClick={onFinish}>
              Finish
            </Button>
          </div>
        </>
      )}
    </Stack>
  );
}

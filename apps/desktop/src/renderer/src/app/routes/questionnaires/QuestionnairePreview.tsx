import { useState } from 'react';
import { unansweredRequired } from '@selfos/core/questionnaires';
import type { AnswerMap } from '@selfos/core/questionnaires';
import type { Question } from '@shared/schemas';
import { Banner, Button, Stack } from '../../../design-system/components';
import { QuestionnaireForm } from './QuestionnaireForm';
import styles from './Questionnaires.module.css';

/**
 * Preview / test-on-self (08-questionnaires §3.1): renders the questionnaire exactly as the recipient
 * sees it, fully interactive (branching + required behave live). It is a dry run — **nothing is ever
 * saved and no coaching Insight is produced**. "Finish" only checks that the required questions are
 * answered, then confirms (ephemerally) that nothing was kept.
 */
export function QuestionnairePreview({ questions }: { questions: Question[] }): JSX.Element {
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
        This is exactly what your recipient sees. Answer it to test on yourself — it’s a dry run, so
        nothing here is saved.
      </Banner>

      <QuestionnaireForm
        questions={questions}
        answers={answers}
        onChange={(id, value) => {
          setResult(null);
          setAnswers((prev) => ({ ...prev, [id]: value }));
        }}
      />

      {result ? <Banner tone={result.ok ? 'info' : 'warning'}>{result.message}</Banner> : null}

      <div className={styles.footer}>
        <Button variant="primary" onClick={onFinish}>
          Finish
        </Button>
      </div>
    </Stack>
  );
}

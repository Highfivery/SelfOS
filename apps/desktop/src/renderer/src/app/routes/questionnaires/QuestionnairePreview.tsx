import type { Question } from '@shared/schemas';
import { QuestionnaireForm } from '@selfos/answering';
import { Banner, Stack } from '../../../design-system/components';
import { useQuestionnaireStore } from '../../../stores/questionnaireStore';
import { CrisisFooter } from '../sessions/CrisisFooter';

/**
 * Preview (08-questionnaires §3.1/§20.4): a **read-only** render of the questionnaire exactly as the
 * recipient first sees it — every field disabled. It's purely for the author to review; there is no
 * test-on-self (the author built these questions, so answering them yourself makes no sense — §20.2), so
 * nothing is interactive and nothing is ever saved.
 *
 * A static, disabled render shows the **initially-visible** questions; branch-gated follow-ups reveal only
 * when their trigger is answered, so they appear in the author's **Edit** view (never hidden from the
 * author), not here (§20.4). The crisis footer stays interactive (§8.2).
 */
export function QuestionnairePreview({
  questions,
  recipientLabel,
}: {
  questions: Question[];
  /** Who this questionnaire is bound to (§17.3), so the note names them. Omit ⇒ a generic note. */
  recipientLabel?: string;
}): JSX.Element {
  const getImage = useQuestionnaireStore((s) => s.getImage);

  return (
    <Stack gap={4}>
      <Banner tone="info">
        {recipientLabel
          ? `This is exactly what ${recipientLabel} sees — read-only.`
          : 'This is exactly what your recipient sees — read-only.'}
      </Banner>

      <QuestionnaireForm
        questions={questions}
        answers={{}}
        loadImage={getImage}
        onChange={() => {}}
        footer={<CrisisFooter />}
        disabled
      />
    </Stack>
  );
}

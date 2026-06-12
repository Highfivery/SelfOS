import type { AlignmentReport, SendAnswer } from '@shared/schemas';
import { Banner, Stack, Text } from '../../../design-system/components';
import styles from './Questionnaires.module.css';

const AGREEMENT_LABEL = { aligned: 'Aligned', mixed: 'Mixed', divergent: 'Different' } as const;
const AGREEMENT_CLASS: Record<keyof typeof AGREEMENT_LABEL, string> = {
  aligned: styles.agreeAligned ?? '',
  mixed: styles.agreeMixed ?? '',
  divergent: styles.agreeDivergent ?? '',
};

/** A read-only list of answers (prompt + formatted answer) — shared by Results, reveal, and the Inbox. */
export function AnswerList({ answers }: { answers: SendAnswer[] }): JSX.Element {
  return (
    <dl className={styles.qaList}>
      {answers.map((qa, i) => (
        <div key={i} className={styles.qaItem}>
          <dt className={styles.qaPrompt}>{qa.prompt}</dt>
          <dd className={styles.qaAnswer}>{qa.answer === '' ? '—' : qa.answer}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The shared rendering of a compatibility alignment report (08-questionnaires §3.6) — summary + a
 * per-question agreement chip. Used by both the sender's Results and the answerer's Inbox joint report,
 * so the one report reads identically on both sides. A crisis flag leads with resources (§8.2).
 */
export function AlignmentReportView({ report }: { report: AlignmentReport }): JSX.Element {
  return (
    <Stack gap={3}>
      {report.crisisFlag ? (
        <Banner tone="warning">
          Something in these answers may need care. If anyone is in crisis, contact local emergency
          services or a crisis line (in the US, call or text 988).
        </Banner>
      ) : null}
      <Text>{report.summary}</Text>
      <Stack gap={2}>
        {report.items.map((item) => (
          <div key={item.canonicalId} className={styles.alignItem}>
            <div className={styles.alignHead}>
              <Text size="sm" weight={500}>
                {item.prompt}
              </Text>
              <span className={`${styles.agreeBadge} ${AGREEMENT_CLASS[item.agreement]}`}>
                {AGREEMENT_LABEL[item.agreement]}
              </span>
            </div>
            {item.note ? (
              <Text size="sm" tone="secondary">
                {item.note}
              </Text>
            ) : null}
          </div>
        ))}
      </Stack>
    </Stack>
  );
}

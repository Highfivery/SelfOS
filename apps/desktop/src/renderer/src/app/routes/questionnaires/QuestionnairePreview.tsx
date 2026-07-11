import { Clock, ListChecks } from 'lucide-react';
import { matrixRowLabel, type Question } from '@shared/schemas';
import { Markdown, QuestionImage } from '@selfos/answering';
import { Heading, Text } from '../../../design-system/components';
import { useQuestionnaireStore } from '../../../stores/questionnaireStore';
import { PrivacyChip } from './PrivacyChip';
import type { PrivacyBadge } from './privacyBadge';
import { CrisisFooter } from '../sessions/CrisisFooter';
import styles from './Questionnaires.module.css';

/**
 * Preview — a bespoke, READ-ONLY presentation of the questionnaire (08-questionnaires §21.2). This is NOT
 * the shared answering form (disabled or otherwise): the author built these questions, so re-answering them
 * makes no sense (§20.2). Instead we present a calm "as they'll see it" reading flow — a hero + meta strip
 * and a numbered list of questions, each with an *elegant static representation* of its control (a scale as
 * labelled endpoints, a text answer as a soft placeholder field, choices as quiet outline options). Nothing
 * is interactive; nothing is ever saved.
 *
 * The reading flow shows EVERY question, including branch-gated follow-ups (the author sees all questions;
 * a follow-up carries a subtle "Shown if …" caption so the conditional nature is clear — §20.4). The crisis
 * footer stays present + interactive (§8.2).
 */
export function QuestionnairePreview({
  questions,
  title,
  recipientLabel,
  privacyBadge,
}: {
  questions: Question[];
  /** The questionnaire title for the hero (falls back to a generic heading when blank). */
  title?: string;
  /** Who this questionnaire is bound to (§17.3), so the "as they see it" marker names them. */
  recipientLabel?: string;
  /** A known privacy promise — a compatibility def's visibility. A plain send's privacy is a send-time
   *  choice (§3.1), so the builder omits it here. */
  privacyBadge?: PrivacyBadge;
}): JSX.Element {
  const getImage = useQuestionnaireStore((s) => s.getImage);
  const count = questions.length;
  // A gentle time estimate — ~30s per question, floored at a minute so it never reads "0 min".
  const minutes = Math.max(1, Math.round(count / 2));

  return (
    <div className={styles.previewView}>
      <header className={styles.previewHero}>
        <span className={styles.eyebrowStatic}>Preview</span>
        <Heading level={2}>{title?.trim() ? title : 'Untitled questionnaire'}</Heading>
        <div className={styles.previewMeta}>
          <span className={styles.metaChip}>
            <ListChecks size={13} aria-hidden="true" />
            {count} {count === 1 ? 'question' : 'questions'}
          </span>
          <span className={styles.metaChip}>
            <Clock size={13} aria-hidden="true" />~{minutes} min
          </span>
          {privacyBadge ? <PrivacyChip badge={privacyBadge} /> : null}
        </div>
        {recipientLabel ? (
          <Text size="sm" tone="tertiary">
            As {recipientLabel} sees it
          </Text>
        ) : null}
      </header>

      <ol className={styles.readingFlow}>
        {questions.map((q, i) => (
          <li key={q.id} className={styles.flowRow}>
            <span className={styles.flowNum} aria-hidden="true">
              {i + 1}
            </span>
            <div className={styles.flowBody}>
              <div className={styles.flowPrompt}>
                <Markdown inline>{q.prompt || 'Untitled question'}</Markdown>
                {q.required ? (
                  <span className={styles.flowReq}>
                    <span aria-hidden="true">*</span>
                    <span className={styles.srOnly}> (required)</span>
                  </span>
                ) : null}
              </div>
              {q.help ? (
                <Text size="xs" tone="tertiary">
                  {q.help}
                </Text>
              ) : null}
              {q.media ? <QuestionImage media={q.media} loadImage={getImage} /> : null}
              <QuestionReadOnly
                question={q}
                {...(recipientLabel ? { recipient: recipientLabel } : {})}
              />
              {q.branch ? (
                <Text size="xs" tone="tertiary">
                  Shown only when an earlier answer matches.
                </Text>
              ) : null}
            </div>
          </li>
        ))}
      </ol>

      <Text size="sm" tone="secondary">
        This is a read-only preview
        {recipientLabel ? ` — ${recipientLabel} hasn’t answered yet.` : '.'}
      </Text>

      <CrisisFooter />
    </div>
  );
}

/**
 * The elegant static representation of a single question's control — never an interactive or disabled
 * input, just a quiet visual of how the answer will be given.
 */
function QuestionReadOnly({
  question,
  recipient,
}: {
  question: Question;
  recipient?: string;
}): JSX.Element {
  // Questionnaires are recipient-bound (§17.3), so the named path ("Angel writes…") is the norm; the
  // singular "Someone" fallback keeps subject–verb agreement when a preview has no bound recipient yet.
  const who = recipient ?? 'Someone';
  const q = question;

  switch (q.type) {
    case 'shortText':
      return (
        <div className={styles.roField}>{q.placeholder || `${who} writes a short answer…`}</div>
      );
    case 'longText':
      return (
        <div className={`${styles.roField} ${styles.roFieldTall}`}>
          {q.placeholder || `${who} writes their answer here…`}
        </div>
      );
    case 'date':
      return <div className={styles.roField}>{who} picks a date…</div>;
    case 'dateList':
      return <div className={styles.roField}>{who} adds one or more dates…</div>;
    case 'yesNo':
      return (
        <div className={styles.roOptions}>
          <span className={styles.roOption}>Yes</span>
          <span className={styles.roOption}>No</span>
        </div>
      );
    case 'singleChoice':
    case 'multiChoice':
    case 'thisOrThat': {
      const opts = q.options ?? [];
      const multi = q.type === 'multiChoice';
      return (
        <div className={styles.roOptions}>
          {opts.map((o, i) => (
            <span key={i} className={styles.roOption}>
              <span className={multi ? styles.roBox : styles.roDot} aria-hidden="true" />
              {o}
            </span>
          ))}
          {q.allowOther ? <span className={styles.roOption}>Other…</span> : null}
          {opts.length === 0 ? <span className={styles.roMuted}>No options yet</span> : null}
        </div>
      );
    }
    case 'ranking': {
      const opts = q.options ?? [];
      return (
        <ol className={styles.roRank}>
          {opts.map((o, i) => (
            <li key={i} className={styles.roRankRow}>
              <span className={styles.roRankNum}>{i + 1}</span>
              {o}
            </li>
          ))}
          {opts.length === 0 ? <span className={styles.roMuted}>No options yet</span> : null}
        </ol>
      );
    }
    case 'allocation': {
      const opts = q.options ?? [];
      return (
        <div className={styles.roAlloc}>
          {opts.map((o, i) => (
            <div key={i} className={styles.roAllocRow}>
              <span>{o}</span>
              <span className={styles.roMuted}>— / 100</span>
            </div>
          ))}
          {opts.length === 0 ? <span className={styles.roMuted}>No buckets yet</span> : null}
        </div>
      );
    }
    case 'rating':
    case 'slider': {
      const min = q.scale?.min ?? 1;
      const max = q.scale?.max ?? 5;
      const minLabel = q.scale?.minLabel ?? String(min);
      const maxLabel = q.scale?.maxLabel ?? String(max);
      const points = q.type === 'rating' ? Math.min(Math.max(max - min + 1, 2), 11) : 0;
      return (
        <div className={styles.roScale}>
          <span className={styles.roScaleEnd}>{minLabel}</span>
          <span className={styles.roScaleTrack} aria-hidden="true">
            {q.type === 'rating'
              ? Array.from({ length: points }, (_, i) => (
                  <span key={i} className={styles.roScaleDot} />
                ))
              : null}
          </span>
          <span className={styles.roScaleEnd}>{maxLabel}</span>
        </div>
      );
    }
    case 'matrix': {
      const rows = q.matrix?.rows ?? [];
      const min = q.matrix?.min ?? 1;
      const max = q.matrix?.max ?? 5;
      const heads =
        q.matrix?.pointLabels ??
        [q.matrix?.minLabel ?? String(min), q.matrix?.maxLabel ?? String(max)].filter(Boolean);
      return (
        <div className={styles.roMatrix}>
          <div className={styles.roMatrixScale}>
            {heads.map((h, i) => (
              <span key={i}>{h}</span>
            ))}
          </div>
          {rows.map((r, i) => (
            <div key={i} className={styles.roMatrixRow}>
              {matrixRowLabel(r)}
            </div>
          ))}
          {rows.length === 0 ? <span className={styles.roMuted}>No rows yet</span> : null}
        </div>
      );
    }
    case 'roster': {
      const cols = q.roster ?? [];
      return (
        <div className={styles.roRoster}>
          {cols.map((c, i) => (
            <span key={i} className={styles.roRosterCol}>
              {c.label}
            </span>
          ))}
          {cols.length === 0 ? <span className={styles.roMuted}>No fields yet</span> : null}
        </div>
      );
    }
    default:
      return <div className={styles.roField}>{who} answers…</div>;
  }
}

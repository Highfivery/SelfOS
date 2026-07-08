import { Check, Clock, Star } from 'lucide-react';
import type {
  Questionnaire,
  QuestionnaireSendState,
  QuestionnaireSentOverview,
  SentRecipientSummary,
} from '@shared/channels';
import { IconButton } from '../../../design-system/components';
import { Avatar } from './Avatar';
import { QuestionnaireRowMenu } from './QuestionnaireRowMenu';
import { QUESTIONNAIRE_TYPES } from './questionnaireTypes';
import { formatSentDate, resendStatus } from './sentState';
import styles from './Questionnaires.module.css';

/** Built-in type → its human label; a custom type is already a human string, so fall back to it. */
function typeLabel(type: string): string {
  return QUESTIONNAIRE_TYPES.find((t) => t.value === type)?.label ?? type;
}

/** How many recipient chips to show before collapsing the rest into "+N". */
const MAX_CHIPS = 3;

/** The status pill for a sent card — text carries the meaning, colour is supplementary (§9). */
function sentStatus(overview: QuestionnaireSentOverview): {
  label: string;
  tone: 'ok' | 'wait' | 'done';
} {
  const total = overview.recipients.length;
  const answered = overview.answeredCount;
  if (total === 0) return { label: 'Sent', tone: 'wait' };
  if (answered === 0) return { label: 'Awaiting response', tone: 'wait' };
  if (answered < total) return { label: `${answered} of ${total} answered`, tone: 'ok' };
  // Everyone answered. No un-analysed responses left ⇒ the sender has already reviewed them.
  return { label: overview.newResponses === 0 ? 'Answered · analysed' : 'Answered', tone: 'done' };
}

function RecipientChip({ recipient }: { recipient: SentRecipientSummary }): JSX.Element {
  return (
    <span className={styles.rchip}>
      <Avatar name={recipient.name} />
      <span className={styles.rchipName}>{recipient.name}</span>
      {recipient.answered ? (
        <Check
          size={13}
          role="img"
          className={`${styles.stateDot} ${styles.stateOk}`}
          aria-label="answered"
        />
      ) : (
        <Clock
          size={13}
          role="img"
          className={`${styles.stateDot} ${styles.stateWait}`}
          aria-label="awaiting"
        />
      )}
    </span>
  );
}

/**
 * One card in the redesigned Questionnaires landing "Sent" section (08 §3.1) — a questionnaire the active
 * person authored. Shows the type, title, favourite, recipient chips with per-person answered state, a rich
 * status pill, a "N new" badge for un-reviewed responses, and a re-send nudge. A never-sent-yet definition
 * that isn't valid to send renders as a Draft. Opening it (title/card) drops into the builder.
 */
export function SentCard({
  questionnaire,
  overview,
  sendState,
  isDraft,
  onOpen,
  onToggleFavorite,
  onShare,
  onDelete,
}: {
  questionnaire: Questionnaire;
  overview?: QuestionnaireSentOverview;
  sendState?: QuestionnaireSendState;
  isDraft: boolean;
  onOpen: () => void;
  onToggleFavorite: () => void;
  onShare?: () => void;
  onDelete: () => void;
}): JSX.Element {
  const sent = Boolean(sendState);
  const recipients = overview?.recipients ?? [];
  const shown = recipients.slice(0, MAX_CHIPS);
  const overflow = recipients.length - shown.length;
  const newCount = overview?.newResponses ?? 0;
  const status = sent && overview ? sentStatus(overview) : null;
  const resend = sendState ? resendStatus(sendState.lastSentAt) : null;

  return (
    <article className={`${styles.card} ${styles.sentCard} ${isDraft ? styles.draftCard : ''}`}>
      {newCount > 0 ? <span className={styles.newDot}>{newCount} new</span> : null}
      <div className={styles.cardTop}>
        <span className={styles.eyebrow}>{typeLabel(questionnaire.type)}</span>
        <IconButton
          variant="ghost"
          aria-label={
            questionnaire.favorite
              ? `Unpin “${questionnaire.title}”`
              : `Pin “${questionnaire.title}”`
          }
          aria-pressed={questionnaire.favorite ?? false}
          onClick={onToggleFavorite}
        >
          <Star
            size={16}
            aria-hidden="true"
            {...(questionnaire.favorite ? { fill: 'currentColor' } : {})}
          />
        </IconButton>
        <QuestionnaireRowMenu
          title={questionnaire.title}
          {...(onShare ? { onShare } : {})}
          onDelete={onDelete}
        />
      </div>

      <button type="button" className={styles.cardTitleButton} onClick={onOpen}>
        {questionnaire.title}
      </button>

      {shown.length > 0 ? (
        <div className={styles.recips}>
          {shown.map((r, i) => (
            <RecipientChip key={`${r.name}-${i}`} recipient={r} />
          ))}
          {overflow > 0 ? <span className={styles.rchipMore}>+{overflow}</span> : null}
        </div>
      ) : null}

      <div className={styles.cardFoot}>
        {isDraft ? (
          <span className={`${styles.pill} ${styles.pillDraft}`}>Draft · not sent</span>
        ) : status ? (
          <span className={`${styles.pill} ${statusPill(status.tone)}`}>{status.label}</span>
        ) : sent ? (
          <span className={`${styles.pill} ${styles.pillDone}`}>Sent</span>
        ) : (
          <span className={`${styles.pill} ${styles.pillDraft}`}>Not sent yet</span>
        )}
      </div>

      <div className={styles.cardMeta}>
        <span>
          {questionnaire.questions.length}{' '}
          {questionnaire.questions.length === 1 ? 'question' : 'questions'}
        </span>
        {sendState ? <span>· Sent {formatSentDate(sendState.lastSentAt)}</span> : null}
        {resend?.ready ? <span className={styles.resendNudge}>· Ready to re-send</span> : null}
      </div>
    </article>
  );
}

/** Map a status tone to its pill modifier class. */
function statusPill(tone: 'ok' | 'wait' | 'done'): string {
  if (tone === 'ok') return styles.pillOk ?? '';
  if (tone === 'wait') return styles.pillWait ?? '';
  return styles.pillDone ?? '';
}

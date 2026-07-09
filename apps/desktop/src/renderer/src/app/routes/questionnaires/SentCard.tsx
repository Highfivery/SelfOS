import { useNavigate } from 'react-router-dom';
import { Check, Clock, Eye, Link2, RefreshCw, Sparkles, Star } from 'lucide-react';
import type {
  Questionnaire,
  QuestionnaireSendState,
  QuestionnaireSentOverview,
  SentRecipientSummary,
} from '@shared/channels';
import { Button, IconButton } from '../../../design-system/components';
import { Avatar } from './Avatar';
import { InsightExcerpt } from './InsightExcerpt';
import { QuestionnaireRowMenu } from './QuestionnaireRowMenu';
import { QUESTIONNAIRE_TYPES } from './questionnaireTypes';
import { formatDateTime, relativeAge, resendStatus } from './sentState';
import styles from './Questionnaires.module.css';

/** Built-in type → its human label; a custom type is already a human string, so fall back to it. */
function typeLabel(type: string): string {
  return QUESTIONNAIRE_TYPES.find((t) => t.value === type)?.label ?? type;
}

/** How many recipient chips to show before collapsing the rest into "+N". */
const MAX_CHIPS = 3;

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
 * person authored. Shows the type, title, favourite + share-link + view + more actions, recipient chips with
 * per-person answered state, and a state-aware body: a Draft, an awaiting/answered status, a one-tap Analyze
 * prompt (answered-not-analysed), an Insight excerpt (analysed), and a gentle "ask again" nudge when the
 * answers are stale. Sent + answered times show as date · time.
 */
export function SentCard({
  questionnaire,
  overview,
  sendState,
  isDraft,
  confirmingDelete,
  analyzing,
  onOpen,
  onToggleFavorite,
  onShare,
  onDuplicate,
  onAnalyze,
  onDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  questionnaire: Questionnaire;
  overview?: QuestionnaireSentOverview;
  sendState?: QuestionnaireSendState;
  isDraft: boolean;
  confirmingDelete: boolean;
  analyzing?: boolean;
  onOpen: () => void;
  onToggleFavorite: () => void;
  onShare?: () => void;
  onDuplicate: () => void;
  onAnalyze: (assignmentId: string) => void;
  onDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}): JSX.Element {
  const navigate = useNavigate();
  const sent = Boolean(sendState);
  const recipients = overview?.recipients ?? [];
  const shown = recipients.slice(0, MAX_CHIPS);
  const overflow = recipients.length - shown.length;
  const newCount = overview?.newResponses ?? 0;
  const answeredCount = overview?.answeredCount ?? 0;
  const total = recipients.length;
  const analyzable = overview?.analyzableAssignmentId;
  const analyzed = overview?.analyzed ?? false;
  // The re-ask nudge: answers exist, the whole thing is analysed (nothing new to do), and enough time has
  // passed that fresher answers would be worth it.
  const stale =
    sent &&
    analyzed &&
    !analyzable &&
    Boolean(sendState && resendStatus(sendState.lastSentAt).ready) &&
    Boolean(overview?.answeredAt);

  return (
    <article className={`${styles.card} ${styles.sentCard} ${isDraft ? styles.draftCard : ''}`}>
      {newCount > 0 ? <span className={styles.newDot}>{newCount} new</span> : null}

      <div className={styles.cardTop}>
        <span className={styles.eyebrow}>{typeLabel(questionnaire.type)}</span>
        <div className={styles.cardIcons}>
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
          {onShare ? (
            <IconButton
              variant="ghost"
              aria-label="Copy share link"
              title="Copy share link"
              onClick={onShare}
            >
              <Link2 size={16} aria-hidden="true" />
            </IconButton>
          ) : null}
          {sent ? (
            <IconButton
              variant="ghost"
              aria-label="See what was sent"
              title="See what was sent"
              onClick={onOpen}
            >
              <Eye size={16} aria-hidden="true" />
            </IconButton>
          ) : null}
          <QuestionnaireRowMenu
            title={questionnaire.title}
            {...(sent ? { onDuplicate } : {})}
            onDelete={onDelete}
          />
        </div>
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

      {/* Analysed → the Insight excerpt; answered-not-analysed → a one-tap Analyze prompt (parallel styles). */}
      {analyzed && overview?.insightSummary ? (
        <InsightExcerpt
          summary={overview.insightSummary}
          onViewInMemory={() =>
            navigate(
              '/memory',
              overview.insightId ? { state: { insightId: overview.insightId } } : undefined,
            )
          }
        />
      ) : analyzable ? (
        <div className={styles.analyzePrompt} aria-busy={analyzing ?? false}>
          <span>Responses are in.</span>
          <button
            type="button"
            className={styles.analyzeGo}
            disabled={analyzing ?? false}
            onClick={() => onAnalyze(analyzable)}
          >
            <Sparkles size={13} aria-hidden="true" />
            {analyzing ? 'Analyzing…' : 'Analyze to see the insight →'}
          </button>
        </div>
      ) : null}

      {stale && overview?.answeredAt ? (
        <div className={styles.refreshPrompt}>
          <RefreshCw size={15} aria-hidden="true" className={styles.refreshIcon} />
          <span>
            These answers are <strong>{relativeAge(overview.answeredAt)}</strong>. Check in again —{' '}
            <button type="button" className={styles.refreshGo} onClick={onDuplicate}>
              duplicate &amp; send for fresh answers →
            </button>
          </span>
        </div>
      ) : null}

      <div className={styles.cardFoot}>
        {isDraft ? (
          <span className={`${styles.pill} ${styles.pillDraft}`}>Draft · not ready</span>
        ) : analyzed ? (
          <span className={`${styles.pill} ${styles.pillDone}`}>
            <Sparkles size={12} aria-hidden="true" />
            Analyzed
          </span>
        ) : answeredCount > 0 && answeredCount === total ? (
          <span className={`${styles.pill} ${styles.pillOk}`}>
            <Check size={12} aria-hidden="true" />
            Answered
          </span>
        ) : answeredCount > 0 ? (
          <span className={`${styles.pill} ${styles.pillOk}`}>
            {answeredCount} of {total} answered
          </span>
        ) : sent ? (
          <span className={`${styles.pill} ${styles.pillWait}`}>
            <Clock size={12} aria-hidden="true" />
            Awaiting response
          </span>
        ) : (
          <span className={`${styles.pill} ${styles.pillDraft}`}>Not sent yet</span>
        )}
      </div>

      <div className={styles.cardMeta}>
        <span>
          {questionnaire.questions.length}{' '}
          {questionnaire.questions.length === 1 ? 'question' : 'questions'}
        </span>
        {sendState ? <span>· Sent {formatDateTime(sendState.lastSentAt)}</span> : null}
        {overview?.answeredAt ? (
          <span>· Answered {formatDateTime(overview.answeredAt)}</span>
        ) : null}
      </div>

      {confirmingDelete ? (
        <div
          className={styles.confirmRow}
          role="group"
          aria-label={`Delete ${questionnaire.title}?`}
        >
          <span className={styles.confirmText}>
            {sent
              ? 'Delete this? It removes the questionnaire, any responses, and insights drawn from them.'
              : 'Delete this draft? This can’t be undone.'}
          </span>
          <div className={styles.confirmActions}>
            <Button variant="primary" onClick={onConfirmDelete}>
              Delete
            </Button>
            <Button variant="secondary" onClick={onCancelDelete}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

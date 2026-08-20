import { useNavigate } from 'react-router-dom';
import { BookOpen, Bot, Check, Clock, RefreshCw, SkipForward, Sparkles, Star } from 'lucide-react';
import type {
  Questionnaire,
  SkipSummary,
  QuestionnaireSendState,
  QuestionnaireSentOverview,
  SentRecipientSummary,
} from '@shared/channels';
import { Button, IconButton } from '../../../design-system/components';
import { Avatar } from './Avatar';
import { InsightExcerpt } from './InsightExcerpt';
import { PrivacyChip } from './PrivacyChip';
import { sentCompatibilityBadge, sentPrivacyBadge } from './privacyBadge';
import { QuestionnaireRowMenu } from './QuestionnaireRowMenu';
import { QUESTIONNAIRE_TYPES } from './questionnaireTypes';
import { formatDateTime, relativeAge, resendStatus } from './sentState';
import styles from './Questionnaires.module.css';

/** Built-in type → its human label; a custom type is already a human string, so fall back to it. */
function typeLabel(type: string): string {
  return QUESTIONNAIRE_TYPES.find((t) => t.value === type)?.label ?? type;
}

/**
 * The skip breakdown as readable chips, commonest-first. Counts only — never the recipient's own words,
 * which on a Private send they were promised the sender would not see (08 §34.2).
 */
function skipKindLabels(summary: SkipSummary): string[] {
  const named: [keyof SkipSummary['byKind'], string][] = [
    ['unclear', 'unclear'],
    ['not-applicable', 'doesn’t apply'],
    ['prefer-not-to-say', 'preferred not to say'],
    ['other', 'no reason given'],
  ];
  return named
    .filter(([kind]) => summary.byKind[kind] > 0)
    .map(([kind, label]) => `${summary.byKind[kind]} ${label}`);
}

/** How many recipient chips to show before collapsing the rest into "+N". */
const MAX_CHIPS = 3;

function RecipientChip({ recipient }: { recipient: SentRecipientSummary }): JSX.Element {
  const state = recipient.answered ? 'answered' : 'awaiting a response';
  return (
    <span className={styles.rchip} title={`${recipient.name} — ${state}`}>
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
          aria-label="awaiting a response"
        />
      )}
    </span>
  );
}

/**
 * One card in the redesigned Questionnaires landing "Sent" section (08 §3.1) — a questionnaire the active
 * person authored. Shows the type, title, favourite + a ⋯ menu (view · share link · duplicate · delete —
 * two icons, not four, so the type label has room to read; §33), recipient chips with
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
  analyzingOther,
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
  /** Another questionnaire on this page is currently being analyzed — only one runs at a time, so this
   * card's Analyze action is unavailable until it finishes (08 §3.1). */
  analyzingOther?: boolean;
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
  // Provenance (08 §3.1): a questionnaire SelfOS generated for you — from the biographer (Your Story) or the
  // auto check-in engine — is stamped, so the Sent card can say so and never read as a hand-authored send you
  // don't recognise (the "why is this in my Sent list?" confusion). Recipient side already labels these.
  const provenance: 'biographer' | 'auto' | null = questionnaire.storyProvenance
    ? 'biographer'
    : questionnaire.autoCheckin
      ? 'auto'
      : null;
  const sent = Boolean(sendState);
  const recipients = overview?.recipients ?? [];
  const shown = recipients.slice(0, MAX_CHIPS);
  const overflow = recipients.length - shown.length;
  const newCount = overview?.newResponses ?? 0;
  const answeredCount = overview?.answeredCount ?? 0;
  const total = recipients.length;
  const analyzable = overview?.analyzableAssignmentId;
  // A response that came back with NOTHING answered (08 §34). It is not "awaiting" and it is not
  // analysable — `analyzeAssignment` bails before the model — so it gets a state of its own rather than an
  // action that cannot succeed. The breakdown is counts only, which is what makes it safe to show for a
  // Private send too: the recipient's written reasons never cross the bridge.
  const skipped = overview?.skipped;
  const analyzed = overview?.analyzed ?? false;
  // The re-ask nudge: answers exist, the whole thing is analysed (nothing new to do), and enough time has
  // passed that fresher answers would be worth it.
  const stale =
    sent &&
    analyzed &&
    !analyzable &&
    !skipped && // "These answers are 3 weeks old" is nonsense when there were no answers (§34).
    Boolean(sendState && resendStatus(sendState.lastSentAt).ready) &&
    Boolean(overview?.answeredAt);
  // The privacy chip (08 §3.1): only once sent — privacy is chosen at send, so a draft/never-sent card
  // shows nothing. A compatibility card states its visibility mode (the definition carries it, so it shows
  // even when `sentOverview` is unavailable); otherwise the recipients' latest-send privacy from the overview.
  const privacyBadge = !sent
    ? null
    : questionnaire.compatibility
      ? sentCompatibilityBadge(questionnaire.compatibility.visibility)
      : overview?.privacy
        ? sentPrivacyBadge(overview.privacy)
        : null;

  return (
    <article className={`${styles.card} ${isDraft ? styles.draftCard : ''}`}>
      {newCount > 0 ? <span className={styles.newDot}>{newCount} new</span> : null}

      <div className={styles.cardTop}>
        {/* Ellipsises at phone width, so carry the full label — same reason as the title below. */}
        <span className={styles.eyebrow} title={typeLabel(questionnaire.type)}>
          {typeLabel(questionnaire.type)}
        </span>
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
          <QuestionnaireRowMenu
            title={questionnaire.title}
            {...(sent ? { onView: onOpen } : {})}
            {...(onShare ? { onShare } : {})}
            {...(sent ? { onDuplicate } : {})}
            onDelete={onDelete}
          />
        </div>
      </div>

      {/* Clamped to 2 lines, so carry the full title in `title` — otherwise a long one is unrecoverable. */}
      <button
        type="button"
        className={styles.cardTitleButton}
        title={questionnaire.title}
        onClick={onOpen}
      >
        {questionnaire.title}
      </button>

      <div className={styles.cardFoot}>
        {isDraft ? (
          <span className={`${styles.pill} ${styles.pillDraft}`}>Draft · not ready</span>
        ) : skipped ? (
          <span className={`${styles.pill} ${styles.pillSkipped}`}>
            <SkipForward size={12} aria-hidden="true" />
            {skipped.total === skipped.visible
              ? `No answers · all ${skipped.visible} skipped`
              : `No answers · ${skipped.total} skipped`}
          </span>
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
        {provenance ? (
          <span
            className={`${styles.pill} ${styles.pillAuto}`}
            title={
              provenance === 'biographer'
                ? 'SelfOS created this for your story — you didn’t send it by hand.'
                : 'SelfOS created this from your Auto check-ins — you didn’t send it by hand.'
            }
          >
            {provenance === 'biographer' ? (
              <BookOpen size={12} aria-hidden="true" />
            ) : (
              <Bot size={12} aria-hidden="true" />
            )}
            {provenance === 'biographer' ? 'From your biographer' : 'Auto check-in'}
          </span>
        ) : null}
        {privacyBadge ? <PrivacyChip badge={privacyBadge} /> : null}
      </div>

      {shown.length > 0 ? (
        <div className={styles.recips}>
          <span className={styles.recipsLabel}>Sent to</span>
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
      ) : analyzable && !skipped ? (
        <div className={styles.analyzePrompt} aria-busy={analyzing ?? false}>
          <span>Responses are in.</span>
          {analyzingOther && !analyzing ? (
            // Only one analysis runs at a time — a calm "queued" status, not a disabled button labelled with a
            // scary "unavailable" sentence (which reads as broken rather than momentarily busy, 08 §3.1).
            <span className={styles.analyzeWaiting} role="status">
              <Clock size={13} aria-hidden="true" />
              Waiting for another analysis to finish…
            </span>
          ) : (
            <button
              type="button"
              className={styles.analyzeGo}
              disabled={analyzing ?? false}
              onClick={() => onAnalyze(analyzable)}
            >
              <Sparkles size={13} aria-hidden="true" />
              {analyzing ? 'Analyzing…' : 'Analyze to see the insight →'}
            </button>
          )}
        </div>
      ) : null}

      {skipped ? (
        <div className={styles.skipPrompt}>
          <span className={styles.zoneLabel}>Why it didn’t land</span>
          <span className={styles.skipCounts}>
            {skipKindLabels(skipped).map((label) => (
              <span key={label} className={`${styles.pill} ${styles.pillSkipped}`}>
                {label}
              </span>
            ))}
          </span>
          {/* On a Standard send the refusal itself can be read (§34.3); a Private one has nothing we may
              say, so it shows the counts and stops there. */}
          {analyzable ? (
            <button
              type="button"
              className={styles.analyzeGo}
              disabled={analyzing ?? false}
              onClick={() => onAnalyze(analyzable)}
            >
              <Sparkles size={13} aria-hidden="true" />
              {analyzing ? 'Reading…' : 'Read what this tells you →'}
            </button>
          ) : null}
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

      <div className={styles.cardMeta}>
        <span>
          {questionnaire.questions.length}{' '}
          {questionnaire.questions.length === 1 ? 'question' : 'questions'}
        </span>
        {sendState ? <span>· Sent {formatDateTime(sendState.lastSentAt)}</span> : null}
        {/* "Answered" would contradict the pill directly on a send where nothing was: it came back, which
            is a real event worth dating, but it is not an answer (§34). */}
        {overview?.answeredAt ? (
          <span>
            · {skipped ? 'Came back' : 'Answered'} {formatDateTime(overview.answeredAt)}
          </span>
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

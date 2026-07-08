import { Eye, PencilLine, Play, Star } from 'lucide-react';
import type { InboxItem } from '@shared/channels';
import { IconButton } from '../../../design-system/components';
import { receivedCta, receivedStatus } from '../inbox/inboxStatus';
import { Avatar } from './Avatar';
import { QUESTIONNAIRE_TYPES } from './questionnaireTypes';
import { formatDateTime } from './sentState';
import styles from './Questionnaires.module.css';

/** Built-in type → its human label; a custom type is already a human string, so fall back to it. */
function typeLabel(type: string): string {
  return QUESTIONNAIRE_TYPES.find((t) => t.value === type)?.label ?? type;
}

/** The CTA icon that matches the verb (Answer / Continue / View). */
function CtaIcon({ cta }: { cta: string }): JSX.Element {
  if (cta === 'View') return <Eye size={15} aria-hidden="true" />;
  if (cta === 'Continue') return <Play size={15} aria-hidden="true" />;
  return <PencilLine size={15} aria-hidden="true" />;
}

/**
 * One card in the redesigned Questionnaires landing "Received" section (08 §3.3) — a questionnaire sent to
 * the active person, mirrored here (the standalone Inbox route stays). Shows the category, who's asking, a
 * status pill, received/answered times, a favourite pin, and a state-matched CTA.
 */
export function ReceivedCard({
  item,
  onOpen,
  onToggleFavorite,
}: {
  item: InboxItem;
  onOpen: () => void;
  onToggleFavorite: () => void;
}): JSX.Element {
  const status = receivedStatus(item);
  const cta = receivedCta(item);
  const sender = item.senderName ?? 'Someone';
  return (
    <article className={`${styles.card} ${styles.receivedCard}`}>
      {status.isNew ? <span className={styles.newDot}>New</span> : null}
      <div className={styles.cardTop}>
        <span className={styles.eyebrow}>{typeLabel(item.type)}</span>
        <div className={styles.cardIcons}>
          <IconButton
            variant="ghost"
            aria-label={item.favorite ? `Unpin “${item.title}”` : `Pin “${item.title}”`}
            aria-pressed={item.favorite}
            onClick={onToggleFavorite}
          >
            <Star
              size={16}
              aria-hidden="true"
              {...(item.favorite ? { fill: 'currentColor' } : {})}
            />
          </IconButton>
        </div>
      </div>

      <span className={styles.from}>
        <Avatar name={sender} />
        From {sender}
      </span>

      <button type="button" className={styles.cardTitleButton} onClick={onOpen}>
        {item.title}
      </button>

      {!status.isNew ? (
        <div className={styles.cardFoot}>
          <span
            className={`${styles.pill} ${
              status.label === 'Submitted'
                ? styles.pillDone
                : status.label === 'In progress'
                  ? styles.pillWait
                  : styles.pillDraft
            }`}
          >
            {status.label}
          </span>
        </div>
      ) : null}

      <div className={styles.cardMeta}>
        <span>
          {item.questionCount} {item.questionCount === 1 ? 'question' : 'questions'}
        </span>
        <span>· Received {formatDateTime(item.createdAt)}</span>
        {item.answeredAt ? <span>· Answered {formatDateTime(item.answeredAt)}</span> : null}
        {item.hasDraft ? <span>· draft saved</span> : null}
      </div>

      <button
        type="button"
        className={`${styles.rcta} ${status.isNew ? styles.rctaGo : ''}`}
        onClick={onOpen}
      >
        <CtaIcon cta={cta} />
        {cta}
      </button>
    </article>
  );
}

import { Eye, PencilLine, Play } from 'lucide-react';
import type { InboxItem } from '@shared/channels';
import { receivedCta, receivedStatus } from '../inbox/inboxStatus';
import { Avatar } from './Avatar';
import styles from './Questionnaires.module.css';

/** The CTA icon that matches the verb (Answer / Continue / View). */
function CtaIcon({ cta }: { cta: string }): JSX.Element {
  if (cta === 'View') return <Eye size={15} aria-hidden="true" />;
  if (cta === 'Continue') return <Play size={15} aria-hidden="true" />;
  return <PencilLine size={15} aria-hidden="true" />;
}

/**
 * One card in the redesigned Questionnaires landing "Received" section (08 §3.3) — a questionnaire sent to
 * the active person, mirrored here for convenience (the standalone Inbox route stays). Shows who's asking,
 * a status pill, and a state-matched CTA. Opening it drops into the shared answering pane.
 */
export function ReceivedCard({
  item,
  onOpen,
}: {
  item: InboxItem;
  onOpen: () => void;
}): JSX.Element {
  const status = receivedStatus(item);
  const cta = receivedCta(item);
  const sender = item.senderName ?? 'Someone';
  return (
    <article className={`${styles.card} ${styles.receivedCard}`}>
      {status.isNew ? <span className={styles.newDot}>New</span> : null}
      <div className={styles.cardTop}>
        <span className={styles.from}>
          <Avatar name={sender} />
          From {sender}
        </span>
        {!status.isNew ? (
          <span
            className={`${styles.pill} ${status.label === 'Submitted' ? styles.pillDone : status.label === 'In progress' ? styles.pillWait : styles.pillDraft}`}
          >
            {status.label}
          </span>
        ) : null}
      </div>

      <button type="button" className={styles.cardTitleButton} onClick={onOpen}>
        {item.title}
      </button>

      <div className={styles.cardMeta}>
        {item.questionCount} {item.questionCount === 1 ? 'question' : 'questions'}
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

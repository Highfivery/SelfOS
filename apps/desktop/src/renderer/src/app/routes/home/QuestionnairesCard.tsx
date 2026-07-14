import { useNavigate } from 'react-router-dom';
import { ClipboardList } from 'lucide-react';
import type { Person, QuestionnaireSentOverview } from '@shared/schemas';
import {
  Button,
  Card,
  Heading,
  ProportionBar,
  Stack,
  Text,
} from '../../../design-system/components';
import styles from './Home.module.css';

/**
 * The compact Questionnaires bento card (60 §3.1.5/§3.6) — folds the spec-59 Home section into a card that
 * matches the rest of the bento (the full authoring/results experience lives on `/questionnaires`). Shows the
 * response rate, the actionable "needs you" (new answers to review / questionnaires waiting for you to
 * answer), and who you haven't asked — each an acted-on link. Self-hides when there's nothing to show and the
 * person can't create. No raw answers cross here (the sent overview is the sender's own derived view, 59).
 */
export function QuestionnairesCard({
  sentOverview,
  inboxCount,
  people,
  subjectPersonId,
  canCreate,
  canViewResults,
}: {
  sentOverview: Record<string, QuestionnaireSentOverview>;
  inboxCount: number;
  people: Person[];
  subjectPersonId: string | null;
  canCreate: boolean;
  canViewResults: boolean;
}): JSX.Element | null {
  const navigate = useNavigate();
  const overviews = Object.values(sentOverview);

  const totalRecipients = overviews.reduce((n, o) => n + o.recipients.length, 0);
  const totalAnswered = overviews.reduce(
    (n, o) => n + o.recipients.filter((r) => r.answered).length,
    0,
  );
  const newResponses = overviews.reduce((n, o) => n + o.newResponses, 0);

  const asked = new Set(overviews.flatMap((o) => o.recipients.map((r) => r.name)));
  const notAsked = people
    .filter((p) => p.isSubject && p.id !== subjectPersonId && !asked.has(p.displayName))
    .map((p) => p.displayName);

  // Nothing to show and can't author → self-hide (the "ask someone" starter lives in the quick dock).
  if (overviews.length === 0 && inboxCount === 0 && !canCreate) return null;

  return (
    <Card>
      <Stack gap={3}>
        <div className={styles.cardHead}>
          <Heading level={2} className={styles.sectionTitle}>
            <ClipboardList size={16} aria-hidden="true" /> Questionnaires
          </Heading>
          <button
            type="button"
            className={styles.cardLink}
            onClick={() => navigate('/questionnaires')}
          >
            {overviews.length > 0 ? 'Open' : 'Create'}
          </button>
        </div>

        {totalRecipients > 0 ? (
          <ProportionBar label="Answered" value={totalAnswered} total={totalRecipients} />
        ) : overviews.length === 0 && inboxCount === 0 ? (
          <Text tone="secondary" size="sm">
            Ask someone what they really think — send a questionnaire and turn the answers into
            insight.
          </Text>
        ) : null}

        <Stack gap={1}>
          {canViewResults && newResponses > 0 ? (
            <button
              type="button"
              className={styles.cardLink}
              onClick={() => navigate('/questionnaires')}
            >
              {newResponses} new answer{newResponses === 1 ? '' : 's'} to review →
            </button>
          ) : null}
          {inboxCount > 0 ? (
            <button type="button" className={styles.cardLink} onClick={() => navigate('/inbox')}>
              {inboxCount} waiting for you to answer →
            </button>
          ) : null}
        </Stack>

        {canCreate && notAsked.length > 0 ? (
          <Text size="xs" tone="tertiary">
            Haven’t asked {notAsked.slice(0, 3).join(', ')}
            {notAsked.length > 3 ? ` +${notAsked.length - 3}` : ''}
          </Text>
        ) : null}

        {canCreate && overviews.length === 0 && inboxCount === 0 ? (
          <Button variant="secondary" size="sm" onClick={() => navigate('/questionnaires')}>
            Create your first questionnaire
          </Button>
        ) : null}
      </Stack>
    </Card>
  );
}

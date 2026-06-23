import { useNavigate } from 'react-router-dom';
import { ArrowRight, X } from 'lucide-react';
import type { Insight } from '@shared/schemas';
import {
  Banner,
  Button,
  Heading,
  IconButton,
  Markdown,
  Stack,
  Text,
} from '../../../design-system/components';
import styles from './sessionLifecycle.module.css';

function moodLabel(value: number, low: string, high: string, mid: string): string {
  if (value <= -0.33) return low;
  if (value >= 0.33) return high;
  return mid;
}

/**
 * The inline wrap-up card shown after a session is summarized (09 §3.1). Leads with crisis resources if
 * the analysis flagged a concern (§7), then the summary, mood, and what the coach will remember. The
 * durable record lives in Memory — a link points there for later viewing/editing. Dismissible.
 */
export function WrapUpCard({
  insight,
  onDismiss,
}: {
  insight: Insight;
  onDismiss: () => void;
}): JSX.Element {
  const navigate = useNavigate();
  const valence = insight.metrics?.moodValence;
  const energy = insight.metrics?.moodEnergy;

  return (
    <section className={styles.wrapCard} aria-live="polite" aria-label="Session summary">
      <div className={styles.wrapHead}>
        <Heading level={3}>Session summary</Heading>
        <IconButton aria-label="Dismiss summary" onClick={onDismiss}>
          <X size={16} aria-hidden="true" />
        </IconButton>
      </div>

      {insight.crisisFlag ? (
        <Banner tone="warning">
          It sounds like things are really heavy right now. You deserve support from someone who can
          help directly — please consider reaching out to a crisis line (US &amp; Canada: call or
          text <strong>988</strong>) or your local emergency services.
        </Banner>
      ) : null}

      <Stack gap={3}>
        <Markdown>{insight.summary}</Markdown>

        {valence !== undefined || energy !== undefined ? (
          <div className={styles.moodRow}>
            {valence !== undefined ? (
              <span className={styles.moodChip}>
                Mood: {moodLabel(valence, 'low', 'positive', 'mixed')}
              </span>
            ) : null}
            {energy !== undefined ? (
              <span className={styles.moodChip}>
                Energy: {moodLabel(energy, 'flat', 'high', 'steady')}
              </span>
            ) : null}
          </div>
        ) : null}

        {insight.facts.length > 0 ? (
          <Stack gap={1}>
            <Text size="sm" tone="secondary" weight={600}>
              What I’ll remember
            </Text>
            <ul className={styles.factList}>
              {insight.facts.map((fact) => (
                <li key={fact.id}>
                  <Markdown inline>{fact.text}</Markdown>
                </li>
              ))}
            </ul>
          </Stack>
        ) : null}

        <Text size="xs" tone="tertiary">
          This is a reflective summary, not medical advice. You can edit or delete it any time.
        </Text>

        <Button variant="secondary" onClick={() => navigate('/memory')}>
          View in Memory
          <ArrowRight size={16} aria-hidden="true" />
        </Button>
      </Stack>
    </section>
  );
}

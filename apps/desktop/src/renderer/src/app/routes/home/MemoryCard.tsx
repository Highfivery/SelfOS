import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import type { Insight } from '@shared/schemas';
import { Card, Heading, Stack, Text } from '../../../design-system/components';
import styles from './Home.module.css';

const SOURCE_LABEL: Record<string, string> = {
  session: 'From a session',
  dream: 'From a dream',
  questionnaire: 'From answers',
};

/**
 * "What the coach knows" — the most recent approved Insights informing the active person's coaching
 * (08/09), a couple of lines each, linking to Memory. Hidden if there are none (or the person can't view
 * results). Shows only the active person's own data (per-person isolation, §7).
 */
export function MemoryCard({
  insights,
  canView,
}: {
  insights: Insight[];
  canView: boolean;
}): JSX.Element | null {
  const navigate = useNavigate();
  if (!canView) return null;

  const recent = [...insights].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3);

  if (recent.length === 0) return null;

  return (
    <Card>
      <Stack gap={3}>
        <div className={styles.cardHead}>
          <Heading level={2}>What the coach knows</Heading>
          <button type="button" className={styles.cardLink} onClick={() => navigate('/memory')}>
            Open Memory
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        </div>
        <Stack gap={2}>
          {recent.map((insight) => (
            <div key={insight.id} className={styles.rowMain}>
              <Text size="xs" tone="tertiary">
                {SOURCE_LABEL[insight.source] ?? 'Insight'}
              </Text>
              <span className={styles.factText}>{insight.summary}</span>
            </div>
          ))}
        </Stack>
      </Stack>
    </Card>
  );
}

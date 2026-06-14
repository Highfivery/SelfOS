import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Button, Card, Heading, Stack, Text } from '../../../design-system/components';

/**
 * "Inbox" — a count of questionnaires still awaiting the active person + a CTA (mirrors the nav badge,
 * 08 §3.3). Hidden when there's nothing to answer (§3.1).
 */
export function InboxCard({ count }: { count: number }): JSX.Element | null {
  const navigate = useNavigate();
  if (count <= 0) return null;

  return (
    <Card>
      <Stack gap={3}>
        <Heading level={2}>Inbox</Heading>
        <Text tone="secondary">
          {count === 1
            ? 'You have 1 questionnaire waiting to answer.'
            : `You have ${count} questionnaires waiting to answer.`}
        </Text>
        <div>
          <Button variant="primary" onClick={() => navigate('/inbox')}>
            Open Inbox
            <ArrowRight size={16} aria-hidden="true" />
          </Button>
        </div>
      </Stack>
    </Card>
  );
}

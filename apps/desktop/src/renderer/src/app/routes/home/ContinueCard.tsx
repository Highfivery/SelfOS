import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import type { ConversationMeta, SessionCost } from '@shared/channels';
import { useConversationStore } from '../../../stores/conversationStore';
import { Button, Card, Heading, Stack } from '../../../design-system/components';
import { SessionCostIndicator } from '../sessions/SessionCostIndicator';
import styles from './Home.module.css';

const STATUS_LABEL: Record<string, string> = {
  inProgress: 'In progress',
  onHold: 'On hold',
};

/**
 * "Pick up where you left off" — the active person's in-progress / on-hold sessions (09 §14), newest
 * first, with a Resume action that opens the session in Sessions. Self-hides when there are none (§3.1).
 * Per-session cost rides the established admin-vs-member rule (admins see $, members a budget bar).
 */
export function ContinueCard({
  conversations,
  sessionCosts,
  isAdmin,
}: {
  conversations: ConversationMeta[];
  sessionCosts: Record<string, SessionCost>;
  isAdmin: boolean;
}): JSX.Element | null {
  const navigate = useNavigate();
  const open = useConversationStore((s) => s.open);

  const open5 = conversations
    .filter((c) => c.status === 'inProgress' || c.status === 'onHold')
    .slice(0, 4);

  if (open5.length === 0) return null;

  const resume = (id: string): void => {
    void open(id);
    navigate('/sessions');
  };

  return (
    <Card className={styles.wide}>
      <Stack gap={3}>
        <Heading level={2}>Pick up where you left off</Heading>
        <div className={styles.rows}>
          {open5.map((c) => (
            <div key={c.id} className={styles.row}>
              <div className={styles.rowMain}>
                <span className={styles.rowTitle}>{c.title}</span>
                <span className={styles.rowMeta}>
                  <span className={styles.statusPill}>{STATUS_LABEL[c.status] ?? c.status}</span>
                  <SessionCostIndicator cost={sessionCosts[c.id]} isAdmin={isAdmin} />
                </span>
              </div>
              <span className={styles.rowAction}>
                <Button variant="secondary" onClick={() => resume(c.id)}>
                  Resume
                  <ArrowRight size={16} aria-hidden="true" />
                </Button>
              </span>
            </div>
          ))}
        </div>
      </Stack>
    </Card>
  );
}

import { useNavigate } from 'react-router-dom';
import { Moon, MessageCircle, UserPlus } from 'lucide-react';
import { Button, Card, Heading, Stack, Text } from '../../../design-system/components';
import styles from './Home.module.css';

/**
 * The warm getting-started state (§3.2) for a brand-new active person — shown instead of a grid of empty
 * cards. A short welcome + 2–3 primary actions, gated to what the person can actually do. As they use the
 * app, the real cards replace it.
 */
export function GettingStarted({
  hasSessions,
  canOwnDreams,
  canManagePeople,
}: {
  hasSessions: boolean;
  canOwnDreams: boolean;
  canManagePeople: boolean;
}): JSX.Element {
  const navigate = useNavigate();

  return (
    <Card>
      <div className={styles.gettingStarted}>
        <Stack gap={2}>
          <Heading level={2}>Welcome to SelfOS</Heading>
          <Text tone="secondary">
            A calm space for yourself. Start a session to talk something through, log a dream, or
            add the people who matter to you — everything stays as files you own.
          </Text>
        </Stack>
        <div className={styles.actions}>
          {hasSessions ? (
            <Button variant="primary" onClick={() => navigate('/sessions')}>
              <MessageCircle size={16} aria-hidden="true" />
              Start a session
            </Button>
          ) : null}
          {canOwnDreams ? (
            <Button variant="secondary" onClick={() => navigate('/dreams')}>
              <Moon size={16} aria-hidden="true" />
              Log a dream
            </Button>
          ) : null}
          {canManagePeople ? (
            <Button variant="secondary" onClick={() => navigate('/people')}>
              <UserPlus size={16} aria-hidden="true" />
              Add someone to your circle
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

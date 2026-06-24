import { useNavigate } from 'react-router-dom';
import { ClipboardList, Moon, MessageCircle, UserPlus } from 'lucide-react';
import { Button, Card, Heading, Stack, Text } from '../../../design-system/components';
import styles from './Home.module.css';

/**
 * The warm getting-started state (§3.2/41 §3.1) for a brand-new active person — shown instead of a grid
 * of empty cards. A short welcome + a few primary actions, gated to what the person can actually do, that
 * also point at the under-discovered affordances (a guided session, dreams, sending a questionnaire). As
 * they use the app, the real cards replace it.
 */
export function GettingStarted({
  hasSessions,
  canOwnDreams,
  canManagePeople,
  canCreateQuestionnaires,
}: {
  hasSessions: boolean;
  canOwnDreams: boolean;
  canManagePeople: boolean;
  canCreateQuestionnaires: boolean;
}): JSX.Element {
  const navigate = useNavigate();

  return (
    <Card>
      <div className={styles.gettingStarted}>
        <Stack gap={2}>
          <Heading level={2}>Welcome to SelfOS</Heading>
          <Text tone="secondary">
            A calm companion that gets to know you over time. Talk something through in a session —
            free-form or a guided exercise — log a dream, or add the people who matter to you.
            Everything stays as files you own. SelfOS is a wellness tool, not medical care.
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
          {canCreateQuestionnaires ? (
            <Button variant="secondary" onClick={() => navigate('/questionnaires')}>
              <ClipboardList size={16} aria-hidden="true" />
              Send a questionnaire
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

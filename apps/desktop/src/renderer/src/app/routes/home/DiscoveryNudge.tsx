import { useNavigate } from 'react-router-dom';
import { ClipboardList, Compass, Moon, Sparkles } from 'lucide-react';
import { Button, Card, Inline, Stack, Text } from '../../../design-system/components';
import styles from './Home.module.css';

/**
 * A gentle, calm "here's what you can explore" nudge for a near-empty (not brand-new) person — e.g. one
 * session and nothing else (41 §3.1 Home-minimal / §7 partial). It points only at the under-discovered
 * affordances the person hasn't tried yet and can actually use; it renders nothing when there's nothing
 * worth suggesting, and self-replaces as the real cards fill in. Never a wall of buttons.
 */
export function DiscoveryNudge({
  suggestGuided,
  suggestDreams,
  suggestQuestionnaire,
}: {
  suggestGuided: boolean;
  suggestDreams: boolean;
  suggestQuestionnaire: boolean;
}): JSX.Element | null {
  const navigate = useNavigate();
  if (!suggestGuided && !suggestDreams && !suggestQuestionnaire) return null;

  return (
    <Card>
      <Stack gap={2}>
        <Inline gap={2}>
          <Compass size={16} aria-hidden="true" />
          <Text weight={500}>A few things to explore</Text>
        </Inline>
        <Text tone="secondary" size="sm">
          SelfOS does more as it gets to know you. When you’re ready, try one of these.
        </Text>
        <div className={styles.actions}>
          {suggestGuided ? (
            <Button variant="secondary" onClick={() => navigate('/sessions')}>
              <Sparkles size={16} aria-hidden="true" />
              Try a guided session
            </Button>
          ) : null}
          {suggestDreams ? (
            <Button variant="secondary" onClick={() => navigate('/dreams')}>
              <Moon size={16} aria-hidden="true" />
              Log a dream
            </Button>
          ) : null}
          {suggestQuestionnaire ? (
            <Button variant="secondary" onClick={() => navigate('/questionnaires')}>
              <ClipboardList size={16} aria-hidden="true" />
              Send a questionnaire
            </Button>
          ) : null}
        </div>
      </Stack>
    </Card>
  );
}

import { useNavigate } from 'react-router-dom';
import { Target } from 'lucide-react';
import { Button, Card, Heading, Inline, Stack, Text } from '../../../design-system/components';
import { useGoalStore } from '../../../stores/goalStore';
import { stalestGoal } from '../../notifications/goalFollowup';
import styles from './Home.module.css';

/**
 * "A goal worth a check-in" (40-proactive-coaching §3.2) — a calm nudge on the single stalest open goal
 * (the spec-39 derived-stale state), with the one-tap Still on it / Mark done / Let it go actions
 * (`goals:setStatus`). At most one at a time (the stalest); self-hides when nothing is stale. Acting on it
 * un-stales / closes the goal, so the card naturally drops away — never naggy, always easy to let go.
 */
export function GoalFollowupCard(): JSX.Element | null {
  const navigate = useNavigate();
  const goals = useGoalStore((s) => s.goals);
  const loaded = useGoalStore((s) => s.loaded);
  const setStatus = useGoalStore((s) => s.setStatus);

  if (!loaded) return null;
  const goal = stalestGoal(goals, new Date());
  if (!goal) return null;

  return (
    <Card>
      <Stack gap={3}>
        <div className={styles.cardHead}>
          <Heading level={2}>
            <Target size={16} aria-hidden="true" /> Still working on it?
          </Heading>
          <button type="button" className={styles.cardLink} onClick={() => navigate('/memory')}>
            See your goals
          </button>
        </div>

        <Text>
          You set a goal a while back: <strong>{goal.text}</strong>
        </Text>

        <Inline gap={2} wrap>
          <Button variant="secondary" onClick={() => void setStatus(goal.id, 'inProgress')}>
            Still on it
          </Button>
          <Button variant="secondary" onClick={() => void setStatus(goal.id, 'done')}>
            Mark done
          </Button>
          <Button variant="ghost" onClick={() => void setStatus(goal.id, 'abandoned')}>
            Let it go
          </Button>
        </Inline>

        <p className={styles.notMedical}>
          Totally fine to let it go — this is just a gentle nudge, not a to-do list.
        </p>
      </Stack>
    </Card>
  );
}

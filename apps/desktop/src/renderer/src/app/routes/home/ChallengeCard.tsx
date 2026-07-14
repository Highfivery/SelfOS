import { useNavigate } from 'react-router-dom';
import { Target } from 'lucide-react';
import { featuredActiveChallenge } from '@selfos/core/challenges';
import { useChallengeStore } from '../../../stores/challengeStore';
import {
  Button,
  Card,
  ChallengeStatusChip,
  ComfortDial,
  Heading,
  Stack,
  Text,
} from '../../../design-system/components';
import styles from './Home.module.css';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole days since an ISO date (0 on an unparseable/absent value), for a gentle "Day N" marker. */
function daysSince(iso: string | undefined, now: number): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : Math.max(0, Math.floor((now - t) / MS_PER_DAY));
}

/**
 * The Challenge bento card (60 §3.1.5, Slice 3) — the one ACTIVE challenge as a STATUS surface (visible the
 * whole time you're on it, not only when a check-in is due). Shows the agreed action, the comfort dial, and a
 * gentle "Day N" marker, plus an entry to reflect. The actionable "how did it go?" outcome nudge stays owned
 * by the "For you" `challenge-checkin` recommendation (which appears only when a check-in is due), so this
 * card doesn't duplicate it. Self-hides when there's no active challenge. Per-person (the store is scoped).
 */
export function ChallengeCard(): JSX.Element | null {
  const navigate = useNavigate();
  const challenges = useChallengeStore((s) => s.challenges);
  const challenge = featuredActiveChallenge(challenges);
  if (!challenge) return null;

  const day = daysSince(challenge.agreedAt ?? challenge.createdAt, Date.now()) + 1;
  const checkInDue = challenge.checkInAt ? Date.parse(challenge.checkInAt) <= Date.now() : false;

  return (
    <Card>
      <Stack gap={3}>
        <div className={styles.cardHead}>
          <Heading level={2} className={styles.sectionTitle}>
            <Target size={16} aria-hidden="true" /> Your challenge
          </Heading>
          <ChallengeStatusChip status="active" />
        </div>
        <Text tone="secondary">“{challenge.action}”</Text>
        <div className={styles.challengeMeta}>
          <ComfortDial value={challenge.comfort} />
          <Text size="xs" tone="tertiary">
            Day {day}
            {checkInDue ? ' · ready for a check-in' : ''}
          </Text>
        </div>
        <Button variant="ghost" size="sm" onClick={() => navigate('/sessions')}>
          {checkInDue ? 'How’s it going?' : 'Reflect on it'}
        </Button>
      </Stack>
    </Card>
  );
}

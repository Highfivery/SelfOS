import { useState } from 'react';
import { Flag } from 'lucide-react';
import type { Challenge, ChallengeDomain, ChallengeOutcome } from '@shared/channels';
import { useChallengeStore } from '../../../stores/challengeStore';
import {
  Button,
  Card,
  ChallengeStatusChip,
  ComfortDial,
  Heading,
  Inline,
  Stack,
  Text,
  Textarea,
} from '../../../design-system/components';
import styles from './ChallengeSection.module.css';

const DOMAIN_LABEL: { domain?: ChallengeDomain; label: string }[] = [
  { label: 'Surprise me' },
  { domain: 'overcome', label: 'Overcome something' },
  { domain: 'habit', label: 'Build a habit' },
  { domain: 'horizons', label: 'Broaden horizons' },
  { domain: 'novelty', label: 'Try something new' },
];

/**
 * The "Take on a challenge" section of the Sessions launcher (52-challenge-sessions §3.1/§3.3). When there's
 * no active challenge it invites one (with an optional, light domain chooser); when there's one it shows the
 * tracked card with the inline check-in. Closed challenges fold into a collapsed "Past challenges". Self-hides
 * nothing — it's always offered (a challenge is the person's own commitment, not a proactive push), so it
 * works at any proactivity level. Responsive ~360px→desktop.
 */
export function ChallengeSection({
  adultAcknowledged,
  onStartChallenge,
  onTalkItThrough,
}: {
  adultAcknowledged: boolean;
  onStartChallenge: (domain?: ChallengeDomain) => void;
  onTalkItThrough: (challengeId: string) => void;
}): JSX.Element {
  const challenges = useChallengeStore((s) => s.challenges);
  const seedGoal = useChallengeStore((s) => s.seedGoal);
  const active = challenges.find((c) => c.status === 'active');
  const closed = challenges.filter((c) => c.status === 'done' || c.status === 'abandoned');
  // After a successful check-in, offer to turn the challenge into an ongoing 39 Goal (§11 Q6 — confirm-before-
  // create). Held in a transient state since the active card unmounts once the challenge is done.
  const [goalOffer, setGoalOffer] = useState<Challenge | null>(null);
  const [goalSeeded, setGoalSeeded] = useState(false);

  return (
    <section className={styles.section} aria-label="Challenges">
      <Heading level={3}>
        <Flag size={16} aria-hidden="true" /> Take on a challenge
      </Heading>

      {goalOffer ? (
        <Card>
          <Stack gap={2}>
            {goalSeeded ? (
              <Text>✓ Added to your ongoing goals.</Text>
            ) : (
              <>
                <Text>Nice work. Want to make this an ongoing goal?</Text>
                <Inline gap={2} wrap>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      void seedGoal(goalOffer.id);
                      setGoalSeeded(true);
                    }}
                  >
                    Make it a goal
                  </Button>
                  <Button variant="ghost" onClick={() => setGoalOffer(null)}>
                    No thanks
                  </Button>
                </Inline>
              </>
            )}
          </Stack>
        </Card>
      ) : null}

      {active ? (
        <ActiveChallengeCard
          challenge={active}
          onTalkItThrough={onTalkItThrough}
          onCheckedIn={(c, outcome) => {
            if ((outcome === 'did' || outcome === 'partly') && !c.seededGoalId) {
              setGoalSeeded(false);
              setGoalOffer(c);
            }
          }}
        />
      ) : (
        <Card>
          <Stack gap={3}>
            <Text tone="secondary">
              Ready to stretch a little? SelfOS will suggest a small experiment based on what it
              knows about you — you decide together how far to push. You’re always in control:
              nothing happens that you don’t choose.
            </Text>
            <div className={styles.domains}>
              {DOMAIN_LABEL.map(({ domain, label }) => (
                <Button
                  key={label}
                  variant={domain ? 'secondary' : 'primary'}
                  onClick={() => onStartChallenge(domain)}
                >
                  {label}
                </Button>
              ))}
              {adultAcknowledged ? (
                <Button variant="secondary" onClick={() => onStartChallenge('intimacy')}>
                  Intimacy
                </Button>
              ) : null}
            </div>
          </Stack>
        </Card>
      )}

      {closed.length > 0 ? (
        <details className={styles.past}>
          <summary className={styles.pastSummary}>Past challenges ({closed.length})</summary>
          <Stack gap={2}>
            {closed.map((c) => (
              <div key={c.id} className={styles.pastRow}>
                <ChallengeStatusChip status={c.status} />
                <span className={styles.pastAction}>{c.action}</span>
              </div>
            ))}
          </Stack>
        </details>
      ) : null}
    </section>
  );
}

const OUTCOME_OPTIONS: { outcome: ChallengeOutcome; label: string }[] = [
  { outcome: 'did', label: 'I did it' },
  { outcome: 'partly', label: 'Partly' },
  { outcome: 'didnt', label: 'Not this time' },
];

function ActiveChallengeCard({
  challenge,
  onTalkItThrough,
  onCheckedIn,
}: {
  challenge: Challenge;
  onTalkItThrough: (challengeId: string) => void;
  onCheckedIn: (challenge: Challenge, outcome: ChallengeOutcome) => void;
}): JSX.Element {
  const checkIn = useChallengeStore((s) => s.checkIn);
  const snooze = useChallengeStore((s) => s.snooze);
  const setStatus = useChallengeStore((s) => s.setStatus);
  const [reflecting, setReflecting] = useState(false);
  const [note, setNote] = useState('');
  const due = challenge.checkInAt ? new Date(challenge.checkInAt).getTime() <= Date.now() : false;

  const record = (outcome: ChallengeOutcome): void => {
    void checkIn(challenge.id, outcome, note.trim() || undefined);
    setReflecting(false);
    setNote('');
    onCheckedIn(challenge, outcome);
  };

  return (
    <Card>
      <Stack gap={3}>
        <Inline gap={2} align="center" wrap>
          <ChallengeStatusChip status={challenge.status} />
          {due ? <span className={styles.dueTag}>Check-in due</span> : null}
          <ComfortDial value={challenge.comfort} />
        </Inline>
        <Text>{challenge.action}</Text>
        {challenge.lifeArea ? (
          <Text tone="secondary" size="sm">
            {challenge.lifeArea}
          </Text>
        ) : null}

        {reflecting ? (
          <Stack gap={2}>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="How did it go? (optional)"
              rows={3}
              aria-label="Your reflection"
            />
            <Inline gap={2} wrap>
              {OUTCOME_OPTIONS.map(({ outcome, label }) => (
                <Button key={outcome} variant="secondary" onClick={() => record(outcome)}>
                  {label}
                </Button>
              ))}
              <Button variant="ghost" onClick={() => setReflecting(false)}>
                Cancel
              </Button>
            </Inline>
          </Stack>
        ) : (
          <Inline gap={2} wrap>
            <Button variant="primary" onClick={() => record('did')}>
              I did it
            </Button>
            <Button variant="secondary" onClick={() => setReflecting(true)}>
              Reflect
            </Button>
            <Button variant="secondary" onClick={() => void snooze(challenge.id)}>
              Not yet
            </Button>
            {/* A reflection SESSION is offered only for non-adult challenges (a sexual challenge's reflection
                stays the inline restricted path, §8.4). */}
            {challenge.adult ? null : (
              <Button variant="ghost" onClick={() => onTalkItThrough(challenge.id)}>
                Talk it through
              </Button>
            )}
            <Button variant="ghost" onClick={() => void setStatus(challenge.id, 'abandoned')}>
              Let it go
            </Button>
          </Inline>
        )}
      </Stack>
    </Card>
  );
}

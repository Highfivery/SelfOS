import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Target } from 'lucide-react';
import { featuredActiveChallenge } from '@selfos/core/challenges';
import { useChallengeStore } from '../../../stores/challengeStore';
import {
  Banner,
  Button,
  Card,
  ChallengeStatusChip,
  ComfortDial,
  Heading,
  Inline,
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
 * The Challenge bento card (60 §3.1.5) — the one ACTIVE challenge, visible the whole time you're on it.
 *
 * AMENDED 2026-07-20 (52 §3.3): the quick actions 60 had stripped out are restored, because the "For you"
 * `challenge-checkin` recommendation fires ONLY when a check-in is due — so before the due date Home offered
 * no way to act at all, and the Together tile's "check in on Home" pointer led nowhere. The two Home surfaces
 * split the job so they never duplicate (§7):
 *   • not due → this card owns it (inline I did it / Not yet / Reflect);
 *   • due     → this card HIDES its action row and the focal "For you" recommendation owns the moment.
 *
 * The deferral is conditional on `checkInHandledElsewhere`, NOT on `checkInDue` alone: the "For you" band is
 * itself suppressed under proactivity-off, an active crisis, a brand-new person, or once that recommendation
 * has been dismissed for the current signal (53 §3.4). Deferring to a surface that isn't rendering would
 * leave a due check-in — the highest-intent moment — with no inline action anywhere on Home.
 *
 * Self-hides when there's no active challenge. Per-person (the store is scoped).
 */
export function ChallengeCard({
  checkInHandledElsewhere = false,
}: {
  /** True only when the `challenge-checkin` recommendation is genuinely on screen (Home computes this). */
  checkInHandledElsewhere?: boolean;
} = {}): JSX.Element | null {
  const navigate = useNavigate();
  const challenges = useChallengeStore((s) => s.challenges);
  const checkIn = useChallengeStore((s) => s.checkIn);
  const snooze = useChallengeStore((s) => s.snooze);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const challenge = featuredActiveChallenge(challenges);

  // Marking a challenge done is irreversible-ish, so guard against a double-fire and surface a failure
  // rather than leaving the card looking untouched (CLAUDE.md §4).
  const act = async (run: () => Promise<string | null>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const failure = await run();
      if (failure) setError(failure);
    } catch {
      setError('That didn’t save. Please try again.');
    } finally {
      setBusy(false);
    }
  };

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
        {/* Defer only when that recommendation is ACTUALLY rendering — otherwise this card keeps the actions
            so a due check-in is never left with nowhere to act (§7 duplicate-action vs. a dead end). */}
        {checkInDue && checkInHandledElsewhere ? (
          <Button variant="ghost" size="sm" onClick={() => navigate('/sessions')}>
            How’s it going?
          </Button>
        ) : (
          <Inline gap={2} wrap>
            <Button
              variant="primary"
              size="sm"
              disabled={busy}
              aria-busy={busy}
              onClick={() =>
                void act(async () => {
                  const result = await checkIn(challenge.id, 'did');
                  return result && !result.ok ? result.message : null;
                })
              }
            >
              I did it
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await snooze(challenge.id);
                  return null;
                })
              }
            >
              Not yet
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate('/sessions')}>
              Reflect
            </Button>
          </Inline>
        )}
        {error ? (
          <Banner tone="danger" role="alert">
            {error}
          </Banner>
        ) : null}
      </Stack>
    </Card>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { Check, Flag } from 'lucide-react';
import type { JointChallengeStatus } from '@shared/schemas';
import { Heading, Stack, Text } from '../../../design-system/components';
import styles from './Together.module.css';

/**
 * The pair's JOINT challenges (58 §5.6) — a stretch action the couples coach set for BOTH partners, shown as
 * a compact strip. Each keeps their own check-in on Home (the 52 card); this reflects the shared status
 * ("both checked in" / "N of M"). Self-hides when the pair has no live joint challenge. Gated host-side.
 */
export function TogetherJointChallenges({ partnerId }: { partnerId: string }): JSX.Element | null {
  const [items, setItems] = useState<JointChallengeStatus[] | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const list =
      (await window.selfos?.togetherJointChallenges({ partnerPersonId: partnerId })) ?? [];
    setItems(list);
  }, [partnerId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Show only pairs with a live/unfinished joint challenge — a fully-finished one drops off.
  const open = (items ?? []).filter((i) => i.active || !i.allCheckedIn);
  if (open.length === 0) return null;

  const statusLine = (i: JointChallengeStatus): string =>
    i.allCheckedIn
      ? 'You’ve both checked in'
      : i.checkedInCount > 0
        ? `${i.checkedInCount} of ${i.memberCount} checked in`
        : 'No check-ins yet';

  return (
    <Stack gap={2}>
      <Heading level={2}>{open.length > 1 ? 'Joint challenges' : 'Joint challenge'}</Heading>
      <Stack gap={2}>
        {open.map((i) => (
          <div key={i.groupId} className={styles.challengeStrip}>
            <div className={styles.challengeMain}>
              <span className={styles.challengeIcon}>
                <Flag size={20} aria-hidden="true" />
              </span>
              <div className={styles.challengeText}>
                <Text weight={600}>{i.action}</Text>
                <Text size="sm" tone="secondary">
                  A shared experiment you took on together. Track your own check-in on Home.
                </Text>
              </div>
            </div>
            <span className={styles.statusPill} data-tone={i.allCheckedIn ? 'accent' : undefined}>
              {i.allCheckedIn ? <Check size={13} aria-hidden="true" /> : null} {statusLine(i)}
            </span>
          </div>
        ))}
      </Stack>
    </Stack>
  );
}

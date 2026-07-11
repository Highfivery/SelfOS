import { useCallback, useEffect, useState } from 'react';
import { Flag } from 'lucide-react';
import type { JointChallengeStatus } from '@shared/schemas';
import { Card, Heading, Inline, Stack, Text } from '../../../design-system/components';
import styles from './Together.module.css';

/**
 * The pair's JOINT challenges (58 §5.6) — a stretch action the couples coach set for BOTH partners. Each
 * keeps their own check-in on Home (the 52 card); this tile shows the shared status ("both checked in" /
 * "N of M"). Self-hides when the pair has no joint challenge. Gated host-side (`together.own` + live edge).
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

  // Show only pairs with a live/unfinished joint challenge — a fully-finished one drops off the tile.
  const open = (items ?? []).filter((i) => i.active || !i.allCheckedIn);
  if (open.length === 0) return null;

  const statusLine = (i: JointChallengeStatus): string =>
    i.allCheckedIn
      ? 'You’ve both checked in'
      : i.checkedInCount > 0
        ? `${i.checkedInCount} of ${i.memberCount} checked in`
        : 'No check-ins yet';

  return (
    <Card>
      <Stack gap={2}>
        <Inline gap={2} align="center">
          <Flag size={16} aria-hidden="true" />
          <Heading level={3}>Joint challenges</Heading>
        </Inline>
        <Text size="sm" tone="secondary">
          A shared experiment you took on together. Track your own check-in on Home.
        </Text>
        <Stack gap={1}>
          {open.map((i) => (
            <div key={i.groupId} className={styles.jointChallengeRow}>
              <Text size="sm" weight={600}>
                {i.action}
              </Text>
              <Text size="xs" tone="secondary">
                {statusLine(i)}
              </Text>
            </div>
          ))}
        </Stack>
      </Stack>
    </Card>
  );
}

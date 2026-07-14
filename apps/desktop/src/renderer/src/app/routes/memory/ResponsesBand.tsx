import type { Insight } from '@shared/schemas';
import { Card, Collapsible, Stack, Text } from '../../../design-system/components';
import styles from './Memory.module.css';

export interface RecipientGroup {
  key: string;
  name: string;
  insights: Insight[];
}

/**
 * "From questionnaires you sent" (62 §3.6, #129) — the insights drawn from OTHERS' answers to questionnaires
 * you sent, grouped per recipient, each expanding inline into their response cards (edited in place like any
 * other). Controlled by Memory so a "View in Memory" deep-link can force a recipient open.
 */
export function ResponsesBand({
  groups,
  openKeys,
  onOpenChange,
  renderCard,
}: {
  groups: RecipientGroup[];
  openKeys: Set<string>;
  onOpenChange: (key: string, open: boolean) => void;
  renderCard: (insight: Insight) => JSX.Element;
}): JSX.Element {
  return (
    <Card className={styles.panel}>
      <div className={styles.panelHead}>
        <span className={styles.panelName}>From questionnaires you sent</span>
      </div>
      <Text size="sm" tone="tertiary">
        What you learned from others’ answers — about them, informing your coaching.
      </Text>
      <Stack gap={1}>
        {groups.map((group) => (
          <Collapsible
            key={group.key}
            className={styles.responseRow}
            open={openKeys.has(group.key)}
            onOpenChange={(open) => onOpenChange(group.key, open)}
            header={
              <>
                <span className={styles.responseAvatar} aria-hidden="true">
                  {group.name.charAt(0).toUpperCase()}
                </span>
                <span className={styles.responseName}>{group.name}</span>
                <span className={styles.sectionCount}>
                  {group.insights.length} {group.insights.length === 1 ? 'insight' : 'insights'}
                </span>
              </>
            }
          >
            <Stack gap={3}>{group.insights.map((insight) => renderCard(insight))}</Stack>
          </Collapsible>
        ))}
      </Stack>
    </Card>
  );
}

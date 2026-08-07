import type { Insight, OutboundSharingItem, RelationshipType } from '@shared/schemas';
import { Collapsible, Text } from '../../../design-system/components';
import { SharingItemRow } from './SharingItemRow';
import { groupByPerson } from './sharingDashboard';
import styles from './SharingDashboard.module.css';

function initials(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '·';
}

interface SharingByPersonProps {
  items: OutboundSharingItem[];
  insights: Insight[];
  availableTypes: RelationshipType[] | undefined;
  canEditAnswers: boolean;
}

/**
 * The **By person** tab (68 §3.4): one collapsible group per related person currently receiving anything —
 * open by default (never default-collapsed, so no item hides unreachably, §12). An item reaching several
 * people appears under each recipient's group.
 */
export function SharingByPerson({
  items,
  insights,
  availableTypes,
  canEditAnswers,
}: SharingByPersonProps): JSX.Element {
  const groups = groupByPerson(items);

  if (groups.length === 0) {
    return (
      <Text tone="secondary">
        Nothing reaches anyone in your circle yet. When you share something with a person you relate
        to, they’ll show up here.
      </Text>
    );
  }

  return (
    <div className={styles.groupList}>
      {groups.map((group) => (
        <Collapsible
          key={group.id}
          defaultOpen
          header={
            <span className={styles.groupHeader}>
              <span className={styles.avatar} aria-hidden="true">
                {initials(group.name)}
              </span>
              <span className={styles.groupName}>{group.name}</span>
              <span className={styles.groupCount}>
                {group.items.length} {group.items.length === 1 ? 'thing' : 'things'} their coach can
                draw on
              </span>
            </span>
          }
        >
          <div className={styles.rows}>
            {group.items.map((item) => (
              <SharingItemRow
                key={`${item.kind}:${item.id}:${group.id}`}
                item={item}
                insights={insights}
                availableTypes={availableTypes}
                canEditAnswers={canEditAnswers}
              />
            ))}
          </div>
        </Collapsible>
      ))}
    </div>
  );
}

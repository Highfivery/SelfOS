import { useState } from 'react';
import { Lock, Users } from 'lucide-react';
import type { Insight, OutboundSharingItem, Relationship, RelationshipType } from '@shared/schemas';
import { RELATIONSHIP_TYPE_LABELS } from '@selfos/core/sharing';
import { Collapsible, Text } from '../../../design-system/components';
import { areaIcon } from '../memory/lifeAreaIcons';
import { useInsightStore } from '../../../stores/insightStore';
import { SharingItemRow } from './SharingItemRow';
import { groupByCategory, groupReachTypes } from './sharingDashboard';
import styles from './SharingDashboard.module.css';

interface SharingByCategoryProps {
  items: OutboundSharingItem[];
  insights: Insight[];
  relationships: Relationship[];
  activePersonId: string | null;
  availableTypes: RelationshipType[] | undefined;
  canEditAnswers: boolean;
}

/** Resolve a group's fact + answer targets (68 §3.5) — profile fields + dream images are never bulk-scoped. */
function scopeTargets(items: OutboundSharingItem[], insights: Insight[]) {
  const factTargets: { insightId: string; factId: string }[] = [];
  const answerTargets: { sectionId: string; questionId: string }[] = [];
  for (const item of items) {
    if (item.kind === 'fact') {
      const insight = insights.find((i) => i.facts.some((f) => f.id === item.id));
      if (insight) factTargets.push({ insightId: insight.id, factId: item.id });
    } else if (item.kind === 'intakeAnswer') {
      const dot = item.id.indexOf('.');
      if (dot >= 0)
        answerTargets.push({
          sectionId: item.id.slice(0, dot),
          questionId: item.id.slice(dot + 1),
        });
    }
  }
  return { factTargets, answerTargets };
}

/**
 * The **By category** tab (68 §3.5): life-area groups, each with per-category **"Make private" / "Share with
 * partner"** bulk actions that REPLACE the scope of every fact + answer in the category (profile fields +
 * dream images untouched — the header states this). An inline confirm guards the batch.
 */
export function SharingByCategory({
  items,
  insights,
  relationships,
  activePersonId,
  availableTypes,
  canEditAnswers,
}: SharingByCategoryProps): JSX.Element {
  const setScopeBatch = useInsightStore((s) => s.setScopeBatch);
  const [pending, setPending] = useState<{ category: string; types: RelationshipType[] } | null>(
    null,
  );
  const groups = groupByCategory(items);

  if (groups.length === 0) {
    return <Text tone="secondary">You’re not sharing anything yet.</Text>;
  }

  const runBulk = async (
    groupItems: OutboundSharingItem[],
    types: RelationshipType[],
  ): Promise<void> => {
    const { factTargets, answerTargets } = scopeTargets(groupItems, insights);
    if (factTargets.length === 0 && answerTargets.length === 0) {
      setPending(null);
      return;
    }
    await setScopeBatch({ types, factTargets, answerTargets });
    setPending(null);
  };

  return (
    <div className={styles.groupList}>
      {groups.map((group) => {
        const Icon = areaIcon(group.category);
        const reach = groupReachTypes(group.items, activePersonId, relationships);
        // The bulk action only touches facts + answers (68 §3.5); answers need `intake.own`. Show it only when
        // there's at least one target it can actually apply, so it's never a silent no-op (the 68 §7 role).
        const hasScopable =
          group.items.some((i) => i.kind === 'fact') ||
          (canEditAnswers && group.items.some((i) => i.kind === 'intakeAnswer'));
        const isPending = pending?.category === group.category;
        return (
          <Collapsible
            key={group.category}
            defaultOpen
            header={
              <span className={styles.groupHeader}>
                <span className={styles.categoryIcon} aria-hidden="true">
                  <Icon size={17} />
                </span>
                <span className={styles.groupName}>{group.category}</span>
                <span className={styles.groupCount}>
                  {group.items.length} · reaches{' '}
                  {reach.length > 0
                    ? reach.map((t) => RELATIONSHIP_TYPE_LABELS[t]).join(', ')
                    : 'no one yet'}
                </span>
              </span>
            }
          >
            {hasScopable ? (
              <div className={styles.bulkRow}>
                {isPending ? (
                  <>
                    <Text size="xs" tone="secondary">
                      {pending.types.length === 0
                        ? 'Make every memory & answer in this category private?'
                        : 'Share every memory & answer in this category with your partner?'}
                    </Text>
                    <button
                      type="button"
                      className={styles.bulkConfirm}
                      onClick={() => void runBulk(group.items, pending.types)}
                    >
                      Yes, apply
                    </button>
                    <button
                      type="button"
                      className={styles.bulkCancel}
                      onClick={() => setPending(null)}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span className={styles.bulkNote}>Applies to memories &amp; answers here</span>
                    <button
                      type="button"
                      className={styles.bulkBtn}
                      onClick={() => setPending({ category: group.category, types: [] })}
                    >
                      <Lock size={13} aria-hidden="true" /> Make private
                    </button>
                    <button
                      type="button"
                      className={styles.bulkBtn}
                      onClick={() => setPending({ category: group.category, types: ['partner'] })}
                    >
                      <Users size={13} aria-hidden="true" /> Share with partner
                    </button>
                  </>
                )}
              </div>
            ) : null}
            <div className={styles.rows}>
              {group.items.map((item) => (
                <SharingItemRow
                  key={`${item.kind}:${item.id}`}
                  item={item}
                  insights={insights}
                  availableTypes={availableTypes}
                  canEditAnswers={canEditAnswers}
                />
              ))}
            </div>
          </Collapsible>
        );
      })}
    </div>
  );
}

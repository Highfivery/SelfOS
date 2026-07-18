import { ChevronDown } from 'lucide-react';
import type { Insight } from '@shared/schemas';
import { Text } from '../../../design-system/components';
import styles from './Memory.module.css';

export interface RecipientGroup {
  key: string;
  name: string;
  insights: Insight[];
}

/** The most recent provenance date across a recipient's insights, as a short "Mon D" label (or ''). */
function lastDateLabel(insights: Insight[]): string {
  const latest = insights.reduce((m, i) => (i.provenance.at > m ? i.provenance.at : m), '');
  if (!latest) return '';
  const d = new Date(latest);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * "From questionnaires you sent" (62 §3.6, #129 / 65 §3.6) — the insights drawn from OTHERS' answers to
 * questionnaires you sent. A **compact strip** of small recipient cards (avatar · name · "N insights · last
 * date") that stays tidy whether there are 1 or 6 recipients; clicking a card expands that recipient's response
 * cards full-width below (edited in place like any other). Controlled by Memory so a "View in Memory" deep-link
 * can force a recipient open.
 */
export function ResponsesBand({
  groups,
  openKeys,
  onOpenChange,
  renderCards,
}: {
  groups: RecipientGroup[];
  openKeys: Set<string>;
  onOpenChange: (key: string, open: boolean) => void;
  /** Wraps a recipient's expanded insight cards (the shared 2-col card grid). */
  renderCards: (insights: Insight[]) => JSX.Element;
}): JSX.Element {
  return (
    <div className={styles.responses}>
      <div className={styles.responsesHead}>
        <span className={styles.responsesTitle}>From questionnaires you sent</span>
        <Text size="sm" tone="tertiary">
          What you learned from others’ answers — informs your coaching, never shown to them.
        </Text>
      </div>

      <div className={styles.respStrip}>
        {groups.map((group) => {
          const open = openKeys.has(group.key);
          const last = lastDateLabel(group.insights);
          return (
            <button
              key={group.key}
              type="button"
              className={styles.respCard}
              aria-expanded={open}
              aria-controls={open ? `resp-${group.key}` : undefined}
              onClick={() => onOpenChange(group.key, !open)}
            >
              <span className={styles.responseAvatar} aria-hidden="true">
                {group.name.charAt(0).toUpperCase()}
              </span>
              <span className={styles.respCardBody}>
                <span className={styles.respName}>{group.name}</span>
                <span className={styles.respMeta}>
                  {group.insights.length} {group.insights.length === 1 ? 'insight' : 'insights'}
                  {last ? ` · last ${last}` : ''}
                </span>
              </span>
              <ChevronDown
                size={18}
                className={styles.respChev}
                data-open={open || undefined}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>

      {groups
        .filter((group) => openKeys.has(group.key))
        .map((group) => (
          <div key={group.key} id={`resp-${group.key}`} className={styles.respExpanded}>
            <span className={styles.respExpandedLabel}>From {group.name}’s answers</span>
            {renderCards(group.insights)}
          </div>
        ))}
    </div>
  );
}

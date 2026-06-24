import type { InsightFact, RelationshipType } from '@shared/schemas';
import { RELATIONSHIP_TYPE_ORDER } from '@selfos/core/sharing';
import { useInsightStore } from '../../../stores/insightStore';
import { RelationshipScopePicker } from '../../../design-system/components';
import styles from './Memory.module.css';

/**
 * Per-fact relationship-type sharing control for a Memory insight card (44-memory-dashboard §3.4) — replaces
 * the broadcast `ShareToggle` with the scoped `RelationshipScopePicker`. Used ONLY for AI-inferred facts
 * (session/dream/questionnaire): onboarding (`source: 'intake'`) facts are shown read-only in the card —
 * their scope is owned by the answer's `answerSharing` (43 §4) and would be reverted by re-synthesis — and a
 * `restricted` fact is never shared by type, so neither caller (`InsightCard` gates on `!isIntake`,
 * `SharingPanel` routes intake/restricted away) ever hands one here. A legacy broadcast fact reads as
 * "shared with all your relationship types," narrowable on edit; the scoped model never broadcasts (§3.4).
 */
export function FactSharingControl({
  insightId,
  subjectPersonId,
  fact,
  availableTypes,
  disabled,
}: {
  insightId: string;
  subjectPersonId: string;
  fact: InsightFact;
  /** Relationship types present in the person's graph (44 §3.4); undefined ⇒ the picker's full-set default. */
  availableTypes?: RelationshipType[];
  disabled?: boolean;
}): JSX.Element {
  const setFactScope = useInsightStore((s) => s.setFactScope);

  // A legacy broadcast fact maps to all available types (honest: it currently reaches every related person),
  // narrowable on the next change.
  const value = fact.shareable
    ? (availableTypes ?? RELATIONSHIP_TYPE_ORDER)
    : (fact.shareableTypes ?? []);

  return (
    <span className={styles.shareCell}>
      <RelationshipScopePicker
        value={value}
        label={fact.text}
        disabled={disabled ?? false}
        {...(availableTypes ? { availableTypes } : {})}
        onChange={(types) =>
          void setFactScope({
            subjectPersonId,
            insightId,
            // The scoped model never broadcasts (§3.4) — always `shareable: false` + the chosen types.
            fact: { id: fact.id, text: fact.text, shareable: false, shareableTypes: types },
          })
        }
      />
    </span>
  );
}

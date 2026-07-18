import { Lock, Users } from 'lucide-react';
import type { InsightFact, RelationshipType } from '@shared/schemas';
import { useInsightStore } from '../../../stores/insightStore';
import {
  currentSharePreset,
  nextSharePreset,
  sharePresetLabel,
  typesForPreset,
} from './sharePresets';
import styles from './Memory.module.css';

/**
 * The read-view per-fact sharing control (65 §3.4): a compact chip showing who this item can inform, that
 * **taps to cycle** Just me → Partner → Close family → Everyone (writing the fact's `shareableTypes` via
 * `setFactScope`, which merges by id so the other facts are untouched). Fine-grained per-type scopes are set
 * via the full `RelationshipScopePicker` in Edit mode; a fact carrying such a custom scope reads "Custom" here
 * and the first tap restarts the cycle at "Just me". Used only for AI-inferred facts (never a `restricted`
 * intake fact — the card gates those out).
 *
 * By default the chip **writes to the store immediately** (an approved card, 65 §3.4a). Pass `onChange` to run
 * it in LOCAL mode — a tap reports the next type set to the caller instead of persisting (the review queue sets
 * a DRAFT's scopes locally, then writes them all at Keep & save; 65 §3.3).
 */
export function SharePresetChip({
  insightId,
  subjectPersonId,
  fact,
  availableTypes,
  disabled,
  onChange,
}: {
  insightId: string;
  subjectPersonId: string;
  fact: InsightFact;
  availableTypes?: RelationshipType[];
  disabled?: boolean;
  /** Local mode (65 §3.3): a tap reports the next `shareableTypes` instead of writing to the store. */
  onChange?: (types: RelationshipType[]) => void;
}): JSX.Element {
  const setFactScope = useInsightStore((s) => s.setFactScope);

  const preset = currentSharePreset(fact, availableTypes);
  const label = preset === 'custom' ? 'Custom' : sharePresetLabel(preset);
  const isPrivate = preset === 'private';

  const onTap = (): void => {
    const next = typesForPreset(nextSharePreset(preset), availableTypes);
    if (onChange) {
      onChange(next);
      return;
    }
    void setFactScope({
      subjectPersonId,
      insightId,
      fact: { id: fact.id, text: fact.text, shareable: false, shareableTypes: next },
    });
  };

  return (
    <button
      type="button"
      className={styles.sharePresetChip}
      data-private={isPrivate || undefined}
      aria-label={`Sharing for "${fact.text}": ${label} — activate to change who this can inform`}
      title="Who can this item inform?"
      disabled={disabled ?? false}
      onClick={onTap}
    >
      {isPrivate ? <Lock size={12} aria-hidden="true" /> : <Users size={12} aria-hidden="true" />}
      {label}
    </button>
  );
}

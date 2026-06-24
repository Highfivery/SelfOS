import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import type { InsightFact, RelationshipType } from '@shared/schemas';
import { RELATIONSHIP_TYPE_ORDER } from '@selfos/core/sharing';
import { useInsightStore } from '../../../stores/insightStore';
import { Button, RelationshipScopePicker, Text } from '../../../design-system/components';
import styles from './Memory.module.css';

/**
 * Per-fact relationship-type sharing control for a Memory insight card (44-memory-dashboard §3.4) — replaces
 * the broadcast `ShareToggle` with the scoped `RelationshipScopePicker`. A normal fact shows the picker
 * directly (a legacy broadcast fact reads as "shared with all your relationship types," narrowable on edit).
 * A `restricted` (sensitive onboarding) fact is own-coaching-only and is NEVER shown by type: it shows a
 * sensitive chip + a deliberate two-step (confirm → choose a type) that un-restricts AND scopes it in one
 * write — the 42 §8 "two explicit acts," never a default. Setting it back to Private leaves it restricted.
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
  // For a restricted fact: 'chip' (sensitive, own-only) → 'confirm' (the warning) → 'choose' (the picker).
  const [step, setStep] = useState<'chip' | 'confirm' | 'choose'>('chip');

  const write = (types: RelationshipType[], unrestrict: boolean): Promise<void> =>
    setFactScope({
      subjectPersonId,
      insightId,
      fact: {
        id: fact.id,
        text: fact.text,
        shareable: false, // the scoped model never broadcasts (§3.4)
        shareableTypes: types,
        ...(unrestrict ? { restricted: false } : {}),
      },
    });

  // --- Sensitive (restricted) fact: deliberate un-restrict + scope (42 §8) ---
  if (fact.restricted) {
    if (step === 'chip') {
      return (
        <span className={styles.shareCell}>
          <span className={styles.sensitiveTag} title="Sensitive — only your own coach uses this">
            <ShieldAlert size={12} aria-hidden="true" /> sensitive · only your coach
          </span>
          <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setStep('confirm')}>
            Share with someone…
          </Button>
        </span>
      );
    }
    if (step === 'confirm') {
      return (
        <div className={styles.sensitiveConfirm} role="group" aria-label="Share a sensitive fact">
          <Text size="xs" tone="secondary">
            This is sensitive. Sharing lets the people you choose have it inform their AI coaching —
            they never see it directly. Continue?
          </Text>
          <div className={styles.sensitiveConfirmActions}>
            <Button
              variant="secondary"
              size="sm"
              disabled={disabled}
              onClick={() => setStep('choose')}
            >
              Continue
            </Button>
            <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setStep('chip')}>
              Cancel
            </Button>
          </div>
        </div>
      );
    }
    // 'choose' — picker shown; selecting a type un-restricts + scopes; Private cancels back to the chip.
    return (
      <span className={styles.shareCell}>
        <RelationshipScopePicker
          value={[]}
          label={fact.text}
          disabled={disabled ?? false}
          {...(availableTypes ? { availableTypes } : {})}
          onChange={(types) => {
            if (types.length === 0) setStep('chip');
            else void write(types, true);
          }}
        />
      </span>
    );
  }

  // --- Normal fact: scope directly. A legacy broadcast fact maps to all available types (honest: it
  // currently reaches every related person), narrowable on the next change. ---
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
        onChange={(types) => void write(types, false)}
      />
    </span>
  );
}

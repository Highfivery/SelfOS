import { Lock, Users } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { RelationshipType } from '@selfos/core/schemas';
import {
  describeScope,
  RELATIONSHIP_TYPE_LABELS,
  RELATIONSHIP_TYPE_ORDER,
  SHARING_SCOPE_EXPLAINER,
} from '@selfos/core/sharing';
import styles from './RelationshipScopePicker.module.css';

interface RelationshipScopePickerProps {
  /** The relationship types this item is shared with (empty ⇒ private). */
  value: RelationshipType[];
  onChange: (types: RelationshipType[]) => void;
  /** The item's name, woven into the accessible name (e.g. "Sleep schedule"). */
  label: string;
  /**
   * Which relationship types to offer — the types present in the person's graph (42 §3.1). Defaults to the
   * full set (authoring, before anyone is related). Order follows `RELATIONSHIP_TYPE_ORDER`.
   */
  availableTypes?: RelationshipType[];
  disabled?: boolean;
}

/**
 * Per-item relationship-type sharing control (42-relationship-scoped-sharing §3.1). A collapsed chip
 * summarizes the scope (`Private` / `Shared: Partner, …`); expanding it reveals a checkbox list of the
 * relationship types (+ a "Private (only me)" clear-all) and the honest "they never see it directly"
 * explainer. Emits the chosen `RelationshipType[]` (empty ⇒ private). State is conveyed as text + a distinct
 * icon, never colour alone (design-system §9); the trigger is `flex: none` so it never shrinks in a row.
 */
export function RelationshipScopePicker({
  value,
  onChange,
  label,
  availableTypes,
  disabled,
}: RelationshipScopePickerProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();

  // Close on outside click / Escape (the §12 dropdown rule).
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const types = (availableTypes ?? RELATIONSHIP_TYPE_ORDER).filter((t) =>
    RELATIONSHIP_TYPE_ORDER.includes(t),
  );
  const isPrivate = value.length === 0;
  const summary = describeScope(value);
  const Icon = isPrivate ? Lock : Users;
  const accessibleName = isPrivate
    ? `${label}: private — only your own coach uses it; activate to change who it informs`
    : `${label}: shared with ${summary} — informs their AI coaching, never shown to them; activate to change`;

  const toggleType = (type: RelationshipType): void => {
    onChange(
      value.includes(type)
        ? value.filter((t) => t !== type)
        : RELATIONSHIP_TYPE_ORDER.filter((t) => t === type || value.includes(t)),
    );
  };

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? popoverId : undefined}
        aria-label={accessibleName}
        title={accessibleName}
        className={`${styles.chip} ${isPrivate ? styles.private : styles.shared}`}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon size={13} aria-hidden="true" />
        <span aria-hidden="true">{isPrivate ? 'Private' : `Shared: ${summary}`}</span>
      </button>
      {open && (
        <div
          className={styles.popover}
          id={popoverId}
          role="dialog"
          aria-label={`Sharing for ${label}`}
        >
          <p className={styles.explainer}>{SHARING_SCOPE_EXPLAINER}</p>
          <button
            type="button"
            className={`${styles.option} ${isPrivate ? styles.optionActive : ''}`}
            aria-pressed={isPrivate}
            onClick={() => onChange([])}
          >
            <Lock size={13} aria-hidden="true" />
            Private (only me)
          </button>
          <div className={styles.divider} role="presentation" />
          {types.map((type) => (
            <label key={type} className={styles.checkRow}>
              <input
                type="checkbox"
                checked={value.includes(type)}
                onChange={() => toggleType(type)}
              />
              <span>{RELATIONSHIP_TYPE_LABELS[type]}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

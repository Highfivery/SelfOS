import { Lock, Unlock } from 'lucide-react';
import styles from './ShareToggle.module.css';

interface ShareToggleProps {
  /** Whether the field is currently shared (may inform related people's context). */
  shared: boolean;
  onChange: (shared: boolean) => void;
  /** The field name, woven into the accessible name (e.g. "Occupation"). */
  label: string;
  id?: string;
  disabled?: boolean;
}

/**
 * Per-item shareability toggle (15-shareability §3.1/§9) — a compact lock/share control adjacent to a
 * field label. **Shared** (default): an open lock; the field may inform the coaching of people you relate
 * to. **Private**: a closed lock; the field is used only in this person's own coaching. The state is
 * conveyed as TEXT (the word + a state-and-meaning accessible name) and a distinct icon shape, never
 * colour alone (design-system §9). A real toggle button with `aria-pressed`.
 */
export function ShareToggle({
  shared,
  onChange,
  label,
  id,
  disabled,
}: ShareToggleProps): JSX.Element {
  const accessibleName = shared
    ? `${label}: shared — may inform people you relate to; activate to lock to this person only`
    : `${label}: private — used only in this person’s own coaching; activate to share`;
  const Icon = shared ? Unlock : Lock;
  return (
    <button
      type="button"
      id={id}
      disabled={disabled}
      aria-pressed={shared}
      aria-label={accessibleName}
      title={accessibleName}
      className={`${styles.toggle} ${shared ? styles.shared : styles.private}`}
      onClick={() => onChange(!shared)}
    >
      <Icon size={13} aria-hidden="true" />
      <span aria-hidden="true">{shared ? 'Shared' : 'Private'}</span>
    </button>
  );
}

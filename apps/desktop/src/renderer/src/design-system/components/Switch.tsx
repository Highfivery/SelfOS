import styles from './Switch.module.css';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  id?: string;
  disabled?: boolean;
  'aria-label'?: string;
  'aria-describedby'?: string;
}

/** Accessible on/off toggle (role="switch"). */
export function Switch({ checked, onChange, id, disabled, ...aria }: SwitchProps): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      disabled={disabled}
      className={checked ? `${styles.switch} ${styles.on}` : styles.switch}
      onClick={() => onChange(!checked)}
      {...aria}
    >
      <span className={styles.thumb} aria-hidden="true" />
    </button>
  );
}

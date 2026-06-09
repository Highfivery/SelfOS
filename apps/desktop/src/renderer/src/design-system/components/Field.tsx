import { useId, type ReactNode } from 'react';
import styles from './Field.module.css';

interface FieldRenderProps {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
}

interface FieldProps {
  label: string;
  help?: string;
  error?: string;
  children: (props: FieldRenderProps) => ReactNode;
}

/**
 * Wraps a control with an associated label and optional help/error text, wiring `htmlFor`,
 * `aria-describedby`, and `aria-invalid` via a render prop so the control stays accessible.
 */
export function Field({ label, help, error, children }: FieldProps): JSX.Element {
  const id = useId();
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {help ? (
        <p id={helpId} className={styles.help}>
          {help}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

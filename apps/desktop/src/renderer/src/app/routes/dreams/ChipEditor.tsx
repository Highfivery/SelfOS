import { useState, type KeyboardEvent } from 'react';
import { Plus, X } from 'lucide-react';
import { Button, Field, TextInput } from '../../../design-system/components';
import styles from './ChipEditor.module.css';

interface ChipEditorProps {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}

/** A label + removable chips + an inline add input — used for a dream's tags and people present. */
export function ChipEditor({ label, values, onChange, placeholder }: ChipEditorProps): JSX.Element {
  const [draft, setDraft] = useState('');

  const add = (): void => {
    const value = draft.trim();
    if (value && !values.includes(value)) onChange([...values, value]);
    setDraft('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      add();
    }
  };

  return (
    <Field label={label}>
      {(p) => (
        <div>
          {values.length > 0 ? (
            <div className={styles.chips}>
              {values.map((value, index) => (
                <span key={value} className={styles.chip}>
                  {value}
                  <button
                    type="button"
                    className={styles.remove}
                    aria-label={`Remove ${value}`}
                    onClick={() => onChange(values.filter((_, i) => i !== index))}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <div className={styles.add}>
            <TextInput
              {...p}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
            />
            <Button variant="secondary" onClick={add}>
              <Plus size={16} aria-hidden="true" />
              Add
            </Button>
          </div>
        </div>
      )}
    </Field>
  );
}

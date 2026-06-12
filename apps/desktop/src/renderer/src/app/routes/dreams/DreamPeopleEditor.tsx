import { useState, type KeyboardEvent } from 'react';
import { Link2, Plus, X } from 'lucide-react';
import type { DreamPersonRef } from '@shared/channels';
import { Button, Field, Select, TextInput } from '../../../design-system/components';
import styles from './DreamPeopleEditor.module.css';

interface DreamPeopleEditorProps {
  values: DreamPersonRef[];
  onChange: (next: DreamPersonRef[]) => void;
  /** Selectable household people to link (the dreamer is excluded by the caller). */
  people: { id: string; displayName: string }[];
}

/**
 * The "people in the dream" editor (12-dreams §3.1): link a known person from the People graph **or** type
 * a free name. A linked person carries a `personId`, so the analysis can pull their shareable context
 * (12 §5.1) and patterns resolve them to a real person; a free name is text only.
 */
export function DreamPeopleEditor({
  values,
  onChange,
  people,
}: DreamPeopleEditorProps): JSX.Element {
  const [draft, setDraft] = useState('');

  const linkedIds = new Set(values.map((ref) => ref.personId).filter(Boolean));
  const nameById = new Map(people.map((person) => [person.id, person.displayName]));
  const available = people.filter((person) => !linkedIds.has(person.id));

  const labelFor = (ref: DreamPersonRef): string =>
    ref.personId ? (nameById.get(ref.personId) ?? ref.name ?? 'Unknown person') : (ref.name ?? '');

  const addName = (): void => {
    const name = draft.trim();
    // Skip a duplicate free name, and a free name that matches an already-linked person's display name
    // (so you don't get two near-identical chips — one "linked", one not — for the same person).
    const already = values.some((ref) =>
      ref.personId ? labelFor(ref) === name : ref.name === name,
    );
    if (name && !already) onChange([...values, { name }]);
    setDraft('');
  };

  const linkPerson = (id: string): void => {
    if (!id || linkedIds.has(id)) return;
    onChange([...values, { personId: id }]);
  };

  const removeAt = (index: number): void => onChange(values.filter((_, i) => i !== index));

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addName();
    }
  };

  return (
    <Field
      label="People in the dream"
      help="Link someone you know so your coach can draw on what it knows about them — or just type a name."
    >
      {(p) => (
        <div>
          {values.length > 0 ? (
            <div className={styles.chips}>
              {values.map((ref, index) => (
                <span
                  key={ref.personId ? `id:${ref.personId}` : `name:${ref.name}`}
                  className={ref.personId ? `${styles.chip} ${styles.chipLinked}` : styles.chip}
                >
                  {ref.personId ? (
                    <Link2 size={13} aria-hidden="true" className={styles.linkIcon} />
                  ) : null}
                  {labelFor(ref)}
                  {ref.personId ? <span className={styles.linkedTag}>linked</span> : null}
                  <button
                    type="button"
                    className={styles.remove}
                    aria-label={`Remove ${labelFor(ref)}`}
                    onClick={() => removeAt(index)}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          {available.length > 0 ? (
            <div className={styles.linkRow}>
              <Select
                aria-label="Link a person you know"
                value=""
                onChange={(e) => linkPerson(e.target.value)}
              >
                <option value="">Link a person you know…</option>
                {available.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.displayName}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}

          <div className={styles.add}>
            <TextInput
              {...p}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={available.length > 0 ? 'Or add a name' : 'Add a name'}
            />
            <Button variant="secondary" onClick={addName}>
              <Plus size={16} aria-hidden="true" />
              Add
            </Button>
          </div>
        </div>
      )}
    </Field>
  );
}

import { useState, type KeyboardEvent } from 'react';
import { Link2, Plus, UserPlus, X } from 'lucide-react';
import type { DreamPersonRef } from '@shared/channels';
import type { RelationshipType } from '@shared/schemas';
import { usePeopleStore } from '../../../stores/peopleStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { Button, Field, Select, TextInput } from '../../../design-system/components';
import styles from './DreamPeopleEditor.module.css';

interface DreamPeopleEditorProps {
  values: DreamPersonRef[];
  onChange: (next: DreamPersonRef[]) => void;
  /** Selectable household people to link (the dreamer is excluded by the caller). */
  people: { id: string; displayName: string }[];
}

/** Relationship options, mirroring the People editor (12 §15.6 quick-add). */
const REL_TYPES: { value: RelationshipType; label: string }[] = [
  { value: 'partner', label: 'Partner' },
  { value: 'parent', label: 'Parent' },
  { value: 'child', label: 'Child' },
  { value: 'sibling', label: 'Sibling' },
  { value: 'friend', label: 'Friend' },
  { value: 'coworker', label: 'Coworker' },
  { value: 'ex', label: 'Ex' },
  { value: 'other', label: 'Other' },
];

/**
 * The "people in the dream" editor (12-dreams §3.1): link a known person from the People graph **or** type
 * a free name. A linked person carries a `personId`, so the analysis can pull their shareable context
 * (12 §5.1) and patterns resolve them to a real person; a free name is text only.
 *
 * When a **new** name is typed (not an existing household person), the editor offers to **add them as a
 * contact** (`isSubject: false` — no login/onboarding), with an optional relationship, then upgrades the
 * free chip to a linked one (12 §15.2/§15.6). The prompt appears on every sensitivity tier (§15.2 #4).
 */
export function DreamPeopleEditor({
  values,
  onChange,
  people,
}: DreamPeopleEditorProps): JSX.Element {
  const [draft, setDraft] = useState('');
  // A just-typed new name awaiting an "add them?" decision; then, after adding, the optional relationship.
  const [pendingAdd, setPendingAdd] = useState<string | null>(null);
  const [linkFor, setLinkFor] = useState<{ personId: string; name: string } | null>(null);
  const [relType, setRelType] = useState<RelationshipType | ''>('');
  const [busy, setBusy] = useState(false);

  const savePerson = usePeopleStore((s) => s.savePerson);
  const saveRelationship = usePeopleStore((s) => s.saveRelationship);
  const loadPeople = usePeopleStore((s) => s.load);
  const dreamerId = useSessionStore((s) => s.activePerson?.id);

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
    if (name && !already) {
      onChange([...values, { name }]);
      // Offer to add a GENUINELY-new name (not one matching an existing household person, who should be
      // linked, not duplicated) as a contact.
      const matchesExisting = people.some(
        (person) => person.displayName.toLowerCase() === name.toLowerCase(),
      );
      if (!matchesExisting) setPendingAdd(name);
    }
    setDraft('');
  };

  // "Add as contact": create a household contact, upgrade the free chip to linked, then offer a relationship.
  const confirmAdd = async (): Promise<void> => {
    if (!pendingAdd || busy) return;
    const name = pendingAdd;
    setBusy(true);
    const created = await savePerson({ displayName: name, isSubject: false, tags: [] });
    await loadPeople(); // so the composer resolves the new person's name for the linked chip
    setBusy(false);
    setPendingAdd(null);
    if (!created) return;
    // Keep the name as a fallback label until the household list reload propagates.
    onChange(
      values.map((ref) =>
        !ref.personId && ref.name === name ? { personId: created.id, name } : ref,
      ),
    );
    setLinkFor({ personId: created.id, name });
  };

  const saveRel = async (): Promise<void> => {
    if (linkFor && relType && dreamerId) {
      await saveRelationship({
        fromPersonId: dreamerId,
        toPersonId: linkFor.personId,
        type: relType,
      });
    }
    setLinkFor(null);
    setRelType('');
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

          {/* Offer to add a newly-typed name to the household as a contact (12 §15.2/§15.6). */}
          {pendingAdd ? (
            <div className={styles.prompt} role="group" aria-label="Add this person to your people">
              <span className={styles.promptText}>
                <UserPlus size={15} aria-hidden="true" />
                Add “{pendingAdd}” to your people?
              </span>
              <Button variant="secondary" onClick={() => void confirmAdd()} disabled={busy}>
                {busy ? 'Adding…' : 'Add as contact'}
              </Button>
              <Button variant="secondary" onClick={() => setPendingAdd(null)} disabled={busy}>
                Not now
              </Button>
            </div>
          ) : null}

          {/* Optional: how the dreamer knows the just-added contact (sharpens future context). */}
          {linkFor ? (
            <div className={styles.prompt} role="group" aria-label="How you know this person">
              <span className={styles.promptText}>How do you know {linkFor.name}? (optional)</span>
              <Select
                aria-label="Relationship"
                value={relType}
                onChange={(e) => setRelType(e.target.value as RelationshipType)}
              >
                <option value="">Choose…</option>
                {REL_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
              <Button variant="secondary" onClick={() => void saveRel()} disabled={!relType}>
                Save
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setLinkFor(null);
                  setRelType('');
                }}
              >
                Skip
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </Field>
  );
}

import { useState } from 'react';
import { X } from 'lucide-react';
import { usePeopleStore } from '../../../stores/peopleStore';
import {
  Button,
  Card,
  Field,
  Heading,
  IconButton,
  Inline,
  Select,
  ShareToggle,
  Stack,
  Text,
  Textarea,
} from '../../../design-system/components';
import type { Person, Relationship, RelationshipInput } from '@shared/channels';
import type { RelationshipType } from '@shared/schemas';
// Derived from the single source of truth in `@selfos/core/sharing` so this picker can never drift from the
// enum, the inverse map, or the sharing surfaces (they all share the same order + labels).
import { RELATIONSHIP_TYPE_LABELS, RELATIONSHIP_TYPE_ORDER } from '@selfos/core/sharing';

const TYPES: { value: RelationshipType; label: string }[] = RELATIONSHIP_TYPE_ORDER.map(
  (value) => ({
    value,
    label: RELATIONSHIP_TYPE_LABELS[value],
  }),
);

const LABELS = new Map(TYPES.map((t) => [t.value, t.label]));

/**
 * One existing relationship: its type + the other person, a removable affordance, and an inline merged
 * **Notes** field with a per-relationship `ShareToggle` (15-shareability §3.3). The toggle governs whether
 * the coach may surface these notes about this relationship in the OTHER person's context. Notes default
 * to shared; a Save action appears only when the row is dirty.
 */
function RelationshipRow({
  relationship,
  otherName,
  typeLabel,
  onSave,
  onRemove,
}: {
  relationship: Relationship;
  otherName: string;
  typeLabel: string;
  onSave: (input: RelationshipInput) => Promise<void>;
  onRemove: () => void;
}): JSX.Element {
  const [notes, setNotes] = useState(relationship.notes ?? '');
  const [shared, setShared] = useState(relationship.notesShared !== false);
  const [saving, setSaving] = useState(false);

  const dirty =
    notes !== (relationship.notes ?? '') || shared !== (relationship.notesShared !== false);

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      await onSave({
        id: relationship.id,
        fromPersonId: relationship.fromPersonId,
        toPersonId: relationship.toPersonId,
        type: relationship.type,
        // Carry the existing structural fields forward — upsertRelationship rebuilds from input, so
        // omitting them would wipe them (none have an editor yet, but this future-proofs the notes save).
        ...(relationship.label !== undefined ? { label: relationship.label } : {}),
        ...(relationship.closeness !== undefined ? { closeness: relationship.closeness } : {}),
        ...(relationship.since !== undefined ? { since: relationship.since } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        notesShared: shared,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <Stack gap={2}>
        <Inline gap={2} justify="space-between">
          <Text size="sm" weight={500}>
            {typeLabel} — {otherName}
          </Text>
          <IconButton aria-label={`Remove relationship with ${otherName}`} onClick={onRemove}>
            <X size={14} aria-hidden="true" />
          </IconButton>
        </Inline>
        <Field
          label="Notes"
          help="What the coach may say about this relationship to the other person."
          labelAction={
            <ShareToggle shared={shared} onChange={setShared} label="Relationship notes" />
          }
        >
          {(p) => (
            <Textarea
              {...p}
              value={notes}
              rows={2}
              placeholder="e.g. together five years; navigating a move"
              onChange={(event) => setNotes(event.target.value)}
            />
          )}
        </Field>
        {dirty ? (
          <Inline>
            <Button variant="secondary" onClick={() => void save()} disabled={saving}>
              Save notes
            </Button>
          </Inline>
        ) : null}
      </Stack>
    </Card>
  );
}

/** Lists and edits the relationships a person has to other people in the household. */
export function RelationshipsEditor({ person }: { person: Person }): JSX.Element {
  const people = usePeopleStore((s) => s.people);
  const relationships = usePeopleStore((s) => s.relationships);
  const saveRelationship = usePeopleStore((s) => s.saveRelationship);
  const removeRelationship = usePeopleStore((s) => s.removeRelationship);

  const [toPersonId, setToPersonId] = useState('');
  const [type, setType] = useState<RelationshipType>('friend');

  const others = people.filter((candidate) => candidate.id !== person.id);
  const mine = relationships.filter(
    (relationship) =>
      relationship.fromPersonId === person.id || relationship.toPersonId === person.id,
  );
  const nameOf = (id: string): string =>
    people.find((candidate) => candidate.id === id)?.displayName ?? 'Unknown';

  const add = async (): Promise<void> => {
    if (!toPersonId) return;
    await saveRelationship({ fromPersonId: person.id, toPersonId, type });
    setToPersonId('');
  };

  return (
    <Card>
      <Stack gap={3}>
        <Heading level={3}>Relationships</Heading>
        {mine.length === 0 ? (
          <Text tone="secondary" size="sm">
            No relationships yet.
          </Text>
        ) : (
          <Stack gap={3}>
            {mine.map((relationship) => {
              const otherId =
                relationship.fromPersonId === person.id
                  ? relationship.toPersonId
                  : relationship.fromPersonId;
              return (
                <RelationshipRow
                  key={relationship.id}
                  relationship={relationship}
                  otherName={nameOf(otherId)}
                  typeLabel={LABELS.get(relationship.type) ?? relationship.type}
                  onSave={saveRelationship}
                  onRemove={() => void removeRelationship(relationship.id)}
                />
              );
            })}
          </Stack>
        )}

        {others.length > 0 ? (
          <Inline gap={2}>
            <Select
              aria-label="Relationship type"
              value={type}
              onChange={(event) => setType(event.target.value as RelationshipType)}
            >
              {TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Related person"
              value={toPersonId}
              onChange={(event) => setToPersonId(event.target.value)}
            >
              <option value="">Choose a person…</option>
              {others.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.displayName}
                </option>
              ))}
            </Select>
            <Button variant="secondary" onClick={() => void add()} disabled={!toPersonId}>
              Add
            </Button>
          </Inline>
        ) : (
          <Text tone="tertiary" size="sm">
            Add more people to link relationships.
          </Text>
        )}
      </Stack>
    </Card>
  );
}

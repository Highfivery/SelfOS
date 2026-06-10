import { useState } from 'react';
import { X } from 'lucide-react';
import { usePeopleStore } from '../../../stores/peopleStore';
import {
  Button,
  Card,
  Heading,
  IconButton,
  Inline,
  Select,
  Stack,
  Text,
} from '../../../design-system/components';
import type { Person } from '@shared/channels';
import type { RelationshipType } from '@shared/schemas';

const TYPES: { value: RelationshipType; label: string }[] = [
  { value: 'partner', label: 'Partner' },
  { value: 'parent', label: 'Parent' },
  { value: 'child', label: 'Child' },
  { value: 'sibling', label: 'Sibling' },
  { value: 'friend', label: 'Friend' },
  { value: 'coworker', label: 'Coworker' },
  { value: 'ex', label: 'Ex' },
  { value: 'other', label: 'Other' },
];

const LABELS = new Map(TYPES.map((t) => [t.value, t.label]));

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
          <Stack gap={2}>
            {mine.map((relationship) => {
              const otherId =
                relationship.fromPersonId === person.id
                  ? relationship.toPersonId
                  : relationship.fromPersonId;
              return (
                <Inline key={relationship.id} gap={2} justify="between">
                  <Text size="sm">
                    {LABELS.get(relationship.type)} — {nameOf(otherId)}
                  </Text>
                  <IconButton
                    aria-label={`Remove relationship with ${nameOf(otherId)}`}
                    onClick={() => void removeRelationship(relationship.id)}
                  >
                    <X size={14} aria-hidden="true" />
                  </IconButton>
                </Inline>
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

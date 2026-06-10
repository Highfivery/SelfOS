import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { usePeopleStore } from '../../../stores/peopleStore';
import {
  Button,
  Card,
  Field,
  Heading,
  IconButton,
  Inline,
  Stack,
  Switch,
  Text,
  TextInput,
} from '../../../design-system/components';
import { RelationshipsEditor } from './RelationshipsEditor';
import { AccessSection } from './AccessSection';
import type { Person } from '@shared/channels';

/** Create or edit a person. Relationships are shown only once the person exists. */
export function PersonEditor({
  person,
  onDone,
}: {
  person: Person | null;
  onDone: () => void;
}): JSX.Element {
  const savePerson = usePeopleStore((s) => s.savePerson);
  const removePerson = usePeopleStore((s) => s.removePerson);

  const [displayName, setDisplayName] = useState(person?.displayName ?? '');
  const [isSubject, setIsSubject] = useState(person?.isSubject ?? false);
  const [pronouns, setPronouns] = useState(person?.pronouns ?? '');
  const [sharedNotes, setSharedNotes] = useState(person?.publicNotes ?? '');
  const [privateNotes, setPrivateNotes] = useState(person?.privateNotes ?? '');
  const [busy, setBusy] = useState(false);

  const save = async (): Promise<void> => {
    if (!displayName.trim()) return;
    setBusy(true);
    try {
      await savePerson({
        ...(person ? { id: person.id } : {}),
        displayName: displayName.trim(),
        isSubject,
        tags: person?.tags ?? [],
        ...(pronouns.trim() ? { pronouns: pronouns.trim() } : {}),
        ...(sharedNotes.trim() ? { publicNotes: sharedNotes.trim() } : {}),
        ...(privateNotes.trim() ? { privateNotes: privateNotes.trim() } : {}),
      });
      onDone();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (!person) return;
    setBusy(true);
    try {
      await removePerson(person.id);
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap={4}>
      <Heading level={3}>{person ? 'Edit person' : 'Add person'}</Heading>
      <Card>
        <Stack gap={4}>
          <Field label="Name">
            {(props) => (
              <TextInput
                {...props}
                value={displayName}
                placeholder="e.g. Sam"
                onChange={(event) => setDisplayName(event.target.value)}
              />
            )}
          </Field>
          <Inline gap={3}>
            <Switch
              checked={isSubject}
              onChange={setIsSubject}
              aria-label="Has their own SelfOS experience"
            />
            <Stack gap={1}>
              <Text size="sm" weight={500}>
                Subject
              </Text>
              <Text size="xs" tone="secondary">
                They have their own sessions — not just a contact for context.
              </Text>
            </Stack>
          </Inline>
          <Field label="Pronouns">
            {(props) => (
              <TextInput
                {...props}
                value={pronouns}
                placeholder="e.g. she/her"
                onChange={(event) => setPronouns(event.target.value)}
              />
            )}
          </Field>
          <Field label="Shared notes" help="Context others' AI may use — keep it shareable.">
            {(props) => (
              <TextInput
                {...props}
                value={sharedNotes}
                placeholder="e.g. loves hiking; works in nursing"
                onChange={(event) => setSharedNotes(event.target.value)}
              />
            )}
          </Field>
          <Field label="Private notes" help="Never shared with anyone else's AI.">
            {(props) => (
              <TextInput
                {...props}
                value={privateNotes}
                placeholder="Just for this person's own sessions"
                onChange={(event) => setPrivateNotes(event.target.value)}
              />
            )}
          </Field>
          <Inline gap={2}>
            <Button
              variant="primary"
              onClick={() => void save()}
              disabled={busy || !displayName.trim()}
            >
              {person ? 'Save' : 'Create'}
            </Button>
            <Button variant="secondary" onClick={onDone} disabled={busy}>
              Cancel
            </Button>
            {person ? (
              <IconButton
                aria-label="Delete person"
                variant="secondary"
                onClick={() => void remove()}
                disabled={busy}
              >
                <Trash2 size={16} aria-hidden="true" />
              </IconButton>
            ) : null}
          </Inline>
        </Stack>
      </Card>
      {person ? <RelationshipsEditor person={person} /> : null}
      {person ? <AccessSection person={person} /> : null}
    </Stack>
  );
}

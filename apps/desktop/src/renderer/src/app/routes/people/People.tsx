import { useEffect, useState } from 'react';
import { ArrowLeft, UserPlus, Users } from 'lucide-react';
import { usePeopleStore } from '../../../stores/peopleStore';
import { Button, Card, Heading, Stack, Text } from '../../../design-system/components';
import { PersonEditor } from './PersonEditor';
import styles from './People.module.css';

type Selection = { mode: 'none' } | { mode: 'new' } | { mode: 'edit'; id: string };

/** The household: a list of people (subjects + contacts) with an editor pane. */
export function People(): JSX.Element {
  const people = usePeopleStore((s) => s.people);
  const loaded = usePeopleStore((s) => s.loaded);
  const load = usePeopleStore((s) => s.load);
  const [selection, setSelection] = useState<Selection>({ mode: 'none' });

  useEffect(() => {
    void load();
  }, [load]);

  const selectedPerson =
    selection.mode === 'edit'
      ? (people.find((person) => person.id === selection.id) ?? null)
      : null;

  // On mobile the list + editor become a master–detail (the editor shows full-width with a back
  // affordance); desktop shows both panes side by side.
  const detailOpen = selection.mode !== 'none';

  return (
    <div className={styles.layout} data-view={detailOpen ? 'detail' : 'list'}>
      <section className={styles.list} aria-label="People">
        <div className={styles.header}>
          <Heading level={2}>People</Heading>
          <Button variant="primary" onClick={() => setSelection({ mode: 'new' })}>
            <UserPlus size={16} aria-hidden="true" />
            Add person
          </Button>
        </div>

        {loaded && people.length === 0 ? (
          <Card>
            <Stack gap={3} align="center">
              <Users size={24} aria-hidden="true" />
              <Text tone="secondary">
                No one here yet. Add the people in your life so SelfOS can hold their context and
                bring them into your sessions.
              </Text>
              <Button variant="secondary" onClick={() => setSelection({ mode: 'new' })}>
                <UserPlus size={16} aria-hidden="true" />
                Add your first person
              </Button>
            </Stack>
          </Card>
        ) : (
          <Stack gap={2}>
            {people.map((person) => {
              const active = selection.mode === 'edit' && selection.id === person.id;
              return (
                <button
                  key={person.id}
                  type="button"
                  className={active ? `${styles.row} ${styles.rowActive}` : styles.row}
                  onClick={() => setSelection({ mode: 'edit', id: person.id })}
                >
                  <span className={styles.rowName}>{person.displayName}</span>
                  <span className={styles.rowBadge}>
                    {person.isSubject ? 'Subject' : 'Contact'}
                  </span>
                </button>
              );
            })}
          </Stack>
        )}
      </section>

      <section className={styles.detail}>
        <button
          type="button"
          className={styles.back}
          onClick={() => setSelection({ mode: 'none' })}
        >
          <ArrowLeft size={16} aria-hidden="true" />
          People
        </button>
        {selection.mode === 'new' ? (
          <PersonEditor key="new" person={null} onDone={() => setSelection({ mode: 'none' })} />
        ) : selectedPerson ? (
          <PersonEditor
            key={selectedPerson.id}
            person={selectedPerson}
            onDone={() => setSelection({ mode: 'none' })}
          />
        ) : (
          <div className={styles.empty}>
            <Text tone="tertiary">Select a person, or add someone new.</Text>
          </div>
        )}
      </section>
    </div>
  );
}

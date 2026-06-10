import { useEffect, useState } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { usePeopleStore } from '../stores/peopleStore';
import { Button, Inline, Stack, Text, TextInput } from '../design-system/components';
import styles from './PersonPicker.module.css';

/**
 * The "who's here?" account list with inline PIN entry, shared by the in-app {@link Switcher} (modal)
 * and the full-screen {@link LockScreen} gate. Switching the active person verifies the PIN in main;
 * on success it calls `onResolved` (and clears the locked state via `switchTo`).
 */
export function PersonPicker({ onResolved }: { onResolved?: () => void }): JSX.Element {
  const access = useSessionStore((s) => s.access);
  const activePerson = useSessionStore((s) => s.activePerson);
  const switchTo = useSessionStore((s) => s.switchTo);
  const people = usePeopleStore((s) => s.people);
  const loadPeople = usePeopleStore((s) => s.load);

  const [pinFor, setPinFor] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadPeople();
  }, [loadPeople]);

  const accounts = access?.accounts ?? [];
  const nameOf = (id: string): string =>
    people.find((candidate) => candidate.id === id)?.displayName ?? 'Someone';

  const choose = async (personId: string, hasPin: boolean): Promise<void> => {
    if (hasPin && pinFor !== personId) {
      setPinFor(personId);
      setPin('');
      setError(null);
      return;
    }
    const result = await switchTo(personId, hasPin ? pin : undefined);
    if (result.ok) onResolved?.();
    else setError('That PIN didn’t match.');
  };

  if (accounts.length === 0) {
    return <Text tone="secondary">No one can sign in yet. Grant access from a person’s page.</Text>;
  }

  return (
    <Stack gap={2}>
      {accounts.map((account) => (
        <div key={account.personId}>
          <button
            type="button"
            className={
              account.personId === activePerson?.id
                ? `${styles.choice} ${styles.choiceActive}`
                : styles.choice
            }
            onClick={() => void choose(account.personId, account.hasPin)}
          >
            <span className={styles.name}>{nameOf(account.personId)}</span>
            <span className={styles.role}>{account.roleId}</span>
          </button>
          {pinFor === account.personId ? (
            <Inline gap={2} className={styles.pinRow}>
              <TextInput
                type="password"
                aria-label={`PIN for ${nameOf(account.personId)}`}
                value={pin}
                placeholder="Enter PIN"
                onChange={(event) => setPin(event.target.value)}
              />
              <Button variant="secondary" onClick={() => void choose(account.personId, true)}>
                Enter
              </Button>
            </Inline>
          ) : null}
        </div>
      ))}
      {error ? (
        <Text size="sm" tone="secondary">
          {error}
        </Text>
      ) : null}
    </Stack>
  );
}

import { useState } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { Button, Card, Heading, Inline, Stack, Text, TextInput } from '../design-system/components';
import styles from './Switcher.module.css';

/**
 * The concealed super-admin unlock prompt (04-people-roles §8). Deliberately generic so it doesn't
 * advertise what it is; entered via a hidden long-press on the version in About.
 */
export function SuperAdminUnlock(): JSX.Element {
  const close = useSessionStore((s) => s.closeUnlockPrompt);
  const unlock = useSessionStore((s) => s.unlockSuperAdmin);
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    if (!passphrase) return;
    setBusy(true);
    setError(false);
    const ok = await unlock(passphrase);
    setBusy(false);
    if (!ok) setError(true); // on success the store closes the prompt
  };

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Unlock">
      <Card className={styles.panel}>
        <Stack gap={4}>
          <Stack gap={1}>
            <Heading level={3}>Enter passphrase</Heading>
            <Text size="sm" tone="secondary">
              Administrator access.
            </Text>
          </Stack>
          <TextInput
            type="password"
            aria-label="Passphrase"
            placeholder="Passphrase"
            value={passphrase}
            autoFocus
            onChange={(event) => setPassphrase(event.target.value)}
          />
          {error ? (
            <Text size="sm" tone="secondary">
              That didn’t match.
            </Text>
          ) : null}
          <Inline gap={2}>
            <Button variant="primary" onClick={() => void submit()} disabled={busy || !passphrase}>
              Unlock
            </Button>
            <Button variant="secondary" onClick={close} disabled={busy}>
              Cancel
            </Button>
          </Inline>
        </Stack>
      </Card>
    </div>
  );
}

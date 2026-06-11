import { useState } from 'react';
import { BootLayout } from './BootLayout';
import {
  Button,
  Card,
  Field,
  Heading,
  Stack,
  Text,
  Textarea,
} from '../../design-system/components';
import { useSessionStore } from '../../stores/sessionStore';

/**
 * Join / recover this device (10-multi-device-vault §3.3). Shown when the vault is already
 * initialized but this device doesn't yet hold the master key. Entering the recovery phrase restores
 * the key into this device's secret store — it never re-keys the vault and never creates an owner.
 */
export function UnlockScreen(): JSX.Element {
  const unlock = useSessionStore((s) => s.unlock);

  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = phrase.trim().length > 0 && !busy;

  const submit = async (): Promise<void> => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await unlock(phrase.trim());
      // On success the gate re-evaluates (load ran) and routes onward; nothing to do here.
      if (!ok) {
        setError('That recovery phrase didn’t match this vault. Check for typos and try again.');
      }
    } catch {
      setError('Couldn’t unlock on this device. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <BootLayout>
      <Stack gap={6}>
        <Stack gap={2}>
          <Text tone="accent" size="sm" weight={500}>
            Use SelfOS on this device
          </Text>
          <Heading level={1}>This vault is already set up</Heading>
          <Text tone="secondary">
            Enter your recovery phrase to use this SelfOS vault on this device. It unlocks your
            existing data — it won’t change anything in the vault or create a new account.
          </Text>
        </Stack>
        <Card>
          <Stack gap={4}>
            <Field
              label="Recovery phrase"
              help="The phrase you saved when you first set up SelfOS."
              error={error ?? ''}
            >
              {(props) => (
                <Textarea
                  {...props}
                  autoFocus
                  rows={3}
                  value={phrase}
                  placeholder="word word word …"
                  aria-busy={busy || undefined}
                  onChange={(event) => {
                    setPhrase(event.target.value);
                    if (error) setError(null);
                  }}
                />
              )}
            </Field>
            <div>
              <Button variant="primary" onClick={() => void submit()} disabled={!canSubmit}>
                {busy ? 'Unlocking…' : 'Unlock'}
              </Button>
            </div>
          </Stack>
        </Card>
      </Stack>
    </BootLayout>
  );
}

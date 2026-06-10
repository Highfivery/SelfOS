import { useState } from 'react';
import { BootLayout } from './BootLayout';
import {
  Banner,
  Button,
  Card,
  Field,
  Heading,
  Stack,
  Text,
  TextInput,
} from '../../design-system/components';
import { useSessionStore } from '../../stores/sessionStore';

/**
 * First-run household setup (04-people-roles §3.1): name the owner, set the super-admin passphrase,
 * then show the recovery phrase once. Runs after the vault is chosen, before the app.
 */
export function Setup(): JSX.Element {
  const setup = useSessionStore((s) => s.setup);
  const load = useSessionStore((s) => s.load);

  const [name, setName] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryPhrase, setRecoveryPhrase] = useState<string | null>(null);

  const canSubmit = name.trim().length > 0 && passphrase.length >= 6 && passphrase === confirm;

  const submit = async (): Promise<void> => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      setRecoveryPhrase(await setup({ ownerName: name.trim(), passphrase }));
    } catch {
      setError('Couldn’t complete setup. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (recoveryPhrase) {
    return (
      <BootLayout>
        <Stack gap={6}>
          <Stack gap={2}>
            <Text tone="accent" size="sm" weight={500}>
              Save your recovery phrase
            </Text>
            <Heading level={1}>Write this down</Heading>
            <Text tone="secondary">
              This phrase restores your encrypted data if you lose access to this device or forget
              your passphrase. It is shown only once and is never stored anywhere you can read it
              later.
            </Text>
          </Stack>
          <Card>
            <Stack gap={4}>
              <Text serif size="md" weight={600}>
                {recoveryPhrase}
              </Text>
              <Banner tone="warning">
                Keep it somewhere safe and private. Without it — and this device — your data can’t
                be recovered.
              </Banner>
              <div>
                <Button variant="primary" onClick={() => void load()}>
                  I’ve saved it — continue
                </Button>
              </div>
            </Stack>
          </Card>
        </Stack>
      </BootLayout>
    );
  }

  return (
    <BootLayout>
      <Stack gap={6}>
        <Stack gap={2}>
          <Text tone="accent" size="sm" weight={500}>
            Set up SelfOS
          </Text>
          <Heading level={1}>Create your profile</Heading>
          <Text tone="secondary">
            SelfOS encrypts your data on this device. Tell us your name and set a super-admin
            passphrase — you’ll use it to manage everyone in your household.
          </Text>
        </Stack>
        <Card>
          <Stack gap={4}>
            <Field label="Your name">
              {(props) => (
                <TextInput
                  {...props}
                  value={name}
                  placeholder="e.g. Alex"
                  onChange={(event) => setName(event.target.value)}
                />
              )}
            </Field>
            <Field label="Super-admin passphrase" help="At least 6 characters.">
              {(props) => (
                <TextInput
                  {...props}
                  type="password"
                  value={passphrase}
                  onChange={(event) => setPassphrase(event.target.value)}
                />
              )}
            </Field>
            <Field
              label="Confirm passphrase"
              error={confirm.length > 0 && confirm !== passphrase ? 'Passphrases don’t match.' : ''}
            >
              {(props) => (
                <TextInput
                  {...props}
                  type="password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                />
              )}
            </Field>
            {error ? <Banner tone="danger">{error}</Banner> : null}
            <div>
              <Button variant="primary" onClick={() => void submit()} disabled={!canSubmit || busy}>
                {busy ? 'Setting up…' : 'Create profile'}
              </Button>
            </div>
          </Stack>
        </Card>
      </Stack>
    </BootLayout>
  );
}

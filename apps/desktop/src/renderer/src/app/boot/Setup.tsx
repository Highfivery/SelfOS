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
import { MIN_OWNER_PIN_LENGTH } from '@shared/channels';

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
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryPhrase, setRecoveryPhrase] = useState<string | null>(null);

  const canSubmit =
    name.trim().length > 0 &&
    passphrase.length >= 6 &&
    passphrase === confirm &&
    pin.length >= MIN_OWNER_PIN_LENGTH &&
    pin === confirmPin;

  const submit = async (): Promise<void> => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const phrase = await setup({ ownerName: name.trim(), passphrase, pin });
      // A fresh vault returns a recovery phrase to show once; resuming an interrupted setup returns
      // none (the phrase was already issued), so go straight into the app.
      if (phrase) setRecoveryPhrase(phrase);
      else await load();
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
            <Field
              label="Your PIN"
              help={`At least ${MIN_OWNER_PIN_LENGTH} characters. You’ll use it to unlock your profile — including on another device.`}
            >
              {(props) => (
                <TextInput
                  {...props}
                  type="password"
                  value={pin}
                  onChange={(event) => setPin(event.target.value)}
                />
              )}
            </Field>
            <Field
              label="Confirm PIN"
              error={confirmPin.length > 0 && confirmPin !== pin ? 'PINs don’t match.' : ''}
            >
              {(props) => (
                <TextInput
                  {...props}
                  type="password"
                  value={confirmPin}
                  onChange={(event) => setConfirmPin(event.target.value)}
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

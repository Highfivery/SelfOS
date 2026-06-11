import { useState } from 'react';
import { BootLayout } from './BootLayout';
import {
  Button,
  Card,
  Field,
  Heading,
  Stack,
  Text,
  TextInput,
  Textarea,
} from '../../design-system/components';
import { useSessionStore } from '../../stores/sessionStore';
import { MIN_OWNER_PIN_LENGTH } from '@shared/channels';

type Mode = 'recovery' | 'invite';
type InviteStep = 'code' | 'pin';

/**
 * Join / recover this device (10-multi-device-vault §3.3, §5.4). Shown when the vault is initialized
 * but this device doesn't hold the master key. Two ways in: the owner's **recovery phrase**, or a
 * member's **one-time invite code** (then they set their own PIN). Neither re-keys the vault.
 */
/** `resumeJoin` enters straight at the "Set your PIN" step — for a member who redeemed an invite but
 *  hasn't finished (e.g. a crash between redeem and finish); the gate routes here on next boot. */
export function UnlockScreen({ resumeJoin = false }: { resumeJoin?: boolean }): JSX.Element {
  const unlock = useSessionStore((s) => s.unlock);
  const redeemInvite = useSessionStore((s) => s.redeemInvite);
  const completeJoin = useSessionStore((s) => s.completeJoin);

  const [mode, setMode] = useState<Mode>(resumeJoin ? 'invite' : 'recovery');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Recovery-phrase flow.
  const [phrase, setPhrase] = useState('');

  // Invite flow.
  const [inviteStep, setInviteStep] = useState<InviteStep>(resumeJoin ? 'pin' : 'code');
  const [code, setCode] = useState('');
  const [memberName, setMemberName] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

  const switchMode = (next: Mode): void => {
    setMode(next);
    setError(null);
    setInviteStep('code');
  };

  const submitRecovery = async (): Promise<void> => {
    if (!phrase.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await unlock(phrase.trim());
      if (!ok) {
        setError('That recovery phrase didn’t match this vault. Check for typos and try again.');
      }
    } catch {
      setError('Couldn’t unlock on this device. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (): Promise<void> => {
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await redeemInvite(code.trim());
      if (result.ok) {
        setMemberName(result.displayName ?? null);
        setInviteStep('pin');
      } else {
        setError('That invite code didn’t match or has expired. Check it and try again.');
      }
    } catch {
      setError('Couldn’t use that code. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const canFinish = pin.length >= MIN_OWNER_PIN_LENGTH && pin === confirmPin && !busy;
  const submitPin = async (): Promise<void> => {
    if (!canFinish) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await completeJoin(pin);
      if (!ok) setError('Couldn’t finish joining. Please try again.');
      // On success the gate re-evaluates (load ran) and routes into the app.
    } catch {
      setError('Couldn’t finish joining. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <BootLayout>
      <Stack gap={6}>
        {mode === 'recovery' ? (
          <>
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
                  <Button
                    variant="primary"
                    onClick={() => void submitRecovery()}
                    disabled={!phrase.trim() || busy}
                  >
                    {busy ? 'Unlocking…' : 'Unlock'}
                  </Button>
                </div>
                <Button variant="ghost" size="sm" onClick={() => switchMode('invite')}>
                  Have an invite code? Use it to join
                </Button>
              </Stack>
            </Card>
          </>
        ) : inviteStep === 'code' ? (
          <>
            <Stack gap={2}>
              <Text tone="accent" size="sm" weight={500}>
                Join SelfOS on this device
              </Text>
              <Heading level={1}>Enter your invite code</Heading>
              <Text tone="secondary">
                Enter the one-time code the owner shared with you to start using the shared vault on
                this device.
              </Text>
            </Stack>
            <Card>
              <Stack gap={4}>
                <Field label="Invite code" error={error ?? ''}>
                  {(props) => (
                    <TextInput
                      {...props}
                      autoFocus
                      value={code}
                      placeholder="word-word-word-word-word-word"
                      aria-busy={busy || undefined}
                      onChange={(event) => {
                        setCode(event.target.value);
                        if (error) setError(null);
                      }}
                    />
                  )}
                </Field>
                <div>
                  <Button
                    variant="primary"
                    onClick={() => void submitCode()}
                    disabled={!code.trim() || busy}
                  >
                    {busy ? 'Checking…' : 'Continue'}
                  </Button>
                </div>
                <Button variant="ghost" size="sm" onClick={() => switchMode('recovery')}>
                  Use your recovery phrase instead
                </Button>
              </Stack>
            </Card>
          </>
        ) : (
          <>
            <Stack gap={2}>
              <Text tone="accent" size="sm" weight={500}>
                Almost there{memberName ? `, ${memberName}` : ''}
              </Text>
              <Heading level={1}>Set your PIN</Heading>
              <Text tone="secondary">
                Choose a PIN you’ll use to sign in on this device. Only you know it — not the owner.
              </Text>
            </Stack>
            <Card>
              <Stack gap={4}>
                <Field label="Your PIN" help={`At least ${MIN_OWNER_PIN_LENGTH} characters.`}>
                  {(props) => (
                    <TextInput
                      {...props}
                      autoFocus
                      type="password"
                      value={pin}
                      onChange={(event) => {
                        setPin(event.target.value);
                        if (error) setError(null);
                      }}
                    />
                  )}
                </Field>
                <Field
                  label="Confirm PIN"
                  error={
                    confirmPin.length > 0 && confirmPin !== pin
                      ? 'PINs don’t match.'
                      : (error ?? '')
                  }
                >
                  {(props) => (
                    <TextInput
                      {...props}
                      type="password"
                      value={confirmPin}
                      onChange={(event) => {
                        setConfirmPin(event.target.value);
                        if (error) setError(null);
                      }}
                    />
                  )}
                </Field>
                <div>
                  <Button variant="primary" onClick={() => void submitPin()} disabled={!canFinish}>
                    {busy ? 'Finishing…' : 'Finish'}
                  </Button>
                </div>
              </Stack>
            </Card>
          </>
        )}
      </Stack>
    </BootLayout>
  );
}

import { useEffect, useState } from 'react';
import { Banner, Button, Card, Heading, Inline, Stack, Text } from '../design-system/components';
import { useAppStore } from '../stores/appStore';
import styles from './ChangeVaultDialog.module.css';

interface ChangeVaultDialogProps {
  /** Close the dialog without changing anything (Cancel / Esc / scrim). A pure no-op. */
  onClose: () => void;
}

/**
 * The "Change vault…" confirmation dialog (14-vault-relinking §3.2). Hand-rolled `role="dialog"`
 * overlay (the app has no Modal primitive — mirrors LockScreen / SuperAdminUnlock). It explains, in
 * plain language, that no data is deleted, that re-opening this vault on this device later needs the
 * recovery phrase, and that a folder picker comes next — then, on Continue, detaches via
 * `appStore.unlink()` and drops the user back into onboarding. Nothing destructive happens, so the
 * tone is reassuring, not a red-alert.
 */
export function ChangeVaultDialog({ onClose }: ChangeVaultDialogProps): JSX.Element {
  const unlink = useAppStore((s) => s.unlink);
  const busy = useAppStore((s) => s.busy);
  const [error, setError] = useState(false);

  // Focus moves into the dialog on open (Continue is `autoFocus`ed) and returns to the trigger on
  // unmount via the browser's default focus restoration; Esc cancels (unless a detach is in flight).
  // This matches the existing LockScreen / SuperAdminUnlock dialogs (no Tab-cycle trap — decision #6).
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const onContinue = async (): Promise<void> => {
    setError(false);
    try {
      // On success the boot phase flips to onboarding and this whole tree unmounts — nothing to close.
      await unlink();
    } catch {
      setError(true); // stay linked + on the dialog; the detach didn't complete
    }
  };

  return (
    <div
      className={styles.overlay}
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <Card
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="change-vault-title"
        aria-describedby="change-vault-desc"
        onClick={(event) => event.stopPropagation()}
      >
        <Stack gap={4}>
          <Heading level={3} id="change-vault-title">
            Change vault
          </Heading>
          <div id="change-vault-desc">
            <Stack gap={3}>
              <ul className={styles.points}>
                <li>
                  <Text size="sm" tone="secondary">
                    <strong>Your data stays safe.</strong> Nothing is deleted — your current vault
                    folder and everything in it are left untouched, ready to open again later.
                  </Text>
                </li>
                <li>
                  <Text size="sm" tone="secondary">
                    <strong>You’ll choose a new folder next.</strong> Pick a fresh folder to start
                    over, or an existing SelfOS vault to open it here.
                  </Text>
                </li>
              </ul>
              <Banner tone="warning">
                To re-open this vault on this device later, you’ll need its recovery phrase. Make
                sure you have it saved.
              </Banner>
              {error ? (
                <Banner tone="danger">
                  Something went wrong. You’re still on your current vault.
                </Banner>
              ) : null}
            </Stack>
          </div>
          <Inline gap={2}>
            <Button
              variant="primary"
              onClick={() => void onContinue()}
              disabled={busy}
              aria-busy={busy}
              autoFocus
            >
              {busy ? 'Changing…' : 'Continue'}
            </Button>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
          </Inline>
        </Stack>
      </Card>
    </div>
  );
}

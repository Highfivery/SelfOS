import { BootLayout } from './BootLayout';
import { Button, Card, Heading, Inline, Stack, Text } from '../../design-system/components';
import { useAppStore } from '../../stores/appStore';
import styles from './VaultError.module.css';

export function VaultError(): JSX.Element {
  const refresh = useAppStore((s) => s.refresh);
  const unlink = useAppStore((s) => s.unlink);
  const vaultPath = useAppStore((s) => s.vaultPath);
  const busy = useAppStore((s) => s.busy);

  return (
    <BootLayout>
      <Card>
        <Stack gap={4}>
          <Stack gap={2}>
            <Heading level={2}>Your vault isn’t reachable</Heading>
            <Text tone="secondary" className={styles.desc}>
              SelfOS couldn’t open your vault{vaultPath ? ` at ${vaultPath}` : ''}. It may be a
              synced folder that’s offline, or it was moved or renamed. Your data is safe.
            </Text>
          </Stack>
          <Inline gap={3} wrap>
            {/* Retry re-checks the SAME folder — the key is still valid (it may just be offline), so
                this must NOT unlink. */}
            <Button variant="primary" onClick={() => void refresh()} disabled={busy}>
              Retry
            </Button>
            {/* "Use a different vault" detaches via unlink (clears the stale key + pointer → onboarding)
                so switching from here is key-safe (14-vault-relinking §7.7) — never re-point with a
                stale key against a different vault. */}
            <Button variant="secondary" onClick={() => void unlink()} disabled={busy}>
              Use a different vault
            </Button>
          </Inline>
        </Stack>
      </Card>
    </BootLayout>
  );
}

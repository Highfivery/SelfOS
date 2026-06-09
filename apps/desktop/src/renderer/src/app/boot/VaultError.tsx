import { BootLayout } from './BootLayout';
import { Button, Card, Heading, Inline, Stack, Text } from '../../design-system/components';
import { useAppStore } from '../../stores/appStore';

export function VaultError(): JSX.Element {
  const refresh = useAppStore((s) => s.refresh);
  const chooseVault = useAppStore((s) => s.chooseVault);
  const vaultPath = useAppStore((s) => s.vaultPath);
  const busy = useAppStore((s) => s.busy);

  return (
    <BootLayout>
      <Card>
        <Stack gap={4}>
          <Stack gap={2}>
            <Heading level={2}>Your vault isn’t reachable</Heading>
            <Text tone="secondary">
              SelfOS couldn’t open your vault{vaultPath ? ` at ${vaultPath}` : ''}. It may be a
              synced folder that’s offline, or it was moved or renamed. Your data is safe.
            </Text>
          </Stack>
          <Inline gap={3} wrap>
            <Button variant="primary" onClick={() => void refresh()} disabled={busy}>
              Retry
            </Button>
            <Button variant="secondary" onClick={() => void chooseVault()} disabled={busy}>
              Choose a different folder
            </Button>
          </Inline>
        </Stack>
      </Card>
    </BootLayout>
  );
}

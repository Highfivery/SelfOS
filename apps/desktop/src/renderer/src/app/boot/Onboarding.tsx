import { FolderOpen } from 'lucide-react';
import { BootLayout } from './BootLayout';
import { Button, Card, Heading, Stack, Text } from '../../design-system/components';
import { useAppStore } from '../../stores/appStore';

export function Onboarding(): JSX.Element {
  const chooseVault = useAppStore((s) => s.chooseVault);
  const busy = useAppStore((s) => s.busy);

  return (
    <BootLayout>
      <Stack gap={6}>
        <Stack gap={2}>
          <Text tone="accent" size="sm" weight={500}>
            Welcome to SelfOS
          </Text>
          <Heading level={1}>A calm space for yourself</Heading>
          <Text tone="secondary">
            A supportive companion for reflection and life coaching — not a substitute for
            professional care. Your entries are saved as plain files in a folder you choose; pick
            one inside Dropbox or iCloud to sync across devices.
          </Text>
        </Stack>

        <Card>
          <Stack gap={4}>
            <Stack gap={1}>
              <Heading level={3}>Choose your vault</Heading>
              <Text tone="secondary" size="sm">
                The folder where SelfOS keeps your data. You can change it later in Settings.
              </Text>
            </Stack>
            <div>
              <Button variant="primary" onClick={() => void chooseVault()} disabled={busy}>
                <FolderOpen size={16} aria-hidden="true" />
                {busy ? 'Setting up…' : 'Choose a folder'}
              </Button>
            </div>
          </Stack>
        </Card>
      </Stack>
    </BootLayout>
  );
}

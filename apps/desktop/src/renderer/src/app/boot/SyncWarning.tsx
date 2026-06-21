import { Banner, Button, Card, Heading, Inline, Stack, Text } from '../../design-system/components';
import { BootLayout } from './BootLayout';

/**
 * The folder-still-syncing warning (29-multi-device-housekeeping §5.D). Shown before first-run Setup when
 * the chosen folder has no `config/recovery.enc` YET but still has not-yet-downloaded iCloud items — so the
 * "absent marker" might just mean "not finished downloading." Advisory, not a lock: "Set up anyway" is an
 * explicit escape hatch, and the `createMasterKey` non-overwrite guard remains the hard data-loss backstop.
 */
export function SyncWarning({
  onCheckAgain,
  onSetUpAnyway,
}: {
  onCheckAgain: () => void;
  onSetUpAnyway: () => void;
}): JSX.Element {
  return (
    <BootLayout>
      <Card>
        <Stack gap={4}>
          <Heading level={2}>This folder is still syncing from iCloud</Heading>
          <Banner tone="warning">
            Wait until it finishes downloading before setting up SelfOS here — otherwise we might
            not see your existing vault.
          </Banner>
          <Text tone="secondary">If this is a brand-new, empty folder, you can set up anyway.</Text>
          <Inline gap={2} align="end">
            <Button variant="secondary" onClick={onSetUpAnyway}>
              Set up anyway
            </Button>
            <Button variant="primary" onClick={onCheckAgain}>
              Check again
            </Button>
          </Inline>
        </Stack>
      </Card>
    </BootLayout>
  );
}

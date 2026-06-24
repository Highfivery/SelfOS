import { Sprout, X } from 'lucide-react';
import { Card, Heading, IconButton, Inline, Stack } from '../../../design-system/components';
import { OrientationBody } from '../../OrientationBody';
import { useDiscoveryStore, DISCOVERY_KEYS } from '../../../stores/discoveryStore';

/**
 * The brief, dismissible first-run orientation card (41 §3.5) — shown once on Home to a first-time person,
 * device-local + per-person. Dismiss removes it for good (re-readable any time from the account menu →
 * "About SelfOS"). Renders nothing until the dismissal state has loaded (so a dismissed card never flashes)
 * and once dismissed.
 */
export function WelcomeOrientationCard(): JSX.Element | null {
  const loaded = useDiscoveryStore((s) => s.loaded);
  const dismissed = useDiscoveryStore((s) => s.dismissed);
  const dismiss = useDiscoveryStore((s) => s.dismiss);

  if (!loaded || dismissed.includes(DISCOVERY_KEYS.orientation)) return null;

  return (
    <Card>
      <Stack gap={3}>
        <Inline gap={2} justify="space-between">
          <Heading level={2}>
            <Sprout size={18} aria-hidden="true" /> How SelfOS works
          </Heading>
          <IconButton
            aria-label="Dismiss welcome"
            onClick={() => dismiss(DISCOVERY_KEYS.orientation)}
          >
            <X size={16} aria-hidden="true" />
          </IconButton>
        </Inline>
        <OrientationBody />
      </Stack>
    </Card>
  );
}

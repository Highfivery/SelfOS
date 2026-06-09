import { BootLayout } from './BootLayout';
import { Heading, Stack, Text } from '../../design-system/components';

export function Splash(): JSX.Element {
  return (
    <BootLayout>
      <Stack gap={2} align="center">
        <Heading level={2}>SelfOS</Heading>
        <Text tone="secondary">Opening…</Text>
      </Stack>
    </BootLayout>
  );
}

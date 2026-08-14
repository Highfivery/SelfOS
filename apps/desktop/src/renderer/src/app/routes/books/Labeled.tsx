import { Stack, Text } from '../../../design-system/components';

export function Labeled({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <Stack gap={2}>
      <Text size="sm" tone="secondary">
        {label}
      </Text>
      {children}
    </Stack>
  );
}

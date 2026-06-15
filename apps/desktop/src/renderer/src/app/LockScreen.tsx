import { Brand } from './Brand';
import { PersonPicker } from './PersonPicker';
import { Card, Heading, Stack, Text } from '../design-system/components';
import styles from './LockScreen.module.css';

/**
 * The full-screen lock gate shown after logout (02-app-shell §3.4). It clears the active person from
 * view and requires re-picking someone — entering their PIN if they have one — to resume. This is a
 * UI reveal-gate: the master key stays in the keychain; locking only hides the active person.
 */
export function LockScreen(): JSX.Element {
  return (
    <div className={styles.screen} role="dialog" aria-modal="true" aria-label="Locked">
      <div className={styles.inner}>
        <Brand />
        <Stack gap={1}>
          <Heading level={1}>Welcome back</Heading>
          <Text tone="secondary">Choose who’s here to continue.</Text>
        </Stack>
        <Card className={styles.card}>
          <PersonPicker />
        </Card>
        <Text size="xs" tone="tertiary">
          SelfOS is a wellness tool — not medical care.
        </Text>
      </div>
    </div>
  );
}

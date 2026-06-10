import { X } from 'lucide-react';
import { Card, Heading, IconButton, Inline, Stack } from '../design-system/components';
import { PersonPicker } from './PersonPicker';
import styles from './Switcher.module.css';

/** "Who's here?" — pick which person is active (verifying a PIN when one is set), as an in-app modal. */
export function Switcher({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Who's here?">
      <Card className={styles.panel}>
        <Stack gap={4}>
          <Inline gap={2} justify="between">
            <Heading level={2}>Who’s here?</Heading>
            <IconButton aria-label="Close" onClick={onClose}>
              <X size={18} aria-hidden="true" />
            </IconButton>
          </Inline>
          <PersonPicker onResolved={onClose} />
        </Stack>
      </Card>
    </div>
  );
}

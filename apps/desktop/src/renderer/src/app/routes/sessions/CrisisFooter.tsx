import { useState } from 'react';
import { LifeBuoy } from 'lucide-react';
import { Button, Stack, Text } from '../../../design-system/components';
import styles from './Sessions.module.css';

/** Always-present crisis affordance (05-conversations §7). Never dismissable. */
export function CrisisFooter(): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <footer className={styles.crisis}>
      <div className={styles.crisisBar}>
        <Text size="xs" tone="secondary">
          SelfOS is wellness support, not medical care.
        </Text>
        <Button variant="secondary" onClick={() => setOpen((value) => !value)}>
          <LifeBuoy size={14} aria-hidden="true" />
          Get help now
        </Button>
      </div>
      {open ? (
        <div className={styles.crisisPanel} role="region" aria-label="Crisis resources">
          <Stack gap={1}>
            <Text size="sm" weight={600}>
              If you’re in immediate danger, call your local emergency number.
            </Text>
            <Text size="sm" tone="secondary">
              US & Canada: call or text <strong>988</strong> (Suicide & Crisis Lifeline). UK & ROI:
              call <strong>116 123</strong> (Samaritans). You can also reach out to someone you
              trust nearby.
            </Text>
          </Stack>
        </div>
      ) : null}
    </footer>
  );
}

import { useEffect } from 'react';
import { Button, Card, Heading, Inline, Stack } from '../design-system/components';
import { OrientationBody } from './OrientationBody';
import styles from './AboutSelfOsDialog.module.css';

/**
 * "About SelfOS / How this works" (41 §3.5) — the re-openable orientation, reachable any time from the
 * account menu so the first-run welcome is never lost once dismissed. A hand-rolled `role="dialog"` overlay
 * (the app has no Modal primitive — mirrors LockScreen / ChangeVaultDialog). Esc / scrim / Close dismiss it;
 * it reads, it doesn't change anything.
 */
export function AboutSelfOsDialog({ onClose }: { onClose: () => void }): JSX.Element {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <Card
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-selfos-title"
        onClick={(event) => event.stopPropagation()}
      >
        <Stack gap={4}>
          <Heading level={2} id="about-selfos-title">
            About SelfOS
          </Heading>
          <OrientationBody />
          <Inline justify="end">
            <Button variant="primary" autoFocus onClick={onClose}>
              Got it
            </Button>
          </Inline>
        </Stack>
      </Card>
    </div>
  );
}

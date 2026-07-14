import { useEffect, useRef, useState } from 'react';
import type { Completion } from '@selfos/core/recommendations';
import { Toast } from '../../../design-system/components';
import { useDiscoveryStore } from '../../../stores/discoveryStore';
import styles from './CelebrationMoment.module.css';

const AUTO_DISMISS_MS = 6000;

/**
 * A warm, transient completion celebration (53 §3.5) — a success `Toast` (the spec-35 primitive) that
 * acknowledges effort/growth, never a streak or score. It celebrates a given completion **once**: the
 * signature is recorded in the device-local per-person discovery store (`celebrate:<key>`) the moment it
 * shows, so re-visiting Home doesn't re-celebrate. Conveyed in text (the message), not motion alone (§9).
 *
 * The caller decides WHETHER to show one (suppressed during crisis / proactivity-off / brand-new, §8); this
 * component only renders + records the chosen completion. Renders nothing when there's nothing to celebrate.
 */
export function CelebrationMoment({
  completion,
}: {
  completion: Completion | null;
}): JSX.Element | null {
  const dismiss = useDiscoveryStore((s) => s.dismiss);
  // Hold the completion we're showing in state. Recording its signature re-renders the PARENT (Home reads the
  // dismissal set), which then stops passing `completion` — without holding it here the toast would flash and
  // vanish. It stays until auto-dismiss or the user closes it.
  const [shown, setShown] = useState<Completion | null>(null);
  const recorded = useRef<string | null>(null);

  useEffect(() => {
    if (completion && recorded.current !== completion.key) {
      recorded.current = completion.key; // record once → a re-render / re-visit never re-celebrates
      dismiss(`celebrate:${completion.key}`);
      setShown(completion);
    }
  }, [completion, dismiss]);

  if (!shown) return null;

  return (
    <div className={styles.viewport} aria-live="polite">
      <Toast
        severity="success"
        title={shown.title}
        {...(shown.body ? { body: shown.body } : {})}
        onClose={() => setShown(null)}
        autoDismissMs={AUTO_DISMISS_MS}
      />
    </div>
  );
}

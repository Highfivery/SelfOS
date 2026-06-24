import type { ReactNode } from 'react';
import { OneTimeTip } from '../design-system/components';
import { useDiscoveryStore, type DiscoveryKey } from '../stores/discoveryStore';

/**
 * A store-bound one-time tip (41 §3.2): renders the presentational `OneTimeTip` only when the active person
 * hasn't dismissed `tipKey` and the dismissal state has loaded (so a dismissed tip never flashes). Dismissal
 * is device-local + per-person. Affordances may also call `useDiscoveryStore().dismiss(tipKey)` directly when
 * the person *uses* the feature, so the tip never re-shows once acted on.
 */
export function DiscoveryTip({
  tipKey,
  children,
}: {
  tipKey: DiscoveryKey;
  children: ReactNode;
}): JSX.Element | null {
  const loaded = useDiscoveryStore((s) => s.loaded);
  const dismissed = useDiscoveryStore((s) => s.dismissed);
  const dismiss = useDiscoveryStore((s) => s.dismiss);

  if (!loaded || dismissed.includes(tipKey)) return null;
  return <OneTimeTip onDismiss={() => dismiss(tipKey)}>{children}</OneTimeTip>;
}

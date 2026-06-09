import { useEffect } from 'react';
import { useAppStore } from '../stores/appStore';
import { Splash } from './boot/Splash';
import { Onboarding } from './boot/Onboarding';
import { VaultError } from './boot/VaultError';
import { Shell } from './Shell';

/** Renders the right surface for the current boot phase (02-app-shell §3.1). */
export function BootGate(): JSX.Element {
  const phase = useAppStore((s) => s.phase);
  const init = useAppStore((s) => s.init);

  useEffect(() => {
    void init();
  }, [init]);

  switch (phase) {
    case 'onboarding':
      return <Onboarding />;
    case 'vault-error':
      return <VaultError />;
    case 'ready':
      return <Shell />;
    case 'starting':
    default:
      return <Splash />;
  }
}

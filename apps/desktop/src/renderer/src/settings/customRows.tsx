import { useEffect, useState } from 'react';
import { FolderOpen, FolderSync } from 'lucide-react';
import { Button, Text } from '../design-system/components';
import { useAppStore } from '../stores/appStore';
import { ChangeVaultDialog } from './ChangeVaultDialog';

export function VaultLocationValue(): JSX.Element {
  const vaultPath = useAppStore((s) => s.vaultPath);
  return (
    <Text size="sm" tone="secondary">
      {vaultPath ?? 'Not set'}
    </Text>
  );
}

export function RevealVaultRow(): JSX.Element {
  return (
    <Button variant="secondary" onClick={() => void window.selfos?.revealVault()}>
      <FolderOpen size={16} aria-hidden="true" />
      Reveal in file manager
    </Button>
  );
}

/**
 * "Change vault…" — unlink the current vault and pick a different one (14-vault-relinking §3.1). Any
 * signed-in person may use it (no admin gate); the confirmation dialog explains what happens.
 */
export function ChangeVaultRow(): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <FolderSync size={16} aria-hidden="true" />
        Change vault…
      </Button>
      {open ? <ChangeVaultDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export function AboutVersion(): JSX.Element {
  const [version, setVersion] = useState('…');

  useEffect(() => {
    let active = true;
    void (async () => {
      const value = await window.selfos?.getAppVersion();
      if (active && value) setVersion(value);
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <Text size="sm" tone="secondary">
      {version}
    </Text>
  );
}

export function AboutDisclaimer(): JSX.Element {
  return (
    <Text size="sm" tone="secondary">
      SelfOS is a wellness and self-help tool — not a medical device and not a substitute for
      professional care. If you’re in crisis, contact local emergency services or a crisis line.
    </Text>
  );
}

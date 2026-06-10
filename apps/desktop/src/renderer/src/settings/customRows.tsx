import { useEffect, useRef, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { Button, Text } from '../design-system/components';
import { useAppStore } from '../stores/appStore';
import { useSessionStore } from '../stores/sessionStore';

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

export function AboutVersion(): JSX.Element {
  const [version, setVersion] = useState('…');
  const openUnlockPrompt = useSessionStore((s) => s.openUnlockPrompt);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Concealed entry to super-admin: a long-press on the version (04-people-roles §3.3).
  const startHold = (): void => {
    timer.current = setTimeout(() => openUnlockPrompt(), 600);
  };
  const cancelHold = (): void => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  return (
    <span
      onPointerDown={startHold}
      onPointerUp={cancelHold}
      onPointerLeave={cancelHold}
      style={{ userSelect: 'none' }}
    >
      <Text size="sm" tone="secondary">
        {version}
      </Text>
    </span>
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

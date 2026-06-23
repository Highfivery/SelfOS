import { useEffect, useState } from 'react';
import { FolderOpen, FolderSync } from 'lucide-react';
import { Button, Inline, Stack, Text } from '../design-system/components';
import { useAppStore } from '../stores/appStore';
import { useUpdateStore } from '../stores/updateStore';
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

  // Build SHA + date make a specific build identifiable (19-distribution §3.3); injected at build
  // time. A `'dev'` SHA / empty values (builds outside git) are omitted so the line reads cleanly.
  const detail = [__BUILD_SHA__, __BUILD_DATE__]
    .filter((part) => part && part !== 'dev')
    .join(' · ');
  const label = version === '…' ? version : `v${version}${detail ? ` · ${detail}` : ''}`;

  return (
    <Text size="sm" tone="secondary">
      {label}
    </Text>
  );
}

/**
 * "Check for updates" — a manual, forced update check (36-update-awareness §3.2). Reflects background
 * checks too (it reads the shared `updateStore`), so the result line stays accurate after an auto check.
 * States: idle → checking (`aria-busy`) → up-to-date / available + "View release" / a calm error. Results
 * are announced via a `role="status"` live region (§9). Not admin-gated — any signed-in person may check.
 */
export function CheckForUpdatesControl(): JSX.Element {
  const result = useUpdateStore((s) => s.result);
  const status = useUpdateStore((s) => s.status);
  const errored = useUpdateStore((s) => s.errored);
  const check = useUpdateStore((s) => s.check);
  const checking = status === 'checking';

  const available = result?.isUpdateAvailable === true;

  return (
    <Stack gap={2}>
      <Inline gap={3} align="center" wrap>
        <Button
          variant="secondary"
          onClick={() => void check(true)}
          disabled={checking}
          aria-busy={checking}
        >
          {checking ? 'Checking…' : 'Check for updates'}
        </Button>
        {available ? (
          <Button
            variant="primary"
            onClick={() => void window.selfos?.openExternal(result.releaseUrl)}
          >
            View release
          </Button>
        ) : null}
      </Inline>
      <div role="status" aria-live="polite">
        {!checking && available ? (
          <Text size="sm" tone="accent">
            Update available: v{result.latest} (you’re on v{result.current}).
          </Text>
        ) : null}
        {!checking && result && !available && !errored ? (
          <Text size="sm" tone="secondary">
            You’re up to date (v{result.current}).
          </Text>
        ) : null}
        {!checking && errored ? (
          <Text size="sm" tone="secondary">
            Couldn’t check right now. Try again in a moment.
          </Text>
        ) : null}
      </div>
    </Stack>
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

import { useEffect, useState } from 'react';
import { Laptop, Smartphone, Globe } from 'lucide-react';
import {
  Banner,
  Button,
  Card,
  Heading,
  Inline,
  Stack,
  Text,
  TextInput,
} from '../design-system/components';
import type { DeviceView, KeyRotateResult } from '@shared/channels';
import styles from './DevicesControl.module.css';

/** A relative "time ago" from an ISO timestamp (coarse — minutes/hours/days). */
function timeAgo(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 'unknown';
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function PlatformIcon({ platform }: { platform: string }): JSX.Element {
  if (platform === 'ios') return <Smartphone size={16} aria-hidden="true" />;
  if (platform === 'web') return <Globe size={16} aria-hidden="true" />;
  return <Laptop size={16} aria-hidden="true" />;
}

const ROTATE_ERROR: Record<string, string> = {
  SYNC_CONFLICT_UNRESOLVED: 'Resolve the sync conflicts in your vault first, then try again.',
  NO_MASTER_KEY: "This device can't re-key the vault.",
  ROTATION_IN_PROGRESS: 'A re-key is already in progress.',
  CANNOT_REVOKE_THIS_DEVICE: "You can't revoke the device you're using.",
  FILE_CORRUPT:
    "A vault file couldn't be read — restore it from your sync history, then try again.",
  NOT_PERMITTED: 'Only the household owner can re-key the vault.',
  ERROR: "Re-keying didn't finish. Your vault is unchanged and safe.",
};

/**
 * The serious "Revoke & re-key" dialog (32 §3.1). Re-keying re-encrypts the whole vault, changes the
 * recovery phrase, and signs out every other device — so this dialog is deliberately consequential, not the
 * calm tone of the vault-unlink dialog. On success it shows the NEW recovery phrase once.
 */
function RevokeDeviceDialog({
  device,
  onClose,
  onRevoked,
}: {
  device: DeviceView;
  onClose: () => void;
  onRevoked: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phrase, setPhrase] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !busy && !phrase) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, phrase, onClose]);

  const revoke = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result: KeyRotateResult | undefined = await window.selfos?.keysRotate({
        revokeDeviceIds: [device.deviceId],
      });
      if (result?.ok) {
        setPhrase(result.recoveryPhrase);
        onRevoked();
      } else {
        setError(ROTATE_ERROR[result?.code ?? 'ERROR'] ?? ROTATE_ERROR.ERROR!);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={`Revoke ${device.label}`}
    >
      <Card className={styles.panel}>
        {phrase ? (
          <Stack gap={4}>
            <Heading level={2}>Save your new recovery phrase</Heading>
            <Text tone="secondary">
              {device.label} has been revoked and your vault re-keyed. Other devices are signed out
              and must rejoin with this new phrase. Save it now — it won’t be shown again.
            </Text>
            <p className={styles.phrase}>{phrase}</p>
            <Inline gap={2}>
              <Button
                variant="secondary"
                onClick={() => void navigator.clipboard?.writeText(phrase)}
              >
                Copy
              </Button>
              <Button variant="primary" onClick={onClose}>
                Done
              </Button>
            </Inline>
          </Stack>
        ) : (
          <Stack gap={4}>
            <Heading level={2}>Revoke {device.label}?</Heading>
            <Text tone="secondary">This is a serious action. Re-keying your vault will:</Text>
            <ul className={styles.points}>
              <li>
                <Text size="sm">
                  Re-encrypt your entire vault under a new key (may take a moment).
                </Text>
              </li>
              <li>
                <Text size="sm">
                  Change your recovery phrase — you’ll see a new one and must save it.
                </Text>
              </li>
              <li>
                <Text size="sm">
                  Sign out all other devices; they must rejoin with the new phrase.
                </Text>
              </li>
              <li>
                <Text size="sm">Cancel any pending invites (re-issue them afterward).</Text>
              </li>
              <li>
                <Text size="sm">
                  Not erase data the revoked device already had — it stops future access.
                </Text>
              </li>
            </ul>
            {error ? <Banner tone="danger">{error}</Banner> : null}
            <Inline gap={2} align="end">
              <Button variant="secondary" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => void revoke()} disabled={busy}>
                {busy ? 'Re-keying…' : 'Revoke & re-key'}
              </Button>
            </Inline>
            {busy ? (
              <div role="status" aria-live="polite">
                <Text size="sm" tone="secondary">
                  Re-encrypting your vault — don’t close SelfOS.
                </Text>
              </div>
            ) : null}
          </Stack>
        )}
      </Card>
    </div>
  );
}

/** Owner-only Devices panel (32 §3.1) — list / rename / revoke the household's joined devices. */
export function DevicesControl(): JSX.Element {
  const [devices, setDevices] = useState<DeviceView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [revoking, setRevoking] = useState<DeviceView | null>(null);

  const load = async (): Promise<void> => {
    setDevices((await window.selfos?.devicesList()) ?? []);
    setLoaded(true);
  };
  useEffect(() => {
    void load();
  }, []);

  const saveRename = async (deviceId: string): Promise<void> => {
    const label = draft.trim();
    if (label) await window.selfos?.devicesRename({ deviceId, label });
    setRenaming(null);
    await load();
  };

  if (!loaded) return <Text tone="secondary">Loading devices…</Text>;
  const otherCount = devices.filter((d) => !d.isThisDevice).length;

  return (
    <Stack gap={3}>
      <Text size="sm" tone="secondary">
        Devices that have joined your household. Revoking a device re-keys your vault so its copy of
        the key can no longer read your data.
      </Text>
      <div className={styles.list}>
        {devices.map((device) => (
          <Card key={device.deviceId}>
            <div className={styles.row}>
              <div className={styles.rowMain}>
                {renaming === device.deviceId ? (
                  <Inline gap={2}>
                    <TextInput
                      aria-label={`Rename ${device.label}`}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                    />
                    <Button variant="primary" onClick={() => void saveRename(device.deviceId)}>
                      Save
                    </Button>
                    <Button variant="ghost" onClick={() => setRenaming(null)}>
                      Cancel
                    </Button>
                  </Inline>
                ) : (
                  <Stack gap={1}>
                    <Inline gap={2}>
                      <PlatformIcon platform={device.platform} />
                      <Text weight={600}>{device.label}</Text>
                      {device.isThisDevice ? (
                        <Text size="sm" tone="accent">
                          · This device
                        </Text>
                      ) : null}
                    </Inline>
                    <div className={styles.meta}>
                      <Text size="sm" tone="secondary">
                        Last seen {timeAgo(device.lastSeenAt)}
                      </Text>
                      {device.lastActivePersonName ? (
                        <Text size="sm" tone="secondary">
                          · Last used by {device.lastActivePersonName}
                        </Text>
                      ) : null}
                    </div>
                  </Stack>
                )}
              </div>
              {renaming === device.deviceId ? null : (
                <Inline gap={2} className={styles.actions}>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setDraft(device.label);
                      setRenaming(device.deviceId);
                    }}
                  >
                    Rename
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setRevoking(device)}
                    disabled={device.isThisDevice}
                    title={
                      device.isThisDevice
                        ? "You can't revoke the device you're using — unlink it from Settings → Vault instead."
                        : undefined
                    }
                  >
                    Revoke
                  </Button>
                </Inline>
              )}
            </div>
          </Card>
        ))}
      </div>
      {otherCount === 0 ? (
        <Text size="sm" tone="secondary">
          No other devices have joined yet.
        </Text>
      ) : null}
      {revoking ? (
        <RevokeDeviceDialog
          device={revoking}
          onClose={() => {
            setRevoking(null);
            void load();
          }}
          onRevoked={() => void load()}
        />
      ) : null}
    </Stack>
  );
}

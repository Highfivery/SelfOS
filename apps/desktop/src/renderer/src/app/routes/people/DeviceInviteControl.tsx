import { useCallback, useEffect, useState } from 'react';
import { Banner, Button, Inline, Stack, Text } from '../../../design-system/components';
import type { InviteSummary } from '@shared/channels';
import styles from './DeviceInviteControl.module.css';

function formatDate(iso: string): string {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? iso : new Date(parsed).toLocaleDateString();
}

/**
 * Owner control to set up a member on another device (10-multi-device-vault §5.4): generate a one-time
 * invite code (shown once), see/cancel a pending invite. The member enters the code on their device to
 * unlock the shared vault and set their own PIN.
 */
export function DeviceInviteControl({
  personId,
  displayName,
}: {
  personId: string;
  displayName: string;
}): JSX.Element {
  const [pending, setPending] = useState<InviteSummary[]>([]);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    setPending((await window.selfos?.invitesList({ personId })) ?? []);
  }, [personId]);

  // Reset the "Copied" affordance shortly after a copy.
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const generate = async (): Promise<void> => {
    setBusy(true);
    setCopied(false);
    try {
      // Only one code valid at a time — supersede any pending invite for this person.
      for (const invite of pending) await window.selfos?.invitesCancel({ id: invite.id });
      const result = await window.selfos?.invitesCreate({ personId });
      if (result) setCode(result.code);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (id: string): Promise<void> => {
    setBusy(true);
    try {
      await window.selfos?.invitesCancel({ id });
      setCode(null);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const copy = async (): Promise<void> => {
    if (code && navigator.clipboard) {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    }
  };

  return (
    <Stack gap={3} className={styles.section}>
      <Stack gap={1}>
        <Text weight={500}>Set up another device</Text>
        <Text size="sm" tone="secondary">
          Generate a one-time code {displayName} enters on their own device to use the shared vault.
          It works once, expires in 7 days, and they set their own PIN — you never see it.
        </Text>
      </Stack>

      {code ? (
        <div role="status">
          <Stack gap={2}>
            <div className={styles.codeBox} aria-label="Invite code">
              {code}
            </div>
            <Inline gap={2}>
              <Button variant="secondary" onClick={() => void copy()}>
                {copied ? 'Copied' : 'Copy code'}
              </Button>
            </Inline>
            <Banner tone="warning">
              Share this with {displayName} now — it’s shown once and can’t be retrieved later.
            </Banner>
          </Stack>
        </div>
      ) : null}

      {pending.map((invite) => (
        <div key={invite.id} className={styles.pending}>
          <Text size="sm" tone="secondary">
            Invite pending · expires {formatDate(invite.expiresAt)}
          </Text>
          <Button variant="secondary" onClick={() => void cancel(invite.id)} disabled={busy}>
            Cancel
          </Button>
        </div>
      ))}

      <Inline gap={2}>
        <Button variant="secondary" onClick={() => void generate()} disabled={busy}>
          {pending.length > 0 || code ? 'Regenerate code' : 'Generate invite code'}
        </Button>
      </Inline>
    </Stack>
  );
}

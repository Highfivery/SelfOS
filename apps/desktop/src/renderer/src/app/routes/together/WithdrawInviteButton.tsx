import { useState } from 'react';
import { X } from 'lucide-react';
import { Button, Inline, Text } from '../../../design-system/components';

/**
 * Withdraw (undo) a pending Together invitation the recipient hasn't responded to yet (58 §3.4). Initiator-only
 * — the caller only renders this for a withdrawable invite. A deliberate inline confirm (deletes for both), then
 * `onWithdraw` (the store action, which refreshes the list). Shared by the dashboard card + the session page.
 */
export function WithdrawInviteButton({
  onWithdraw,
  size = 'md',
}: {
  onWithdraw: () => Promise<boolean>;
  size?: 'sm' | 'md';
}): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (): Promise<void> => {
    setBusy(true);
    const ok = await onWithdraw();
    // On success the session is gone (the list refreshes it away); on failure, fall back to the idle button.
    if (!ok) {
      setBusy(false);
      setConfirming(false);
    }
  };

  if (!confirming) {
    return (
      <Button variant="ghost" size={size} onClick={() => setConfirming(true)}>
        <X size={14} aria-hidden="true" /> Withdraw invitation
      </Button>
    );
  }
  return (
    <Inline gap={2} align="center">
      <Text size="sm" tone="secondary">
        Withdraw this invitation? It’s removed for both of you.
      </Text>
      <Button
        variant="danger"
        size={size}
        onClick={() => void run()}
        disabled={busy}
        aria-busy={busy}
      >
        Withdraw
      </Button>
      <Button variant="secondary" size={size} onClick={() => setConfirming(false)} disabled={busy}>
        Keep
      </Button>
    </Inline>
  );
}

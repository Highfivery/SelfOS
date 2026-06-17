import { useEffect, useState } from 'react';
import { Send } from 'lucide-react';
import type { PrivacyMode, SensitivityTier } from '@shared/schemas';
import {
  Banner,
  Button,
  Heading,
  SegmentedControl,
  Stack,
  Text,
} from '../../../design-system/components';
import { useRelayStore } from '../../../stores/relayStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { RelayLinkDelivery, ToggleRow } from './RelayLinkDelivery';
import styles from './Questionnaires.module.css';

/** The honest disclosure mirrors the relay page; the recipient sees the derived text there too (§3.2/§8.4). */
const PRIVACY_COPY: Record<PrivacyMode, string> = {
  private:
    'Private: you won’t see their written answers — just the insight drawn from them. Numeric ratings may appear in your trends over time.',
  standard: 'Standard: you’ll see their answers.',
};

interface Minted {
  link: string;
  pin: string;
}

/**
 * The external (relay) send path (08-questionnaires §3.2). Collects the external recipient + privacy +
 * anonymity, mints a zero-knowledge link + PIN, then offers delivery (copy / email / SMS / share). The
 * PIN is included in the message by default, with a per-send opt-out for sensitive sends.
 */
export function RelaySendPanel({
  questionnaireId,
  sensitivity,
  recipientName,
  recipientEmail,
  recipientPhone,
  onDone,
}: {
  questionnaireId: string;
  sensitivity: SensitivityTier;
  // The external recipient is BOUND to the questionnaire at creation (08 §17.3) — the name isn't re-entered
  // here; email/phone seed the delivery fields but stay editable (they're how-to-reach, not identity).
  recipientName: string;
  recipientEmail?: string;
  recipientPhone?: string;
  onDone: () => void;
}): JSX.Element {
  const status = useRelayStore((s) => s.status);
  const loaded = useRelayStore((s) => s.loaded);
  const loadStatus = useRelayStore((s) => s.load);
  const senderName = useSessionStore((s) => s.activePerson?.displayName ?? 'Someone');
  const canManageRelay = useSessionStore((s) => s.can('settings.manage'));

  useEffect(() => {
    if (!loaded) void loadStatus();
  }, [loaded, loadStatus]);

  const sensitive = sensitivity !== 'standard';
  const [anonymous, setAnonymous] = useState(false);
  const [privacy, setPrivacy] = useState<PrivacyMode>('private');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<Minted | null>(null);

  const onSend = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.selfos?.assignmentsCreateRelayLink({
        questionnaireId,
        senderVisibleToRecipient: !anonymous,
        ...(privacy === 'standard'
          ? { privacy: 'standard' as const }
          : { privacy: 'private' as const }),
      });
      if (!result) throw new Error('No relay');
      setMinted({ link: result.link, pin: result.pin });
    } catch (e) {
      setError(
        e instanceof Error && e.message.includes('relay')
          ? 'No relay is connected yet.'
          : 'Could not create the link. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  if (!status?.configured) {
    return (
      <Stack gap={3}>
        <Heading level={3}>Send to someone without SelfOS</Heading>
        <Banner tone="warning">
          {canManageRelay
            ? 'Connect a relay in Settings → Relay to send external links. In-app sending still works.'
            : 'Ask a household admin to set up a relay (Settings → Relay) to send external links. In-app sending still works.'}
        </Banner>
        <div className={styles.footer}>
          <Button variant="secondary" onClick={onDone}>
            Back
          </Button>
        </div>
      </Stack>
    );
  }

  if (minted) {
    const who = anonymous ? 'Someone' : senderName;
    return (
      <Stack gap={4}>
        <Heading level={3}>Share this link</Heading>
        <RelayLinkDelivery
          link={minted.link}
          pin={minted.pin}
          senderName={who}
          sensitive={sensitive}
          {...(recipientEmail ? { recipientEmail } : {})}
          {...(recipientPhone ? { recipientPhone } : {})}
          note="The link is ready to share. You can find it again any time from the questionnaire’s “Share a link”."
          onDone={onDone}
        />
      </Stack>
    );
  }

  return (
    <Stack gap={4}>
      <Heading level={3}>Send to {recipientName}</Heading>
      <Text size="sm" tone="secondary">
        They’ll answer through a private, encrypted web link — no app needed. You’ll add their email
        or phone on the next step.
      </Text>

      <ToggleRow
        label="Send anonymously"
        description="They’ll see “Someone” instead of your name."
        checked={anonymous}
        onChange={setAnonymous}
      />

      <Stack gap={2}>
        <Text size="sm" weight={500}>
          Privacy
        </Text>
        <SegmentedControl<PrivacyMode>
          aria-label="Privacy mode"
          value={privacy}
          onChange={setPrivacy}
          options={[
            { value: 'private', label: 'Private' },
            { value: 'standard', label: 'Standard' },
          ]}
        />
        <Text size="sm" tone="secondary">
          {PRIVACY_COPY[privacy]}
        </Text>
      </Stack>

      {sensitive ? (
        <Banner tone="info">
          This questionnaire is marked sensitive — the recipient will confirm their age before any
          adult content shows.
        </Banner>
      ) : null}

      {error ? <Banner tone="warning">{error}</Banner> : null}

      <div className={styles.footer}>
        <Button variant="primary" onClick={() => void onSend()} disabled={busy}>
          <Send size={16} aria-hidden="true" />
          {busy ? 'Creating link…' : 'Create link'}
        </Button>
        <Button variant="secondary" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
      </div>
    </Stack>
  );
}

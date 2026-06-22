import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Send, Sparkles } from 'lucide-react';
import { compatibilityDisclosure } from '@selfos/core/questionnaires';
import { aiKeyResolved } from '../../aiAvailability';
import type { CompatibilityVisibility, Recipient, SensitivityTier } from '@shared/schemas';
import { Banner, Button, Card, Heading, Stack, Text } from '../../../design-system/components';
import { useSessionStore } from '../../../stores/sessionStore';
import { useSetting } from '../../../settings/useSetting';
import { RelayLinkDelivery } from './RelayLinkDelivery';
import styles from './Questionnaires.module.css';

/**
 * The compatibility send panel (08-questionnaires §3.6/§13.5d/§17.12-B). A compatibility questionnaire always
 * compares **you (the sender) + the one recipient chosen at the start step** — so there is NO participant
 * picker here. A **household** recipient answers in-app; an **external** recipient answers via the relay (the
 * link + PIN are shown once for delivery). On send the AI personalizes a variant for each of you. Requires AI.
 */
export function CompatibilitySendPanel({
  questionnaireId,
  title,
  sensitivity,
  visibility,
  recipient,
  recipientName,
  onCancel,
  onSent,
}: {
  questionnaireId: string;
  title: string;
  sensitivity: SensitivityTier;
  visibility: CompatibilityVisibility;
  recipient: Recipient;
  recipientName: string;
  onCancel: () => void;
  onSent: () => void;
}): JSX.Element {
  const senderName = useSessionStore((s) => s.activePerson?.displayName ?? 'you');
  const displayName =
    recipient.kind === 'external' ? (recipient.displayName ?? 'them') : recipientName;

  const [aiEnabled] = useSetting('ai.enabled');
  const [hasAiKey, setHasAiKey] = useState(false);
  useEffect(() => {
    void aiKeyResolved('anthropic').then(setHasAiKey);
  }, []);
  const aiReady = aiEnabled === true && hasAiKey;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [minted, setMinted] = useState<{ link: string; pin: string } | null>(null);
  // Set when a relay IS connected but the link mint failed — shown in the done state (not swallowed).
  const [linkError, setLinkError] = useState<string | null>(null);
  // Whether a relay is connected — drives the no-link hint (connect one vs the mint-failed message).
  const [relayConfigured, setRelayConfigured] = useState<boolean | null>(null);
  const canManageRelay = useSessionStore((s) => s.can('settings.manage'));
  useEffect(() => {
    void window.selfos?.relayStatus().then((s) => setRelayConfigured(s.configured));
  }, []);

  // What the recipient is told (the honesty guard) — written from their point of view, naming the sender as
  // the other participant (§16.1). The sender authored it, so no disclosure is shown to them.
  const recipientDisclosure = compatibilityDisclosure(visibility, {
    otherParticipantName: senderName,
    senderName,
    viewerIsSender: false,
  });

  const onSend = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      // The two participants (sender + the bound recipient) are derived in the bridge from the questionnaire.
      const result = await window.selfos?.assignmentsCreateCompatibility({ questionnaireId });
      if (!result?.ok) {
        setError(result?.message ?? 'Could not send this questionnaire. Please try again.');
        return;
      }
      // The recipient's link (household with a relay, OR external) → show delivery. Otherwise it's Inbox-
      // only: either the relay mint failed (surface it) or no relay is connected (the done state hints how).
      if (result.link && result.pin) setMinted({ link: result.link, pin: result.pin });
      else {
        if (result.linkError) setLinkError(result.linkError);
        setDone(true);
      }
    } catch {
      setError('Could not send this questionnaire. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (minted) {
    return (
      <Card>
        <RelayLinkDelivery
          link={minted.link}
          pin={minted.pin}
          senderName={senderName}
          sensitive={sensitivity !== 'standard'}
          {...(recipient.kind === 'external' && recipient.email
            ? { recipientEmail: recipient.email }
            : {})}
          {...(recipient.kind === 'external' && recipient.phone
            ? { recipientPhone: recipient.phone }
            : {})}
          note={`Send ${displayName} this link. You answer your own version in your Inbox; once you’ve both answered, align in Results. You can find this link again any time from the questionnaire’s “Share a link”.`}
          onDone={onSent}
        />
      </Card>
    );
  }

  if (done) {
    return (
      <Card>
        <Stack gap={3}>
          <Banner tone="info">
            Sent. You and {displayName} each get a personalized version in your Inbox; once you’ve
            both answered, you can align your responses in Results.
          </Banner>
          {linkError ? (
            // A relay IS connected but the link couldn't be minted — say so + point to the retry, never
            // leave the sender wondering where the link is.
            <Banner tone="warning">
              We couldn’t create {displayName}’s share link just now ({linkError}). It’s in their
              Inbox; to also send a link by email or text, open <strong>Results</strong> and choose{' '}
              <strong>Resend link</strong>.
            </Banner>
          ) : relayConfigured === false ? (
            // No relay connected — a link needs one. Tell the sender how to enable it (never silent).
            <Banner tone="info">
              They’ll answer in their Inbox.{' '}
              {canManageRelay ? (
                <>
                  To also send them a link by email or text, connect a relay in{' '}
                  <Link to="/settings">Settings → Relay</Link>.
                </>
              ) : (
                <>Ask a household admin to connect a relay (Settings → Relay) to share a link.</>
              )}
            </Banner>
          ) : null}
          <div className={styles.footer}>
            <Button variant="primary" onClick={onSent}>
              Done
            </Button>
          </div>
        </Stack>
      </Card>
    );
  }

  if (!aiReady) {
    return (
      <Card>
        <Stack gap={3}>
          <Heading level={3}>Send “{title}”</Heading>
          <Banner tone="info">
            Compatibility questionnaires need AI to personalize each person’s version. Turn on AI in{' '}
            <Link to="/settings">Settings</Link> to send this.
          </Banner>
          <div className={styles.footer}>
            <Button variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </Stack>
      </Card>
    );
  }

  return (
    <Card>
      <Stack gap={4}>
        <Heading level={3}>Send “{title}”</Heading>
        <Text size="sm" tone="secondary">
          This compares <strong>you</strong> with <strong>{displayName}</strong>.{' '}
          <Sparkles size={12} aria-hidden="true" /> AI personalizes a version for each of you, so
          your answers line up for the report.
        </Text>

        <Stack gap={1}>
          <Text size="sm" weight={500}>
            {displayName} will be told
          </Text>
          <Text size="sm" tone="secondary">
            {recipientDisclosure}
          </Text>
        </Stack>

        {error ? <Banner tone="warning">{error}</Banner> : null}

        <div className={styles.footer}>
          <Button variant="primary" onClick={() => void onSend()} disabled={busy}>
            <Send size={16} aria-hidden="true" />
            {busy ? 'Sending…' : 'Send'}
          </Button>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        </div>
      </Stack>
    </Card>
  );
}

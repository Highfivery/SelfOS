import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Link2, Lock, Send } from 'lucide-react';
import type { PrivacyMode, Recipient, SensitivityTier } from '@shared/schemas';
import {
  Banner,
  Button,
  Card,
  Field,
  Heading,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
} from '../../../design-system/components';
import { useSessionStore } from '../../../stores/sessionStore';
import { RelaySendPanel } from './RelaySendPanel';
import styles from './Questionnaires.module.css';

/** Per-mode disclosure copy — this is what the recipient is told, so the promise stays honest (§3.2/§8). */
const PRIVACY_COPY: Record<PrivacyMode, string> = {
  private:
    'You won’t see their individual responses — just the insight drawn from them. Their numeric ratings may appear in your trends over time.',
  standard: 'Standard: you’ll see their answers.',
};

/**
 * The in-app send panel (08-questionnaires §3.2/§17.3). The recipient is BOUND to the questionnaire at
 * creation, so this panel no longer picks one — it confirms the bound recipient + privacy mode, then sends
 * (freezing the immutable snapshot). An external-bound questionnaire goes through the relay panel instead.
 */
export function QuestionnaireSendPanel({
  questionnaireId,
  title,
  sensitivity,
  recipient,
  recipientLabel,
  onCancel,
  onSent,
}: {
  questionnaireId: string;
  title: string;
  sensitivity: SensitivityTier;
  recipient: Recipient;
  recipientLabel: string;
  onCancel: () => void;
  onSent: (recipientName: string) => void;
}): JSX.Element {
  const [privacy, setPrivacy] = useState<PrivacyMode>('private'); // default: Private
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  // When a relay is connected, the in-app send ALSO mints a link the recipient can answer anywhere (§17.13).
  const [link, setLink] = useState<string | null>(null);
  const [pin, setPin] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // Whether a relay is connected — drives the "you'll also get a shareable link" affordance (§17.13). A link
  // can only exist with a relay (it's a server-delivered surface); without one the send is Inbox-only.
  const [relayConfigured, setRelayConfigured] = useState<boolean | null>(null);
  const canManageRelay = useSessionStore((s) => s.can('settings.manage'));

  useEffect(() => {
    void window.selfos?.relayStatus().then((s) => setRelayConfigured(s.configured));
  }, []);

  const copy = async (label: string, value: string): Promise<void> => {
    await navigator.clipboard?.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1500);
  };

  // Discoverability: a household send can ALSO carry a link, but only with a connected relay. When there's
  // none, tell the sender how to enable it (admins can; members are pointed at an admin) so the feature
  // isn't silently invisible.
  const relayHint =
    relayConfigured === false ? (
      <Banner tone="info">
        <Link2 size={14} aria-hidden="true" /> They’ll answer in their Inbox.{' '}
        {canManageRelay ? (
          <>
            To also give them a link they can answer from any device, connect a relay in{' '}
            <Link to="/settings">Settings → Relay</Link>.
          </>
        ) : (
          <>Ask a household admin to connect a relay (Settings → Relay) to also share a link.</>
        )}
      </Banner>
    ) : null;

  // An external-bound questionnaire is delivered by link — defer entirely to the relay panel.
  if (recipient.kind === 'external') {
    return (
      <Card>
        <Stack gap={4}>
          <RelaySendPanel
            questionnaireId={questionnaireId}
            sensitivity={sensitivity}
            recipientName={recipient.displayName ?? 'them'}
            {...(recipient.email ? { recipientEmail: recipient.email } : {})}
            {...(recipient.phone ? { recipientPhone: recipient.phone } : {})}
            onDone={onCancel}
          />
        </Stack>
      </Card>
    );
  }

  const onSend = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.selfos?.assignmentsCreate({ questionnaireId, privacy });
      if (result?.link && result.pin) {
        setLink(result.link);
        setPin(result.pin);
      }
      setSentTo(recipientLabel);
    } catch {
      setError('Could not send this questionnaire. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (sentTo) {
    return (
      <Card>
        <Stack gap={3}>
          <Banner tone="info">
            Sent to {sentTo}. It’s waiting in their Inbox the next time they’re here.
          </Banner>
          {link && pin ? (
            <Stack gap={3}>
              <Text size="sm" tone="secondary">
                They can also answer anywhere with this link + PIN — whichever they use first is the
                one that counts. We don’t keep a copy of the PIN, so share it now.
              </Text>
              <Field label="Secure link">
                {(props) => (
                  <div className={styles.copyRow}>
                    <TextInput {...props} readOnly value={link} />
                    <Button variant="secondary" onClick={() => void copy('link', link)}>
                      <Copy size={15} aria-hidden="true" />
                      {copied === 'link' ? 'Copied' : 'Copy'}
                    </Button>
                  </div>
                )}
              </Field>
              <Field label="PIN">
                {(props) => (
                  <div className={styles.copyRow}>
                    <TextInput {...props} readOnly value={pin} className={styles.pinValue} />
                    <Button variant="secondary" onClick={() => void copy('pin', pin)}>
                      <Copy size={15} aria-hidden="true" />
                      {copied === 'pin' ? 'Copied' : 'Copy'}
                    </Button>
                  </div>
                )}
              </Field>
            </Stack>
          ) : (
            relayHint
          )}
          <div className={styles.footer}>
            <Button variant="primary" onClick={() => onSent(sentTo)}>
              Done
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
          This goes to <strong>{recipientLabel}</strong>.
        </Text>

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
            {privacy === 'private' ? (
              <Lock size={12} aria-hidden="true" className={styles.privacyIcon} />
            ) : null}
            {PRIVACY_COPY[privacy]}
          </Text>
        </Stack>

        {relayHint}

        {error ? <Banner tone="warning">{error}</Banner> : null}

        <div className={styles.footer}>
          <Button variant="primary" onClick={() => void onSend()} disabled={busy}>
            <Send size={16} aria-hidden="true" />
            Send
          </Button>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        </div>
      </Stack>
    </Card>
  );
}

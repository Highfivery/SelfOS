import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Send, Sparkles } from 'lucide-react';
import { compatibilityDisclosure } from '@selfos/core/questionnaires';
import { ANTHROPIC_API_KEY_ID } from '@shared/channels';
import type { CompatibilityVisibility, Recipient } from '@shared/schemas';
import {
  Banner,
  Button,
  Card,
  Field,
  Heading,
  Stack,
  Text,
  TextInput,
} from '../../../design-system/components';
import { useSessionStore } from '../../../stores/sessionStore';
import { useSetting } from '../../../settings/useSetting';
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
  visibility,
  recipient,
  recipientName,
  onCancel,
  onSent,
}: {
  questionnaireId: string;
  title: string;
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
    void window.selfos
      ?.secretHas({ id: ANTHROPIC_API_KEY_ID })
      .then((v) => setHasAiKey(Boolean(v)));
  }, []);
  const aiReady = aiEnabled === true && hasAiKey;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [minted, setMinted] = useState<{ link: string; pin: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // What the recipient is told (the honesty guard) — written from their point of view, naming the sender as
  // the other participant (§16.1). The sender authored it, so no disclosure is shown to them.
  const recipientDisclosure = compatibilityDisclosure(visibility, {
    otherParticipantName: senderName,
    senderName,
    viewerIsSender: false,
  });

  const copy = async (label: string, value: string): Promise<void> => {
    await navigator.clipboard?.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1500);
  };

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
      // An external recipient answers via the relay — show the link + PIN once for delivery.
      if (result.link && result.pin) setMinted({ link: result.link, pin: result.pin });
      else setDone(true);
    } catch {
      setError('Could not send this questionnaire. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (minted) {
    return (
      <Card>
        <Stack gap={4}>
          <Banner tone="info">
            Send {displayName} this private link + PIN. You answer your own version in your Inbox;
            once you’ve both answered, align in Results — we don’t keep a copy of the PIN.
          </Banner>
          <Field label="Secure link">
            {(props) => (
              <div className={styles.copyRow}>
                <TextInput {...props} readOnly value={minted.link} />
                <Button variant="secondary" onClick={() => void copy('link', minted.link)}>
                  <Copy size={15} aria-hidden="true" />
                  {copied === 'link' ? 'Copied' : 'Copy'}
                </Button>
              </div>
            )}
          </Field>
          <Field label="PIN">
            {(props) => (
              <div className={styles.copyRow}>
                <TextInput {...props} readOnly value={minted.pin} className={styles.pinValue} />
                <Button variant="secondary" onClick={() => void copy('pin', minted.pin)}>
                  <Copy size={15} aria-hidden="true" />
                  {copied === 'pin' ? 'Copied' : 'Copy'}
                </Button>
              </div>
            )}
          </Field>
          <div className={styles.footer}>
            <Button variant="primary" onClick={onSent}>
              Done
            </Button>
          </div>
        </Stack>
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

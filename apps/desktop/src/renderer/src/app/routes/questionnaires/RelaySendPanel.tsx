import { useEffect, useMemo, useState } from 'react';
import { Copy, Mail, MessageSquare, Send, Share2 } from 'lucide-react';
import type { PrivacyMode, SensitivityTier } from '@shared/schemas';
import {
  Banner,
  Button,
  Field,
  Heading,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
} from '../../../design-system/components';
import { useRelayStore } from '../../../stores/relayStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useSetting } from '../../../settings/useSetting';
import {
  DEFAULT_RELAY_MESSAGES,
  emailBodyFrom,
  emailSubjectFrom,
  smsBodyFrom,
} from './relayMessages';
import styles from './Questionnaires.module.css';

/** The honest disclosure mirrors the relay page; the recipient sees the derived text there too (§3.2/§8.4). */
const PRIVACY_COPY: Record<PrivacyMode, string> = {
  private:
    'Private (break-glass): you won’t see their written answers — just the insight drawn from them. Numeric ratings may appear in your trends over time.',
  standard: 'Standard: you’ll see their answers.',
};

interface Minted {
  link: string;
  pin: string;
}

/** A labelled toggle row (the `Switch` primitive is the control only — the label is ours). */
function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}): JSX.Element {
  return (
    <div className={styles.toggleRow}>
      <div className={styles.toggleText}>
        <Text size="sm" weight={500}>
          {label}
        </Text>
        {description ? (
          <Text size="sm" tone="secondary">
            {description}
          </Text>
        ) : null}
      </div>
      <Switch aria-label={label} checked={checked} onChange={onChange} />
    </div>
  );
}

/**
 * The external (relay) send path (08-questionnaires §3.2). Collects the external recipient + privacy +
 * anonymity, mints a zero-knowledge link + PIN, then offers delivery (copy / email / SMS / share). The
 * PIN is included in the message by default, with a per-send opt-out for sensitive sends.
 */
export function RelaySendPanel({
  questionnaireId,
  sensitivity,
  onDone,
}: {
  questionnaireId: string;
  sensitivity: SensitivityTier;
  onDone: () => void;
}): JSX.Element {
  const status = useRelayStore((s) => s.status);
  const loaded = useRelayStore((s) => s.loaded);
  const loadStatus = useRelayStore((s) => s.load);
  const senderName = useSessionStore((s) => s.activePerson?.displayName ?? 'Someone');
  const canManageRelay = useSessionStore((s) => s.can('settings.manage'));
  // Fall back to the defaults if the vault setting hasn't been seeded yet (e.g. a fresh vault).
  const messages = useSetting('questionnaires.defaultMessages')[0] ?? DEFAULT_RELAY_MESSAGES;

  useEffect(() => {
    if (!loaded) void loadStatus();
  }, [loaded, loadStatus]);

  const sensitive = sensitivity !== 'standard';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [privacy, setPrivacy] = useState<PrivacyMode>('private');
  const [includePin, setIncludePin] = useState(!sensitive); // sensitive sends default to sharing the PIN separately
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<Minted | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const onSend = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.selfos?.assignmentsCreateRelayLink({
        questionnaireId,
        recipient: {
          kind: 'external',
          ...(name.trim() ? { displayName: name.trim() } : {}),
          ...(email.trim() ? { email: email.trim() } : {}),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
        },
        senderVisibleToRecipient: !anonymous,
        ...(privacy === 'standard'
          ? { privacy: 'standard' as const }
          : { privacy: 'private' as const }),
      });
      if (!result) throw new Error('No relay');
      setMinted({ link: result.link, pin: result.pin });
      const who = anonymous ? 'Someone' : senderName;
      setMessage(
        emailBodyFrom(messages, {
          sender: who,
          link: result.link,
          pin: result.pin,
          includePin: !sensitive,
        }),
      );
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

  const copy = async (label: string, value: string): Promise<void> => {
    await navigator.clipboard?.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1500);
  };

  const canShare = useMemo(() => typeof navigator !== 'undefined' && 'share' in navigator, []);

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
        <Banner tone="info">
          The link is ready. We don’t keep a copy of the PIN — share it now.
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

        <Stack gap={2}>
          <ToggleRow
            label="Include the PIN in the message"
            checked={includePin}
            onChange={(next) => {
              setIncludePin(next);
              setMessage(
                emailBodyFrom(messages, {
                  sender: who,
                  link: minted.link,
                  pin: minted.pin,
                  includePin: next,
                }),
              );
            }}
          />
          {sensitive ? (
            <Text size="sm" tone="secondary">
              This is a sensitive questionnaire — consider sharing the PIN separately.
            </Text>
          ) : null}
        </Stack>

        <Field label="Message">
          {(props) => (
            <Textarea
              {...props}
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          )}
        </Field>

        <div className={styles.deliveryRow}>
          <Button
            variant="primary"
            onClick={() => {
              const subject = emailSubjectFrom(messages, who);
              window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
            }}
          >
            <Mail size={15} aria-hidden="true" />
            Email
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              const sms = smsBodyFrom(messages, {
                sender: who,
                link: minted.link,
                pin: minted.pin,
                includePin,
              });
              window.location.href = `sms:${encodeURIComponent(phone)}?&body=${encodeURIComponent(sms)}`;
            }}
          >
            <MessageSquare size={15} aria-hidden="true" />
            Text
          </Button>
          {canShare ? (
            <Button
              variant="secondary"
              onClick={() =>
                void navigator
                  .share({ title: 'A questionnaire for you', text: message, url: minted.link })
                  .catch(() => undefined)
              }
            >
              <Share2 size={15} aria-hidden="true" />
              Share
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => void copy('message', message)}>
            <Copy size={15} aria-hidden="true" />
            {copied === 'message' ? 'Copied' : 'Copy message'}
          </Button>
        </div>

        <div className={styles.footer}>
          <Button variant="primary" onClick={onDone}>
            Done
          </Button>
        </div>
      </Stack>
    );
  }

  return (
    <Stack gap={4}>
      <Heading level={3}>Send to someone without SelfOS</Heading>
      <Text size="sm" tone="secondary">
        They’ll answer through a private, encrypted web link — no app needed.
      </Text>

      <Field label="Their name (optional)">
        {(props) => <TextInput {...props} value={name} onChange={(e) => setName(e.target.value)} />}
      </Field>
      <Field label="Email (optional)">
        {(props) => (
          <TextInput
            {...props}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        )}
      </Field>
      <Field label="Phone (optional)">
        {(props) => (
          <TextInput
            {...props}
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        )}
      </Field>

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

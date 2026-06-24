import { useMemo, useState, type ReactNode } from 'react';
import { Copy, Mail, MessageSquare, RefreshCw, Share2 } from 'lucide-react';
import {
  Banner,
  Button,
  Field,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
} from '../../../design-system/components';
import { useSetting } from '../../../settings/useSetting';
import {
  DEFAULT_RELAY_MESSAGES,
  emailBodyFrom,
  emailSubjectFrom,
  smsBodyFrom,
} from './relayMessages';
import styles from './Questionnaires.module.css';

/**
 * Lightweight format checks for building `mailto:`/`sms:` links (38 §3.9). A typo'd value would otherwise
 * build a dead link; instead an invalid (non-empty) value disables that one action with a quiet hint, while
 * Copy / Share / the raw link stay usable. Empty = allowed (the sender fills the recipient in their client).
 */
export function isLikelyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
export function isLikelyPhone(value: string): boolean {
  const trimmed = value.trim();
  return /^\+?[\d\s().-]{7,}$/.test(trimmed) && (trimmed.match(/\d/g)?.length ?? 0) >= 7;
}

/** A labelled toggle row (the `Switch` primitive is the control only — the label is ours). Shared. */
export function ToggleRow({
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
 * The shared "a link is minted → deliver it" UI (08-questionnaires §17.14): the secure link + PIN, an
 * editable message built from the household's Settings templates (`questionnaires.defaultMessages`), and
 * Email / Text / Share / Copy delivery. Used wherever a relay link exists — the external send panel, a
 * household send (standard + compatibility), and re-sharing from Results — so delivery is identical
 * everywhere. The PIN is shown once (never stored in clear); `sensitive` defaults it OUT of the message.
 */
export function RelayLinkDelivery({
  link,
  pin,
  senderName,
  sensitive,
  recipientEmail,
  recipientPhone,
  note,
  onDone,
  onRefresh,
  refreshing,
}: {
  link: string;
  pin: string;
  senderName: string;
  sensitive: boolean;
  recipientEmail?: string;
  recipientPhone?: string;
  /** Contextual line shown above the link (what to do with it). */
  note?: ReactNode;
  /** When provided, renders a "Done" button (omit when embedded inline in a Results card). */
  onDone?: () => void;
  /**
   * When provided, renders a manual "Refresh" next to the Secure link (08 §17.14d) — regenerate a fresh
   * link + PIN on demand, rather than every time the link is shown. Omit where the link is already fresh
   * (the send-time confirmation).
   */
  onRefresh?: () => void | Promise<void>;
  refreshing?: boolean;
}): JSX.Element {
  const messages = useSetting('questionnaires.defaultMessages')[0] ?? DEFAULT_RELAY_MESSAGES;
  const [email, setEmail] = useState(recipientEmail ?? '');
  const [phone, setPhone] = useState(recipientPhone ?? '');
  const [includePin, setIncludePin] = useState(!sensitive);
  const [message, setMessage] = useState(() =>
    emailBodyFrom(messages, { sender: senderName, link, pin, includePin: !sensitive }),
  );
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (label: string, value: string): Promise<void> => {
    await navigator.clipboard?.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1500);
  };
  const canShare = useMemo(() => typeof navigator !== 'undefined' && 'share' in navigator, []);
  // Only a NON-EMPTY malformed value is an error — empty is fine (the sender addresses it in their client).
  const emailError =
    email.trim() !== '' && !isLikelyEmail(email)
      ? 'That email looks off — fix it, or use Copy / Share instead.'
      : undefined;
  const phoneError =
    phone.trim() !== '' && !isLikelyPhone(phone)
      ? 'That number looks off — fix it, or use Copy / Share instead.'
      : undefined;

  return (
    <Stack gap={4}>
      {note ? <Banner tone="info">{note}</Banner> : null}

      <Field label="Secure link">
        {(props) => (
          <div className={styles.copyRow}>
            <TextInput {...props} readOnly value={link} />
            <Button variant="secondary" onClick={() => void copy('link', link)}>
              <Copy size={15} aria-hidden="true" />
              {copied === 'link' ? 'Copied' : 'Copy'}
            </Button>
            {onRefresh ? (
              <Button
                variant="secondary"
                onClick={() => void onRefresh()}
                disabled={refreshing}
                aria-label="Refresh the link and PIN"
                title="Generate a new link + PIN (the current one stops working)"
              >
                <RefreshCw size={15} aria-hidden="true" />
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </Button>
            ) : null}
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

      <Field label="Email (optional)" {...(emailError ? { error: emailError } : {})}>
        {(props) => (
          <TextInput
            {...props}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
          />
        )}
      </Field>
      <Field label="Phone (optional)" {...(phoneError ? { error: phoneError } : {})}>
        {(props) => (
          <TextInput
            {...props}
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+1 555 123 4567"
          />
        )}
      </Field>

      <Stack gap={2}>
        <ToggleRow
          label="Include the PIN in the message"
          checked={includePin}
          onChange={(next) => {
            setIncludePin(next);
            setMessage(
              emailBodyFrom(messages, { sender: senderName, link, pin, includePin: next }),
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
          disabled={emailError !== undefined}
          onClick={() => {
            const subject = emailSubjectFrom(messages, senderName);
            window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
          }}
        >
          <Mail size={15} aria-hidden="true" />
          Email
        </Button>
        <Button
          variant="secondary"
          disabled={phoneError !== undefined}
          onClick={() => {
            const sms = smsBodyFrom(messages, { sender: senderName, link, pin, includePin });
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
                .share({ title: 'A questionnaire for you', text: message, url: link })
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

      {onDone ? (
        <div className={styles.footer}>
          <Button variant="primary" onClick={onDone}>
            Done
          </Button>
        </div>
      ) : null}
    </Stack>
  );
}

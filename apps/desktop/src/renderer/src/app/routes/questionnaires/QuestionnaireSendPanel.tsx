import { useState } from 'react';
import { Lock, Send } from 'lucide-react';
import type { PrivacyMode, Recipient, SensitivityTier } from '@shared/schemas';
import {
  Banner,
  Button,
  Card,
  Heading,
  SegmentedControl,
  Stack,
  Text,
} from '../../../design-system/components';
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
      await window.selfos?.assignmentsCreate({ questionnaireId, privacy });
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

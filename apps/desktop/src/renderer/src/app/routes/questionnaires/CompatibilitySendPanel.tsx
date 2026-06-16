import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Send, Sparkles } from 'lucide-react';
import { compatibilityDisclosure } from '@selfos/core/questionnaires';
import { ANTHROPIC_API_KEY_ID } from '@shared/channels';
import type { CompatibilityVisibility } from '@shared/schemas';
import { Banner, Button, Card, Heading, Stack, Text } from '../../../design-system/components';
import { useSessionStore } from '../../../stores/sessionStore';
import { useSetting } from '../../../settings/useSetting';
import styles from './Questionnaires.module.css';

/**
 * The compatibility send panel (08-questionnaires §3.6/§13.5d/§17.12-B). A compatibility questionnaire always
 * compares **you (the sender) + the one recipient chosen at the start step** — so there is NO participant
 * picker here (that was the redundant "Who's being compared?" selection). On send the AI personalizes a
 * variant for each of you (so the answers line up for the report) and freezes a paired snapshot each. Requires
 * AI to be on — a compatibility send can't be personalized without it.
 */
export function CompatibilitySendPanel({
  questionnaireId,
  title,
  visibility,
  recipientName,
  onCancel,
  onSent,
}: {
  questionnaireId: string;
  title: string;
  visibility: CompatibilityVisibility;
  recipientName: string;
  onCancel: () => void;
  onSent: () => void;
}): JSX.Element {
  const senderName = useSessionStore((s) => s.activePerson?.displayName ?? 'you');

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
      if (result?.ok) setDone(true);
      else setError(result?.message ?? 'Could not send this questionnaire. Please try again.');
    } catch {
      setError('Could not send this questionnaire. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Card>
        <Stack gap={3}>
          <Banner tone="info">
            Sent. You and {recipientName} each get a personalized version in your Inbox; once you’ve
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
          This compares <strong>you</strong> with <strong>{recipientName}</strong>.{' '}
          <Sparkles size={12} aria-hidden="true" /> AI personalizes a version for each of you, so
          your answers line up for the report.
        </Text>

        <Stack gap={1}>
          <Text size="sm" weight={500}>
            {recipientName} will be told
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

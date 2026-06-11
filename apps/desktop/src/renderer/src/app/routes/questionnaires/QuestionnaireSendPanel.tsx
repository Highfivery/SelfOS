import { useEffect, useState } from 'react';
import { Lock, Send } from 'lucide-react';
import type { PrivacyMode } from '@shared/channels';
import {
  Banner,
  Button,
  Card,
  Field,
  Heading,
  SegmentedControl,
  Select,
  Stack,
  Text,
} from '../../../design-system/components';
import { usePeopleStore } from '../../../stores/peopleStore';
import styles from './Questionnaires.module.css';

/** Per-mode disclosure copy — this is what the recipient is told, so the promise stays honest (§3.2/§8). */
const PRIVACY_COPY: Record<PrivacyMode, string> = {
  private:
    'Break-glass: you won’t see their individual responses — just the insight drawn from them. Their numeric ratings may appear in your trends over time.',
  standard: 'Standard: you’ll see their answers.',
};

/**
 * The in-app send panel (08-questionnaires §3.2). The builder has already saved + validated the
 * questionnaire, so here the sender just picks a household recipient and the privacy mode, then sends —
 * which freezes the immutable snapshot for that assignment. External (relay) delivery lands in §13.6.
 */
export function QuestionnaireSendPanel({
  questionnaireId,
  title,
  onCancel,
  onSent,
}: {
  questionnaireId: string;
  title: string;
  onCancel: () => void;
  onSent: (recipientName: string) => void;
}): JSX.Element {
  const people = usePeopleStore((s) => s.people);
  const loaded = usePeopleStore((s) => s.loaded);
  const loadPeople = usePeopleStore((s) => s.load);
  useEffect(() => {
    if (!loaded) void loadPeople();
  }, [loaded, loadPeople]);

  const [recipientId, setRecipientId] = useState('');
  const [privacy, setPrivacy] = useState<PrivacyMode>('private'); // default: Private (break-glass)
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const recipientName = (id: string): string =>
    people.find((p) => p.id === id)?.displayName ?? 'them';

  const onSend = async (): Promise<void> => {
    if (recipientId === '') {
      setError('Choose who to send this to.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await window.selfos?.assignmentsCreate({
        questionnaireId,
        recipientPersonId: recipientId,
        privacy,
      });
      setSentTo(recipientName(recipientId));
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

        <Field label="Send to">
          {(props) => (
            <Select
              {...props}
              value={recipientId}
              onChange={(event) => {
                setError(null);
                setRecipientId(event.target.value);
              }}
            >
              <option value="">Choose a person…</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </Select>
          )}
        </Field>

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

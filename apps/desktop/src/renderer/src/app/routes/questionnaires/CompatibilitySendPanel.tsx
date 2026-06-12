import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Send, Sparkles } from 'lucide-react';
import { compatibilityDisclosure } from '@selfos/core/questionnaires';
import { ANTHROPIC_API_KEY_ID } from '@shared/channels';
import type { CompatibilityVisibility } from '@shared/schemas';
import {
  Banner,
  Button,
  Card,
  Field,
  Heading,
  Select,
  Stack,
  Text,
} from '../../../design-system/components';
import { usePeopleStore } from '../../../stores/peopleStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useSetting } from '../../../settings/useSetting';
import styles from './Questionnaires.module.css';

/**
 * The compatibility send panel (08-questionnaires §3.6/§13.5d): pick TWO household people, then send.
 * On send the AI personalizes a variant per recipient (so the two answer aligned questions) and freezes a
 * paired snapshot each. Requires AI to be on — a compatibility send can't be personalized without it.
 */
export function CompatibilitySendPanel({
  questionnaireId,
  title,
  visibility,
  onCancel,
  onSent,
}: {
  questionnaireId: string;
  title: string;
  visibility: CompatibilityVisibility;
  onCancel: () => void;
  onSent: () => void;
}): JSX.Element {
  const people = usePeopleStore((s) => s.people);
  const loaded = usePeopleStore((s) => s.loaded);
  const loadPeople = usePeopleStore((s) => s.load);
  const senderName = useSessionStore((s) => s.activePerson?.displayName ?? 'you');
  useEffect(() => {
    if (!loaded) void loadPeople();
  }, [loaded, loadPeople]);

  const [aiEnabled] = useSetting('ai.enabled');
  const [hasAiKey, setHasAiKey] = useState(false);
  useEffect(() => {
    void window.selfos
      ?.secretHas({ id: ANTHROPIC_API_KEY_ID })
      .then((v) => setHasAiKey(Boolean(v)));
  }, []);
  const aiReady = aiEnabled === true && hasAiKey;

  const [aId, setAId] = useState('');
  const [bId, setBId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const onSend = async (): Promise<void> => {
    if (aId === '' || bId === '') {
      setError('Choose two people to send this to.');
      return;
    }
    if (aId === bId) {
      setError('Choose two different people.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await window.selfos?.assignmentsCreateCompatibility({
        questionnaireId,
        recipientPersonIdA: aId,
        recipientPersonIdB: bId,
      });
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
            Sent. Each person will see a personalized version in their Inbox; once both answer, you
            can align their responses in Results.
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
          <Sparkles size={12} aria-hidden="true" /> AI personalizes a version for each person, so
          their answers line up for the report.
        </Text>

        <Field label="First person">
          {(props) => (
            <Select
              {...props}
              value={aId}
              onChange={(event) => {
                setError(null);
                setAId(event.target.value);
              }}
            >
              <option value="">Choose a person…</option>
              {people.map((p) => (
                <option key={p.id} value={p.id} disabled={p.id === bId}>
                  {p.displayName}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Second person">
          {(props) => (
            <Select
              {...props}
              value={bId}
              onChange={(event) => {
                setError(null);
                setBId(event.target.value);
              }}
            >
              <option value="">Choose a person…</option>
              {people.map((p) => (
                <option key={p.id} value={p.id} disabled={p.id === aId}>
                  {p.displayName}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Stack gap={1}>
          <Text size="sm" weight={500}>
            Each person will be told
          </Text>
          <Text size="sm" tone="secondary">
            {compatibilityDisclosure(visibility, senderName)}
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

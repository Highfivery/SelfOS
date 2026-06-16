import { useEffect, useMemo, useState } from 'react';
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

type ParticipantMode = 'self' | 'others';

/**
 * The compatibility send panel (08-questionnaires §3.6/§13.5d/§16.1): compare TWO participants — either
 * **you + someone else** (the default; the sender is one participant) or **two other people**. On send the
 * AI personalizes a variant per participant (so their answers line up for the report) and freezes a paired
 * snapshot each. Requires AI to be on — a compatibility send can't be personalized without it.
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
  const senderId = useSessionStore((s) => s.activePerson?.id ?? '');
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

  const [mode, setMode] = useState<ParticipantMode>('self');
  // The "someone else" picked in self mode, and the two others picked in others mode.
  const [partnerId, setPartnerId] = useState('');
  const [otherAId, setOtherAId] = useState('');
  const [otherBId, setOtherBId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Everyone except the sender — the candidates for "someone else" / "two other people".
  const others = useMemo(() => people.filter((p) => p.id !== senderId), [people, senderId]);
  const nameOf = (id: string): string => people.find((p) => p.id === id)?.displayName ?? 'them';

  // The two chosen participants for the current mode (ids may include the sender in self mode).
  const participants: [string, string] =
    mode === 'self' ? [senderId, partnerId] : [otherAId, otherBId];

  // The live disclosure preview, written from each non-sender participant's point of view (§16.1) — the
  // exact text they'll see in their Inbox (the honesty guard). Only the chosen participants are shown.
  // Cheap (≤2 items) so it's computed each render rather than memoized.
  const previewLines = ((): { id: string; name: string; text: string }[] => {
    const [pa, pb] = participants;
    if (pa === '' || pb === '') return [];
    const lines: { id: string; name: string; text: string }[] = [];
    for (const [id, otherId] of [
      [pa, pb],
      [pb, pa],
    ] as const) {
      if (id === senderId) continue; // the sender authored it; no disclosure needed for them
      lines.push({
        id,
        name: nameOf(id),
        text: compatibilityDisclosure(visibility, {
          otherParticipantName: otherId === senderId ? senderName : nameOf(otherId),
          senderName,
          viewerIsSender: false,
        }),
      });
    }
    return lines;
  })();

  const onSend = async (): Promise<void> => {
    const [pa, pb] = participants;
    if (pa === '' || pb === '') {
      setError(
        mode === 'self' ? 'Choose someone to compare with.' : 'Choose two people to compare.',
      );
      return;
    }
    if (pa === pb) {
      setError('Choose two different people.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await window.selfos?.assignmentsCreateCompatibility({
        questionnaireId,
        participantPersonIdA: pa,
        participantPersonIdB: pb,
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

        {/* A full-width Select (not a SegmentedControl) so the two long labels never scroll-x in the
            narrow detail pane (§12: a control row must fill the space, never scroll or wrap). */}
        <Field label="Who's being compared?">
          {(props) => (
            <Select
              {...props}
              value={mode}
              onChange={(event) => {
                setError(null);
                setMode(event.target.value as ParticipantMode);
              }}
            >
              <option value="self">You + someone else</option>
              <option value="others">Two other people</option>
            </Select>
          )}
        </Field>

        {mode === 'self' ? (
          <>
            <Field label="You">
              {(props) => (
                <Select {...props} value={senderId} disabled>
                  <option value={senderId}>{senderName}</option>
                </Select>
              )}
            </Field>
            <Field label="Someone else">
              {(props) => (
                <Select
                  {...props}
                  value={partnerId}
                  onChange={(event) => {
                    setError(null);
                    setPartnerId(event.target.value);
                  }}
                >
                  <option value="">Choose a person…</option>
                  {others.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </>
        ) : (
          <>
            <Field label="First person">
              {(props) => (
                <Select
                  {...props}
                  value={otherAId}
                  onChange={(event) => {
                    setError(null);
                    setOtherAId(event.target.value);
                  }}
                >
                  <option value="">Choose a person…</option>
                  {others.map((p) => (
                    <option key={p.id} value={p.id} disabled={p.id === otherBId}>
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
                  value={otherBId}
                  onChange={(event) => {
                    setError(null);
                    setOtherBId(event.target.value);
                  }}
                >
                  <option value="">Choose a person…</option>
                  {others.map((p) => (
                    <option key={p.id} value={p.id} disabled={p.id === otherAId}>
                      {p.displayName}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </>
        )}

        {previewLines.length > 0 ? (
          <Stack gap={1}>
            <Text size="sm" weight={500}>
              {previewLines.length > 1 ? 'Each person will be told' : 'They’ll be told'}
            </Text>
            {previewLines.map((line) => (
              <Text key={line.id} size="sm" tone="secondary">
                {previewLines.length > 1 ? `${line.name}: ` : ''}
                {line.text}
              </Text>
            ))}
          </Stack>
        ) : null}

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

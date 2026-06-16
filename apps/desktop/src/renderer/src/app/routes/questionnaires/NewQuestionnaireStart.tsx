import { useEffect, useState } from 'react';
import { ArrowRight, Users } from 'lucide-react';
import type { Recipient } from '@shared/schemas';
import { usePeopleStore } from '../../../stores/peopleStore';
import { useSessionStore } from '../../../stores/sessionStore';
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
  TextInput,
} from '../../../design-system/components';
import styles from './Questionnaires.module.css';

type Mode = 'one' | 'compatibility';
type Kind = 'household' | 'external';

/** What the start step resolves to: a single bound recipient, or a compatibility (two-participant) questionnaire. */
export interface StartChoice {
  compat: boolean;
  recipient?: Recipient;
}

/**
 * Step 1 of creating a questionnaire (08-questionnaires §17.3): choose **who it's for** BEFORE authoring.
 * Every questionnaire is bound to exactly one recipient (a household person or an external person reached by
 * link) — or it's a **compatibility** questionnaire, the only kind that pairs two participants (chosen at
 * send). You can't author "for nobody". The recipient also lets AI generation skip what they've already
 * answered (§17.4).
 */
export function NewQuestionnaireStart({
  onChosen,
  onCancel,
}: {
  onChosen: (choice: StartChoice) => void;
  onCancel: () => void;
}): JSX.Element {
  const people = usePeopleStore((s) => s.people);
  const loaded = usePeopleStore((s) => s.loaded);
  const loadPeople = usePeopleStore((s) => s.load);
  const activePersonId = useSessionStore((s) => s.activePerson?.id);
  const canSendExternal = useSessionStore((s) => s.can('questionnaires.sendExternal'));
  useEffect(() => {
    if (!loaded) void loadPeople();
  }, [loaded, loadPeople]);

  const [mode, setMode] = useState<Mode>('one');
  const [kind, setKind] = useState<Kind>('household');
  const [personId, setPersonId] = useState('');
  const [externalName, setExternalName] = useState('');
  const [externalEmail, setExternalEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  // You can ask anyone in the household (including yourself — a self check-in is valid).
  const candidates = people;

  const onContinue = (): void => {
    if (mode === 'compatibility') {
      onChosen({ compat: true });
      return;
    }
    if (kind === 'household') {
      if (personId === '') {
        setError('Choose who this is for.');
        return;
      }
      onChosen({ compat: false, recipient: { kind: 'person', personId } });
      return;
    }
    const name = externalName.trim();
    if (name === '') {
      setError('Enter their name.');
      return;
    }
    onChosen({
      compat: false,
      recipient: {
        kind: 'external',
        displayName: name,
        ...(externalEmail.trim() ? { email: externalEmail.trim() } : {}),
      },
    });
  };

  return (
    <Card>
      <Stack gap={4}>
        <Heading level={3}>Who is this questionnaire for?</Heading>
        <Text size="sm" tone="secondary">
          Every questionnaire goes to one person, chosen first. To ask someone else later, you’ll
          make a new one (or duplicate this).
        </Text>

        <SegmentedControl<Mode>
          aria-label="Questionnaire kind"
          value={mode}
          onChange={(m) => {
            setError(null);
            setMode(m);
          }}
          options={[
            { value: 'one', label: 'One person' },
            { value: 'compatibility', label: 'Compatibility (two people)' },
          ]}
        />

        {mode === 'compatibility' ? (
          <Banner tone="info">
            <Stack gap={1}>
              <Text size="sm" weight={500}>
                <Users size={14} aria-hidden="true" /> Compatibility
              </Text>
              <Text size="sm">
                Goes to two people at once. AI personalizes a version for each, then aligns their
                answers into a shared report. You’ll pick the two participants when you send.
              </Text>
            </Stack>
          </Banner>
        ) : (
          <>
            <SegmentedControl<Kind>
              aria-label="Recipient kind"
              value={kind}
              onChange={(k) => {
                setError(null);
                setKind(k);
              }}
              options={[
                { value: 'household', label: 'Someone in the household' },
                ...(canSendExternal
                  ? [{ value: 'external' as const, label: 'Someone else (link)' }]
                  : []),
              ]}
            />

            {kind === 'household' ? (
              <Field label="Who is this for?">
                {(props) => (
                  <Select
                    {...props}
                    value={personId}
                    onChange={(e) => {
                      setError(null);
                      setPersonId(e.target.value);
                    }}
                  >
                    <option value="">Choose a person…</option>
                    {candidates.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.displayName}
                        {p.id === activePersonId ? ' (you)' : ''}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : (
              <Stack gap={3}>
                <Field label="Their name">
                  {(props) => (
                    <TextInput
                      {...props}
                      value={externalName}
                      placeholder="e.g. Alex"
                      onChange={(e) => {
                        setError(null);
                        setExternalName(e.target.value);
                      }}
                    />
                  )}
                </Field>
                <Field label="Their email (optional)">
                  {(props) => (
                    <TextInput
                      {...props}
                      type="email"
                      value={externalEmail}
                      placeholder="So you can email them the link"
                      onChange={(e) => setExternalEmail(e.target.value)}
                    />
                  )}
                </Field>
              </Stack>
            )}
          </>
        )}

        {error ? <Banner tone="warning">{error}</Banner> : null}

        <div className={styles.footer}>
          <Button variant="primary" onClick={onContinue}>
            Continue
            <ArrowRight size={16} aria-hidden="true" />
          </Button>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </Stack>
    </Card>
  );
}

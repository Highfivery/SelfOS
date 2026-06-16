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

  const compat = mode === 'compatibility';
  // Compatibility compares you with the recipient, and both answer in-app — so for now the recipient must be
  // a household person (external compatibility, via the relay, is the next slice, 08 §17.12-B).
  const allowExternal = canSendExternal && !compat;

  const onContinue = (): void => {
    if (kind === 'household') {
      if (personId === '') {
        setError('Choose who this is for.');
        return;
      }
      onChosen({ compat, recipient: { kind: 'person', personId } });
      return;
    }
    const name = externalName.trim();
    if (name === '') {
      setError('Enter their name.');
      return;
    }
    onChosen({
      compat,
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

        {/* Full-width Selects (not SegmentedControls) so the long labels never scroll-x at narrow widths
            (CLAUDE.md §12 — a space-filling control, never a scrolling segment row). */}
        <Field label="This questionnaire is for">
          {(props) => (
            <Select
              {...props}
              value={mode}
              onChange={(e) => {
                setError(null);
                const next = e.target.value as Mode;
                setMode(next);
                // Compatibility is household-only for now — drop a stale external selection.
                if (next === 'compatibility') setKind('household');
              }}
            >
              <option value="one">One person</option>
              <option value="compatibility">Compatibility — you + them</option>
            </Select>
          )}
        </Field>

        {compat ? (
          <Banner tone="info">
            <Text size="sm">
              <Users size={14} aria-hidden="true" /> You’ll be compared with the person you pick
              below. AI personalizes a version for each of you, then aligns your answers into a
              shared report.
            </Text>
          </Banner>
        ) : null}

        {allowExternal ? (
          <Field label="Recipient">
            {(props) => (
              <Select
                {...props}
                value={kind}
                onChange={(e) => {
                  setError(null);
                  setKind(e.target.value as Kind);
                }}
              >
                <option value="household">Someone in the household</option>
                <option value="external">Someone else (a private link)</option>
              </Select>
            )}
          </Field>
        ) : null}

        {kind === 'household' ? (
          <Field label={compat ? 'Compare you with' : 'Who is this for?'}>
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
                {candidates
                  .filter((p) => !compat || p.id !== activePersonId) // can't compare yourself with yourself
                  .map((p) => (
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

import { useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { usePeopleStore } from '../../../stores/peopleStore';
import { useSessionStore } from '../../../stores/sessionStore';
import {
  AdminOnlyBadge,
  Button,
  Card,
  Field,
  Heading,
  IconButton,
  Inline,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
  type SegmentOption,
} from '../../../design-system/components';
import { ChipEditor } from '../dreams/ChipEditor';
import { RelationshipsEditor } from './RelationshipsEditor';
import { AccessSection } from './AccessSection';
import { PersonBudgetEditor } from './PersonBudgetEditor';
import styles from './PersonEditor.module.css';
import type { Person } from '@shared/channels';

type Tab = 'profile' | 'about' | 'notes' | 'relationships' | 'access' | 'budget';

/** Preset gender options; an "Other" choice reveals a free-text field (13-dream-images §11.3). */
const GENDER_PRESETS = ['Female', 'Male', 'Non-binary', 'Prefer not to say'] as const;
const GENDER_OTHER = '__other__';

type ImportantDate = { label: string; date: string };

/**
 * Create or edit a person. Organized into tabs so person-scoped settings can grow without becoming
 * one long page; relationships/access/budget appear only once the person exists. The About tab carries
 * the descriptive profile fields (13-dream-images §4.6) split into a shared group (feeds others' AI
 * context + the image-depiction subset) and a private group (own coaching context only).
 */
export function PersonEditor({
  person,
  onDone,
}: {
  person: Person | null;
  onDone: () => void;
}): JSX.Element {
  const savePerson = usePeopleStore((s) => s.savePerson);
  const removePerson = usePeopleStore((s) => s.removePerson);
  const canManageBudgets = useSessionStore((s) => s.can('budgets.manage'));

  const [displayName, setDisplayName] = useState(person?.displayName ?? '');
  const [isSubject, setIsSubject] = useState(person?.isSubject ?? false);
  const [pronouns, setPronouns] = useState(person?.pronouns ?? '');
  const [birthday, setBirthday] = useState(person?.birthday ?? '');
  const [sharedNotes, setSharedNotes] = useState(person?.publicNotes ?? '');
  const [privateNotes, setPrivateNotes] = useState(person?.privateNotes ?? '');

  // About — shared descriptive fields.
  const initialGender = person?.gender ?? '';
  const genderIsPreset = (GENDER_PRESETS as readonly string[]).includes(initialGender);
  const [genderPreset, setGenderPreset] = useState(
    genderIsPreset ? initialGender : initialGender ? GENDER_OTHER : '',
  );
  const [genderOther, setGenderOther] = useState(genderIsPreset ? '' : initialGender);
  const [appearance, setAppearance] = useState(person?.appearanceDescription ?? '');
  const [ethnicity, setEthnicity] = useState(person?.ethnicity ?? '');
  const [occupation, setOccupation] = useState(person?.occupation ?? '');
  const [interests, setInterests] = useState<string[]>(person?.interests ?? []);
  const [location, setLocation] = useState(person?.location ?? '');
  const [goals, setGoals] = useState(person?.goals ?? '');
  const [communicationStyle, setCommunicationStyle] = useState(person?.communicationStyle ?? '');
  const [values, setValues] = useState<string[]>(person?.values ?? []);
  const [languages, setLanguages] = useState<string[]>(person?.languages ?? []);
  const [importantDates, setImportantDates] = useState<ImportantDate[]>(
    person?.importantDates ?? [],
  );

  // About — private descriptive fields (own coaching context only).
  const [healthNotes, setHealthNotes] = useState(person?.healthNotes ?? '');
  const [faith, setFaith] = useState(person?.faith ?? '');

  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('profile');

  const tabs: SegmentOption<Tab>[] = [
    { value: 'profile', label: 'Profile' },
    { value: 'about', label: 'About' },
    { value: 'notes', label: 'Notes' },
  ];
  if (person) {
    tabs.push(
      { value: 'relationships', label: 'Relationships' },
      { value: 'access', label: 'Access' },
    );
    if (canManageBudgets) tabs.push({ value: 'budget', label: 'Budget' });
  }

  const resolvedGender = (): string | undefined => {
    if (genderPreset === GENDER_OTHER) return genderOther.trim() || undefined;
    return genderPreset || undefined;
  };

  const save = async (): Promise<void> => {
    if (!displayName.trim()) return;
    setBusy(true);
    try {
      const cleanDates = importantDates
        .map((d) => ({ label: d.label.trim(), date: d.date.trim() }))
        .filter((d) => d.label && d.date);
      const gender = resolvedGender();
      await savePerson({
        ...(person ? { id: person.id } : {}),
        displayName: displayName.trim(),
        isSubject,
        tags: person?.tags ?? [],
        ...(pronouns.trim() ? { pronouns: pronouns.trim() } : {}),
        ...(birthday.trim() ? { birthday: birthday.trim() } : {}),
        ...(sharedNotes.trim() ? { publicNotes: sharedNotes.trim() } : {}),
        ...(privateNotes.trim() ? { privateNotes: privateNotes.trim() } : {}),
        // About — shared.
        ...(gender ? { gender } : {}),
        ...(appearance.trim() ? { appearanceDescription: appearance.trim() } : {}),
        ...(ethnicity.trim() ? { ethnicity: ethnicity.trim() } : {}),
        ...(occupation.trim() ? { occupation: occupation.trim() } : {}),
        ...(interests.length ? { interests } : {}),
        ...(location.trim() ? { location: location.trim() } : {}),
        ...(goals.trim() ? { goals: goals.trim() } : {}),
        ...(communicationStyle.trim() ? { communicationStyle: communicationStyle.trim() } : {}),
        ...(values.length ? { values } : {}),
        ...(languages.length ? { languages } : {}),
        ...(cleanDates.length ? { importantDates: cleanDates } : {}),
        // About — private.
        ...(healthNotes.trim() ? { healthNotes: healthNotes.trim() } : {}),
        ...(faith.trim() ? { faith: faith.trim() } : {}),
      });
      onDone();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (!person) return;
    setBusy(true);
    try {
      await removePerson(person.id);
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap={4}>
      <Heading level={3}>{person ? 'Edit person' : 'Add person'}</Heading>
      <SegmentedControl aria-label="Person section" value={tab} onChange={setTab} options={tabs} />

      {tab === 'profile' ? (
        <Card>
          <Stack gap={4}>
            <Field label="Name">
              {(props) => (
                <TextInput
                  {...props}
                  value={displayName}
                  placeholder="e.g. Sam"
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              )}
            </Field>
            <Inline gap={3}>
              <Switch
                checked={isSubject}
                onChange={setIsSubject}
                aria-label="Has their own SelfOS experience"
              />
              <Stack gap={1}>
                <Text size="sm" weight={500}>
                  Subject
                </Text>
                <Text size="xs" tone="secondary">
                  They have their own sessions — not just a contact for context.
                </Text>
              </Stack>
            </Inline>
            <Field label="Pronouns">
              {(props) => (
                <TextInput
                  {...props}
                  value={pronouns}
                  placeholder="e.g. she/her"
                  onChange={(event) => setPronouns(event.target.value)}
                />
              )}
            </Field>
            <Field label="Birthday" help="Used for age in coaching context and dream imagery.">
              {(props) => (
                <TextInput
                  {...props}
                  type="date"
                  value={birthday}
                  onChange={(event) => setBirthday(event.target.value)}
                />
              )}
            </Field>
          </Stack>
        </Card>
      ) : null}

      {tab === 'about' ? (
        <Stack gap={4}>
          <Card>
            <Stack gap={4}>
              <Stack gap={1}>
                <Heading level={3}>About</Heading>
                <Text size="xs" tone="secondary">
                  Descriptive context others’ AI may use — keep it shareable. Appearance, gender,
                  ethnicity, and age can inform a dream’s generated image.
                </Text>
              </Stack>
              <Field label="Gender">
                {(props) => (
                  <Select
                    {...props}
                    value={genderPreset}
                    onChange={(event) => setGenderPreset(event.target.value)}
                  >
                    <option value="">—</option>
                    {GENDER_PRESETS.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                    <option value={GENDER_OTHER}>Other…</option>
                  </Select>
                )}
              </Field>
              {genderPreset === GENDER_OTHER ? (
                <Field label="Gender (describe)">
                  {(props) => (
                    <TextInput
                      {...props}
                      value={genderOther}
                      placeholder="e.g. genderfluid"
                      onChange={(event) => setGenderOther(event.target.value)}
                    />
                  )}
                </Field>
              ) : null}
              <Field
                label="Appearance"
                help="Hair, build, distinctive features — describes how they look."
              >
                {(props) => (
                  <Textarea
                    {...props}
                    value={appearance}
                    rows={3}
                    placeholder="e.g. tall, dark curly hair, glasses"
                    onChange={(event) => setAppearance(event.target.value)}
                  />
                )}
              </Field>
              <Field label="Ethnicity">
                {(props) => (
                  <TextInput
                    {...props}
                    value={ethnicity}
                    placeholder="e.g. Korean"
                    onChange={(event) => setEthnicity(event.target.value)}
                  />
                )}
              </Field>
              <Field label="Occupation">
                {(props) => (
                  <TextInput
                    {...props}
                    value={occupation}
                    placeholder="e.g. nurse"
                    onChange={(event) => setOccupation(event.target.value)}
                  />
                )}
              </Field>
              <ChipEditor
                label="Interests"
                values={interests}
                onChange={setInterests}
                placeholder="Add an interest"
              />
              <Field label="Location">
                {(props) => (
                  <TextInput
                    {...props}
                    value={location}
                    placeholder="e.g. Seattle"
                    onChange={(event) => setLocation(event.target.value)}
                  />
                )}
              </Field>
              <Field label="Goals">
                {(props) => (
                  <Textarea
                    {...props}
                    value={goals}
                    rows={3}
                    placeholder="What they’re working toward"
                    onChange={(event) => setGoals(event.target.value)}
                  />
                )}
              </Field>
              <Field label="Communication style">
                {(props) => (
                  <TextInput
                    {...props}
                    value={communicationStyle}
                    placeholder="e.g. direct, prefers written"
                    onChange={(event) => setCommunicationStyle(event.target.value)}
                  />
                )}
              </Field>
              <ChipEditor
                label="Values"
                values={values}
                onChange={setValues}
                placeholder="Add a value"
              />
              <ChipEditor
                label="Languages"
                values={languages}
                onChange={setLanguages}
                placeholder="Add a language"
              />
              <ImportantDatesEditor value={importantDates} onChange={setImportantDates} />
            </Stack>
          </Card>

          <Card>
            <Stack gap={4}>
              <Stack gap={1}>
                <Heading level={3}>Private</Heading>
                <Text size="xs" tone="secondary">
                  Only ever used in this person’s own coaching context — never shared with anyone
                  else’s AI, and never sent to an image provider.
                </Text>
              </Stack>
              <Field label="Health notes">
                {(props) => (
                  <Textarea
                    {...props}
                    value={healthNotes}
                    rows={3}
                    placeholder="Anything health-related to keep in mind"
                    onChange={(event) => setHealthNotes(event.target.value)}
                  />
                )}
              </Field>
              <Field label="Faith">
                {(props) => (
                  <TextInput
                    {...props}
                    value={faith}
                    placeholder="e.g. Buddhist"
                    onChange={(event) => setFaith(event.target.value)}
                  />
                )}
              </Field>
            </Stack>
          </Card>
        </Stack>
      ) : null}

      {tab === 'notes' ? (
        <Card>
          <Stack gap={4}>
            <Field label="Shared notes" help="Context others’ AI may use — keep it shareable.">
              {(props) => (
                <Textarea
                  {...props}
                  value={sharedNotes}
                  rows={5}
                  placeholder="e.g. loves hiking; works in nursing"
                  onChange={(event) => setSharedNotes(event.target.value)}
                />
              )}
            </Field>
            <Field label="Private notes" help="Never shared with anyone else’s AI.">
              {(props) => (
                <Textarea
                  {...props}
                  value={privateNotes}
                  rows={5}
                  placeholder="Just for this person’s own sessions"
                  onChange={(event) => setPrivateNotes(event.target.value)}
                />
              )}
            </Field>
          </Stack>
        </Card>
      ) : null}

      {tab === 'relationships' && person ? <RelationshipsEditor person={person} /> : null}
      {tab === 'access' && person ? <AccessSection person={person} /> : null}
      {tab === 'budget' && person ? (
        <Card>
          <Stack gap={3}>
            <Inline gap={2}>
              <Heading level={3}>Budget</Heading>
              <AdminOnlyBadge />
            </Inline>
            <PersonBudgetEditor person={person} />
          </Stack>
        </Card>
      ) : null}

      <Inline gap={2}>
        <Button
          variant="primary"
          onClick={() => void save()}
          disabled={busy || !displayName.trim()}
        >
          {person ? 'Save' : 'Create'}
        </Button>
        <Button variant="secondary" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
        {person ? (
          <IconButton
            aria-label="Delete person"
            variant="secondary"
            onClick={() => void remove()}
            disabled={busy}
          >
            <Trash2 size={16} aria-hidden="true" />
          </IconButton>
        ) : null}
      </Inline>
    </Stack>
  );
}

/** Label + date pairs (e.g. an anniversary) — a small repeatable row editor for `Person.importantDates`. */
function ImportantDatesEditor({
  value,
  onChange,
}: {
  value: ImportantDate[];
  onChange: (next: ImportantDate[]) => void;
}): JSX.Element {
  const update = (index: number, patch: Partial<ImportantDate>): void => {
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };
  return (
    <Stack gap={2}>
      <Text size="sm" weight={500}>
        Important dates
      </Text>
      {value.map((row, index) => (
        <Inline key={index} gap={2} align="end" wrap>
          <div className={styles.dateLabel}>
            <Field label="Label">
              {(props) => (
                <TextInput
                  {...props}
                  value={row.label}
                  placeholder="e.g. Anniversary"
                  onChange={(event) => update(index, { label: event.target.value })}
                />
              )}
            </Field>
          </div>
          <div className={styles.dateValue}>
            <Field label="Date">
              {(props) => (
                <TextInput
                  {...props}
                  type="date"
                  value={row.date}
                  onChange={(event) => update(index, { date: event.target.value })}
                />
              )}
            </Field>
          </div>
          <IconButton
            aria-label={`Remove date ${index + 1}`}
            variant="secondary"
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          >
            <X size={16} aria-hidden="true" />
          </IconButton>
        </Inline>
      ))}
      <Inline>
        <Button variant="secondary" onClick={() => onChange([...value, { label: '', date: '' }])}>
          <Plus size={16} aria-hidden="true" />
          Add date
        </Button>
      </Inline>
    </Stack>
  );
}

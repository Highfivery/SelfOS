import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
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
  ShareToggle,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
  type SegmentOption,
} from '../../../design-system/components';
import { RelationshipsEditor } from './RelationshipsEditor';
import { AccessSection } from './AccessSection';
import { PersonBudgetEditor } from './PersonBudgetEditor';
import styles from './PersonEditor.module.css';
import type { Person } from '@shared/channels';
import { PERSON_FIELD_KEYS, type PersonFieldKey } from '@shared/schemas';

type Tab = 'profile' | 'about' | 'notes' | 'relationships' | 'access' | 'budget';

/** Preset gender options; an "Other" choice reveals a free-text field (13-dream-images §11.3). */
const GENDER_PRESETS = ['Female', 'Male', 'Non-binary', 'Prefer not to say'] as const;
const GENDER_OTHER = '__other__';

/**
 * The controllable fields this editor surfaces (each has a visible `ShareToggle`) — the scope of the
 * "Share all / Lock all" bulk controls. Since onboarding owns the self's full profile (18 §14.6), the
 * People editor only keeps the **dream-image / visual** fields for a non-Subject **contact** (who never
 * onboards) — appearance, gender, ethnicity — plus Notes. Everything else (pronouns, birthday, occupation,
 * relationship status, children, living situation, interests, location, important dates, and the deeply
 * personal self fields) is no longer edited here; its existing value is carried through untouched on save.
 */
const VISIBLE_FIELD_KEYS: PersonFieldKey[] = [
  'gender',
  'appearanceDescription',
  'ethnicity',
  'notes',
];

/**
 * Create or edit a person. Organized into tabs: **Profile** (name + whether they're a Subject), **About**
 * (a non-Subject contact's visual/dream-image fields only — hidden for Subjects, whose profile is owned by
 * onboarding), **Notes**, and — once the person exists — Relationships / Access / Budget. Every controllable
 * field carries a per-item `ShareToggle` (15-shareability §3.1); the About header's "Share all / Lock all"
 * flips them at once.
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
  const [notes, setNotes] = useState(person?.notes ?? '');

  // The per-field lock-set (15-shareability §4.1): keys here are kept to this person's own coaching only.
  // Absent ⇒ shared (the default), so we track only the opt-OUTs.
  const [privateFields, setPrivateFields] = useState<Set<PersonFieldKey>>(
    () => new Set(person?.privateFields ?? []),
  );
  const isShared = (k: PersonFieldKey): boolean => !privateFields.has(k);
  const setShared = (k: PersonFieldKey, shared: boolean): void =>
    setPrivateFields((prev) => {
      const next = new Set(prev);
      if (shared) next.delete(k);
      else next.add(k);
      return next;
    });
  // Bulk Share/Lock only touches the fields this editor surfaces — never the hidden, carried-through fields
  // (so "Share all" can't silently un-privatize something with no toggle to counter it; 15-shareability §8.3).
  const lockAll = (): void =>
    setPrivateFields((prev) => {
      const next = new Set(prev);
      VISIBLE_FIELD_KEYS.forEach((k) => next.add(k));
      return next;
    });
  const shareAll = (): void =>
    setPrivateFields((prev) => {
      const next = new Set(prev);
      VISIBLE_FIELD_KEYS.forEach((k) => next.delete(k));
      return next;
    });
  /** A `ShareToggle` bound to a controllable field key — placed beside that field's label. */
  const toggle = (k: PersonFieldKey, label: string): JSX.Element => (
    <ShareToggle shared={isShared(k)} onChange={(s) => setShared(k, s)} label={label} />
  );

  // About — the visual / dream-image fields (kept only for a non-Subject contact).
  const initialGender = person?.gender ?? '';
  const genderIsPreset = (GENDER_PRESETS as readonly string[]).includes(initialGender);
  const [genderPreset, setGenderPreset] = useState(
    genderIsPreset ? initialGender : initialGender ? GENDER_OTHER : '',
  );
  const [genderOther, setGenderOther] = useState(genderIsPreset ? '' : initialGender);
  const [appearance, setAppearance] = useState(person?.appearanceDescription ?? '');
  const [ethnicity, setEthnicity] = useState(person?.ethnicity ?? '');

  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('profile');

  // The About tab exists only for a non-Subject contact; a Subject's profile is owned by onboarding. If the
  // person is flipped to a Subject while the About tab is open, fall back to Profile so nothing renders blank.
  useEffect(() => {
    if (isSubject && tab === 'about') setTab('profile');
  }, [isSubject, tab]);

  const tabs: SegmentOption<Tab>[] = [{ value: 'profile', label: 'Profile' }];
  if (!isSubject) tabs.push({ value: 'about', label: 'About' });
  tabs.push({ value: 'notes', label: 'Notes' });
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
      const gender = resolvedGender();
      const lockedFields = PERSON_FIELD_KEYS.filter((k) => privateFields.has(k));
      await savePerson({
        ...(person ? { id: person.id } : {}),
        displayName: displayName.trim(),
        isSubject,
        tags: person?.tags ?? [],
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        // Per-field shareability locks (15-shareability §4.1) — only the opt-OUTs.
        ...(lockedFields.length ? { privateFields: lockedFields } : {}),
        // The visual / dream-image fields edited here (also feed a related person's depiction in a dream).
        ...(gender ? { gender } : {}),
        ...(appearance.trim() ? { appearanceDescription: appearance.trim() } : {}),
        ...(ethnicity.trim() ? { ethnicity: ethnicity.trim() } : {}),
        // Everything else is owned by onboarding (or set elsewhere) and NOT edited here. `upsertPerson`
        // rebuilds the person from the input, so each must be carried through or it would be WIPED.
        ...(person?.pronouns !== undefined ? { pronouns: person.pronouns } : {}),
        ...(person?.birthday !== undefined ? { birthday: person.birthday } : {}),
        ...(person?.email !== undefined ? { email: person.email } : {}),
        ...(person?.phone !== undefined ? { phone: person.phone } : {}),
        ...(person?.occupation !== undefined ? { occupation: person.occupation } : {}),
        ...(person?.relationshipStatus !== undefined
          ? { relationshipStatus: person.relationshipStatus }
          : {}),
        ...(person?.parentalStatus !== undefined ? { parentalStatus: person.parentalStatus } : {}),
        ...(person?.livingSituation !== undefined
          ? { livingSituation: person.livingSituation }
          : {}),
        ...(person?.interests !== undefined ? { interests: person.interests } : {}),
        ...(person?.location !== undefined ? { location: person.location } : {}),
        ...(person?.importantDates !== undefined ? { importantDates: person.importantDates } : {}),
        ...(person?.goals !== undefined ? { goals: person.goals } : {}),
        ...(person?.communicationStyle !== undefined
          ? { communicationStyle: person.communicationStyle }
          : {}),
        ...(person?.values !== undefined ? { values: person.values } : {}),
        ...(person?.languages !== undefined ? { languages: person.languages } : {}),
        ...(person?.sexualOrientation !== undefined
          ? { sexualOrientation: person.sexualOrientation }
          : {}),
        ...(person?.relationshipStyle !== undefined
          ? { relationshipStyle: person.relationshipStyle }
          : {}),
        ...(person?.healthNotes !== undefined ? { healthNotes: person.healthNotes } : {}),
        ...(person?.faith !== undefined ? { faith: person.faith } : {}),
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
            {isSubject ? (
              <Text size="xs" tone="secondary">
                Their profile — pronouns, appearance, life facts and more — comes from their own
                onboarding, so it isn’t edited here.
              </Text>
            ) : null}
          </Stack>
        </Card>
      ) : null}

      {tab === 'about' && !isSubject ? (
        <Card>
          <Stack gap={4}>
            <Stack gap={2}>
              <div className={styles.aboutHeader}>
                <Heading level={3}>About</Heading>
                <Inline gap={1} align="center">
                  <Button variant="secondary" onClick={shareAll}>
                    Share all
                  </Button>
                  <Button variant="secondary" onClick={lockAll}>
                    Lock all
                  </Button>
                </Inline>
              </div>
              <Text size="xs" tone="secondary">
                A few visual details about this contact. They can inform the coaching of people you
                relate to and this person’s depiction in a dream’s generated image. Lock any item to
                keep it to your own coaching. (Add anything else as a Note.)
              </Text>
            </Stack>
            <Field label="Gender" labelAction={toggle('gender', 'Gender')}>
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
              labelAction={toggle('appearanceDescription', 'Appearance')}
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
            <Field label="Ethnicity" labelAction={toggle('ethnicity', 'Ethnicity')}>
              {(props) => (
                <TextInput
                  {...props}
                  value={ethnicity}
                  placeholder="e.g. Korean"
                  onChange={(event) => setEthnicity(event.target.value)}
                />
              )}
            </Field>
          </Stack>
        </Card>
      ) : null}

      {tab === 'notes' ? (
        <Card>
          <Stack gap={4}>
            <Text size="xs" tone="secondary">
              By default these notes can inform the coaching of people you relate to. Lock them to
              keep them to this person’s own sessions.
            </Text>
            <Field label="Notes" labelAction={toggle('notes', 'Notes')}>
              {(props) => (
                <Textarea
                  {...props}
                  value={notes}
                  rows={6}
                  placeholder="e.g. loves hiking; works in nursing"
                  onChange={(event) => setNotes(event.target.value)}
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

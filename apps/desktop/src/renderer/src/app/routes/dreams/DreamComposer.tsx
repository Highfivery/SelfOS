import { useEffect, useState } from 'react';
import { Sparkles, Trash2 } from 'lucide-react';
import type { Dream, DreamInput, DreamPersonRef } from '@shared/channels';
import type { SensitivityTier } from '@shared/schemas';
import { aiKeyResolved } from '../../aiAvailability';
import { useDreamStore } from '../../../stores/dreamStore';
import { usePeopleStore } from '../../../stores/peopleStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useSetting } from '../../../settings/useSetting';
import {
  Button,
  Field,
  Heading,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
} from '../../../design-system/components';
import { ChipEditor } from './ChipEditor';
import { DreamPeopleEditor } from './DreamPeopleEditor';
import styles from './Dreams.module.css';

interface DreamComposerProps {
  dream: Dream | null;
  onDone: () => void;
  /**
   * When provided (new-dream capture), the composer offers a primary **"Start reflection"** that saves the
   * dream then hands its id back to open the guided session, plus a secondary **"Just save"** (12 §15.3).
   * Omitted (edit mode) ⇒ a single **"Save"** (the classic journal action).
   */
  onStartReflection?: (dreamId: string) => void;
}

const numOrEmpty = (n: number | undefined): string => (n === undefined ? '' : String(n));

/** Capture or edit a dream (12-dreams §3.1). Narrative-first; every other field is optional. */
export function DreamComposer({
  dream,
  onDone,
  onStartReflection,
}: DreamComposerProps): JSX.Element {
  const save = useDreamStore((s) => s.save);
  const remove = useDreamStore((s) => s.remove);
  const [aiEnabled] = useSetting('ai.enabled');
  const [hasKey, setHasKey] = useState(false);
  const householdPeople = usePeopleStore((s) => s.people);
  const peopleLoaded = usePeopleStore((s) => s.loaded);
  const loadPeople = usePeopleStore((s) => s.load);
  const dreamerId = useSessionStore((s) => s.activePerson?.id);

  // The selectable people: everyone in the household except the dreamer themselves (12 §3.1 decision).
  const selectablePeople = householdPeople
    .filter((person) => person.id !== dreamerId)
    .map((person) => ({ id: person.id, displayName: person.displayName }));

  useEffect(() => {
    if (!peopleLoaded) void loadPeople();
  }, [peopleLoaded, loadPeople]);

  useEffect(() => {
    void (async () => {
      setHasKey(await aiKeyResolved('anthropic'));
    })();
  }, []);

  const [title, setTitle] = useState(dream?.title ?? '');
  const [narrative, setNarrative] = useState(dream?.narrative ?? '');
  const [dreamDate, setDreamDate] = useState(dream?.dreamDate ?? '');
  const [mood, setMood] = useState(numOrEmpty(dream?.mood));
  const [vividness, setVividness] = useState(numOrEmpty(dream?.vividness));
  const [sleepQuality, setSleepQuality] = useState(numOrEmpty(dream?.sleepQuality));
  const [lucid, setLucid] = useState(dream?.lucid ?? false);
  const [nightmare, setNightmare] = useState(dream?.nightmare ?? false);
  const [sensitivity, setSensitivity] = useState<SensitivityTier>(dream?.sensitivity ?? 'standard');
  const [informsContext, setInformsContext] = useState(dream?.informsContext !== false);
  const [tags, setTags] = useState<string[]>(dream?.tags ?? []);
  const [people, setPeople] = useState<DreamPersonRef[]>(dream?.people ?? []);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = narrative.trim().length > 0 && !saving;
  // "Start reflection" needs AI (it opens the coach); when unavailable, only "Just save" shows (12 §15.2).
  const configured = aiEnabled && hasKey;

  const buildInput = (): DreamInput => ({
    ...(dream?.id ? { id: dream.id } : {}),
    ...(title.trim() ? { title: title.trim() } : {}),
    narrative: narrative.trim(),
    ...(dreamDate ? { dreamDate } : {}),
    ...(mood !== '' ? { mood: Number(mood) } : {}),
    ...(vividness !== '' ? { vividness: Number(vividness) } : {}),
    ...(sleepQuality !== '' ? { sleepQuality: Number(sleepQuality) } : {}),
    lucid,
    nightmare,
    tags,
    people,
    sensitivity,
    informsContext,
  });

  /** Save the dream; returns the saved record (or null on failure, with an error surfaced). */
  const persist = async (): Promise<Dream | null> => {
    if (!canSave) return null;
    setSaving(true);
    setError(null);
    let saved: Dream | null;
    try {
      saved = await save(buildInput());
    } catch {
      setError('Couldn’t save this dream — please try again.');
      setSaving(false);
      return null;
    }
    setSaving(false);
    return saved;
  };

  // "Save" / "Just save": persist to the journal and return to it.
  const onJustSave = async (): Promise<void> => {
    if ((await persist()) !== null) onDone();
  };

  // "Start reflection": persist, then hand the id back to open the guided session (12 §15.3).
  const onStart = async (): Promise<void> => {
    const saved = await persist();
    if (saved) onStartReflection?.(saved.id);
  };

  const onDelete = async (): Promise<void> => {
    if (!dream) return;
    await remove(dream.id);
    onDone();
  };

  return (
    <Stack gap={4}>
      <Heading level={2}>{dream ? 'Dream' : 'Log a dream'}</Heading>

      <Field label="What happened?" help="Write it however it comes — before it fades.">
        {(p) => (
          <Textarea
            {...p}
            value={narrative}
            onChange={(e) => setNarrative(e.target.value)}
            rows={6}
            placeholder="I was back in my childhood house, but the rooms kept rearranging…"
            autoFocus
          />
        )}
      </Field>

      <Field label="Title (optional)">
        {(p) => (
          <TextInput
            {...p}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Name this dream"
          />
        )}
      </Field>

      <div className={styles.toggleRow}>
        <Switch checked={lucid} onChange={setLucid} aria-label="Lucid dream" />
        <Text>Lucid dream</Text>
      </div>
      <div className={styles.toggleRow}>
        <Switch checked={nightmare} onChange={setNightmare} aria-label="Nightmare" />
        <Text>Nightmare</Text>
      </div>

      <Heading level={3}>Optional details</Heading>

      <div className={styles.detailsGrid}>
        <Field label="Waking mood">
          {(p) => (
            <Select {...p} value={mood} onChange={(e) => setMood(e.target.value)}>
              <option value="">Not recorded</option>
              <option value="-1">Rough</option>
              <option value="-0.5">Low</option>
              <option value="0">Neutral</option>
              <option value="0.5">Good</option>
              <option value="1">Great</option>
            </Select>
          )}
        </Field>
        <Field label="Vividness">
          {(p) => (
            <Select {...p} value={vividness} onChange={(e) => setVividness(e.target.value)}>
              <option value="">Not recorded</option>
              <option value="1">1 — hazy</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4</option>
              <option value="5">5 — vivid</option>
            </Select>
          )}
        </Field>
        <Field label="Date it happened">
          {(p) => (
            <TextInput
              {...p}
              type="date"
              value={dreamDate}
              onChange={(e) => setDreamDate(e.target.value)}
            />
          )}
        </Field>
        <Field label="Sleep quality">
          {(p) => (
            <Select {...p} value={sleepQuality} onChange={(e) => setSleepQuality(e.target.value)}>
              <option value="">Not recorded</option>
              <option value="1">1 — poor</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4</option>
              <option value="5">5 — great</option>
            </Select>
          )}
        </Field>
      </div>

      <ChipEditor label="Tags" values={tags} onChange={setTags} placeholder="Add a tag" />
      <DreamPeopleEditor values={people} onChange={setPeople} people={selectablePeople} />

      <Field
        label="Sensitivity"
        help="Sets the framing for analysis and the warning before any dream-image generation."
      >
        {(p) => (
          <Select
            {...p}
            value={sensitivity}
            onChange={(e) => setSensitivity(e.target.value as SensitivityTier)}
          >
            <option value="standard">Standard</option>
            <option value="intimacyGeneral">Intimate</option>
            <option value="explicit">Explicit</option>
            <option value="unfiltered">Unfiltered</option>
          </Select>
        )}
      </Field>

      <div className={styles.informsContext}>
        <div className={styles.toggleRow}>
          <Switch
            checked={informsContext}
            onChange={setInformsContext}
            aria-label="Let this dream inform coaching context"
          />
          <Text weight={500}>Let this dream inform coaching context</Text>
        </div>
        <Text size="xs" tone="tertiary">
          {informsContext
            ? 'This dream’s reflections can inform your coaching, and (once you analyze and approve it) be shared with people you relate to.'
            : 'Off: it stays a private journal entry — it won’t inform your coaching or be shareable.'}
        </Text>
      </div>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.footer}>
        {dream ? (
          confirmingDelete ? (
            <div className={styles.confirm}>
              <Text tone="secondary">Delete this dream?</Text>
              <Button variant="secondary" onClick={() => setConfirmingDelete(false)}>
                Cancel
              </Button>
              <Button variant="secondary" onClick={() => void onDelete()}>
                Delete
              </Button>
            </div>
          ) : (
            <Button variant="secondary" onClick={() => setConfirmingDelete(true)}>
              <Trash2 size={16} aria-hidden="true" />
              Delete
            </Button>
          )
        ) : null}
        <div className={styles.footerActions}>
          <Button variant="secondary" onClick={onDone}>
            Cancel
          </Button>
          {onStartReflection ? (
            <>
              <Button variant="secondary" onClick={() => void onJustSave()} disabled={!canSave}>
                Just save
              </Button>
              {configured ? (
                <Button variant="primary" onClick={() => void onStart()} disabled={!canSave}>
                  <Sparkles size={16} aria-hidden="true" />
                  Start reflection
                </Button>
              ) : null}
            </>
          ) : (
            <Button variant="primary" onClick={() => void onJustSave()} disabled={!canSave}>
              Save
            </Button>
          )}
        </div>
      </div>
      {onStartReflection && !configured ? (
        <Text size="xs" tone="tertiary">
          Connect AI in Settings to reflect on this dream with your coach. You can still save it to
          your journal.
        </Text>
      ) : null}
    </Stack>
  );
}

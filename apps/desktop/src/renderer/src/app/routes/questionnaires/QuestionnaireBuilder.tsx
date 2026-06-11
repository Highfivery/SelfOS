import { useEffect, useState } from 'react';
import { ImagePlus, Plus, Sparkles, Trash2 } from 'lucide-react';
import { ALLOWED_IMAGE_MIME, MAX_IMAGE_BYTES } from '@selfos/core/questionnaires';
import { ANTHROPIC_API_KEY_ID } from '@shared/channels';
import { useQuestionnaireStore } from '../../../stores/questionnaireStore';
import { useSetting } from '../../../settings/useSetting';
import {
  Banner,
  Button,
  Card,
  Field,
  Heading,
  IconButton,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from '../../../design-system/components';
import type {
  AnswerType,
  BranchRule,
  Question,
  Questionnaire,
  QuestionnaireInput,
  SensitivityTier,
} from '@shared/schemas';
import { QuestionImage } from './QuestionImage';
import { QuestionnaireAiPanel } from './QuestionnaireAiPanel';
import { QuestionnairePreview } from './QuestionnairePreview';
import styles from './Questionnaires.module.css';

type BuilderMode = 'edit' | 'preview';

/** Read a picked image File into base64 (no data-URL prefix) for the store IPC. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
    reader.onload = () => {
      const base64 = String(reader.result).split(',')[1];
      if (base64) resolve(base64);
      else reject(new Error('Could not read the file.'));
    };
    reader.readAsDataURL(file);
  });
}

/** A small starter taxonomy (custom types are added by the user and persist in the vault). */
const QUESTIONNAIRE_TYPES: { value: string; label: string }[] = [
  { value: 'role-feedback', label: 'How am I doing in this role?' },
  { value: 'blind-spots', label: 'Honest outside view / blind spots' },
  { value: 'appreciation', label: 'Appreciation, strengths & weaknesses' },
  { value: 'perspective', label: 'Perspective on a recent event' },
  { value: 'fill-gaps', label: 'Fill the gaps' },
  { value: 'scenario', label: 'Scenario-based' },
  { value: 'intimacy', label: 'Intimacy' },
  { value: 'science', label: 'Science-informed' },
];

/** Sensitivity tiers (08 §4.2). The age/consent gates are applied recipient-side at send (§3.2/§8.3). */
const SENSITIVITY_OPTIONS: { value: SensitivityTier; label: string }[] = [
  { value: 'standard', label: 'Standard' },
  { value: 'intimacyGeneral', label: 'Intimacy — General' },
  { value: 'explicit', label: 'Intimacy — Explicit' },
  { value: 'unfiltered', label: 'Intimacy — Unfiltered' },
];

/** Author-facing note for the sensitive tiers — the actual gates apply when you send. */
const SENSITIVITY_NOTES: Partial<Record<SensitivityTier, string>> = {
  intimacyGeneral: 'Recipients confirm they’re 18+ when you send.',
  explicit:
    'Recipients confirm their date of birth and consent when you send. Generated and analyzed strictly within Anthropic’s usage policy.',
  unfiltered:
    'Recipients confirm their date of birth and consent when you send. Generated and analyzed strictly within Anthropic’s usage policy.',
};

const TYPE_OPTIONS: { value: AnswerType; label: string }[] = [
  { value: 'shortText', label: 'Short text' },
  { value: 'longText', label: 'Long text' },
  { value: 'yesNo', label: 'Yes / No' },
  { value: 'date', label: 'Date' },
  { value: 'singleChoice', label: 'Single choice' },
  { value: 'multiChoice', label: 'Multiple choice' },
  { value: 'ranking', label: 'Ranking' },
  { value: 'thisOrThat', label: 'This or that' },
  { value: 'allocation', label: 'Allocation (sums to 100)' },
  { value: 'rating', label: 'Rating' },
  { value: 'slider', label: 'Slider' },
  { value: 'matrix', label: 'Matrix (rows on one scale)' },
];
const OPTION_TYPES: AnswerType[] = [
  'singleChoice',
  'multiChoice',
  'ranking',
  'thisOrThat',
  'allocation',
];
const SCALE_TYPES: AnswerType[] = ['rating', 'slider'];
/** Types with a numeric Min/Max range to validate (scale + matrix share the editor). */
const RANGE_TYPES: AnswerType[] = ['rating', 'slider', 'matrix'];
/** Only discrete answers make a clean "show when = value" branch trigger (decided 2026-06-11). */
const DISCRETE_TRIGGER_TYPES: AnswerType[] = ['singleChoice', 'yesNo'];

interface TextRow {
  id: string;
  text: string;
}

interface QDraft {
  id: string;
  type: AnswerType;
  prompt: string;
  help: string;
  required: boolean;
  options: TextRow[];
  rows: TextRow[];
  min: number;
  max: number;
  minLabel: string;
  maxLabel: string;
  branch: { whenQuestionId: string; equals: string } | null;
  media: { imagePath: string; alt: string; mime: string } | null;
  aiDrafted: boolean;
}

const genId = (): string => `q-${Math.random().toString(36).slice(2, 10)}`;

const blankRows = (): TextRow[] => [
  { id: genId(), text: '' },
  { id: genId(), text: '' },
];

/** Keep a scale bound finite: an empty/invalid number field must never persist NaN. */
const toFinite = (value: string): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

function blankDraft(): QDraft {
  return {
    id: genId(),
    type: 'shortText',
    prompt: '',
    help: '',
    required: true,
    options: blankRows(),
    rows: blankRows(),
    min: 1,
    max: 5,
    minLabel: '',
    maxLabel: '',
    branch: null,
    media: null,
    aiDrafted: false,
  };
}

/** Map an AI-generated Question to an editable draft, flagged so the author knows to review it. */
function fromGenerated(q: Question): QDraft {
  return { ...fromQuestion(q), aiDrafted: true };
}

const toTextRows = (values: string[] | undefined): TextRow[] =>
  (values && values.length > 0 ? values : ['', '']).map((text) => ({ id: genId(), text }));

function fromQuestion(q: Question): QDraft {
  const range = q.scale ?? q.matrix;
  return {
    id: q.id,
    type: q.type,
    prompt: q.prompt,
    help: q.help ?? '',
    required: q.required,
    options: toTextRows(q.options),
    rows: toTextRows(q.matrix?.rows),
    min: range?.min ?? 1,
    max: range?.max ?? 5,
    minLabel: range?.minLabel ?? '',
    maxLabel: range?.maxLabel ?? '',
    branch: q.branch
      ? { whenQuestionId: q.branch.whenQuestionId, equals: String(q.branch.equals) }
      : null,
    media: q.media ? { ...q.media } : null,
    aiDrafted: false,
  };
}

/** The shared {min,max,minLabel?,maxLabel?} shape for both `scale` and `matrix` (omit blank labels). */
function buildRange(d: QDraft): { min: number; max: number; minLabel?: string; maxLabel?: string } {
  return {
    min: d.min,
    max: d.max,
    ...(d.minLabel.trim() ? { minLabel: d.minLabel.trim() } : {}),
    ...(d.maxLabel.trim() ? { maxLabel: d.maxLabel.trim() } : {}),
  };
}

/**
 * Resolve a draft branch to a typed BranchRule, or null if its trigger is gone / no longer a valid
 * trigger. This mirrors the render-time `candidates` predicate exactly, so we never persist a branch
 * the builder has already hidden (e.g. the trigger's options were cleared or the chosen value was
 * renamed away after it was picked).
 */
function resolveBranch(d: QDraft, drafts: QDraft[]): BranchRule | null {
  if (!d.branch || d.branch.whenQuestionId === '') return null;
  const ref = drafts.find((x) => x.id === d.branch?.whenQuestionId);
  if (!ref || !DISCRETE_TRIGGER_TYPES.includes(ref.type)) return null;
  if (ref.type === 'yesNo') {
    return { whenQuestionId: ref.id, equals: d.branch.equals === 'true', action: 'show' };
  }
  // singleChoice: the chosen value must still be one of the trigger's current non-empty options.
  const options = ref.options.map((o) => o.text.trim()).filter(Boolean);
  if (!options.includes(d.branch.equals.trim())) return null;
  return { whenQuestionId: ref.id, equals: d.branch.equals, action: 'show' };
}

function toQuestion(d: QDraft, drafts: QDraft[]): Question {
  const branch = resolveBranch(d, drafts);
  return {
    id: d.id,
    type: d.type,
    prompt: d.prompt.trim(),
    required: d.required,
    ...(d.help.trim() ? { help: d.help.trim() } : {}),
    ...(d.media
      ? { media: { imagePath: d.media.imagePath, alt: d.media.alt.trim(), mime: d.media.mime } }
      : {}),
    ...(OPTION_TYPES.includes(d.type)
      ? { options: d.options.map((o) => o.text.trim()).filter(Boolean) }
      : {}),
    ...(SCALE_TYPES.includes(d.type) ? { scale: buildRange(d) } : {}),
    ...(d.type === 'matrix'
      ? { matrix: { rows: d.rows.map((r) => r.text.trim()).filter(Boolean), ...buildRange(d) } }
      : {}),
    ...(branch ? { branch } : {}),
  };
}

/** The selectable trigger values for an earlier discrete question. */
function triggerValues(ref: QDraft): { value: string; label: string }[] {
  if (ref.type === 'yesNo') {
    return [
      { value: 'true', label: 'Yes' },
      { value: 'false', label: 'No' },
    ];
  }
  return ref.options
    .map((o) => o.text.trim())
    .filter(Boolean)
    .map((text) => ({ value: text, label: text }));
}

/** A gap-finder suggestion the builder can open pre-filled (08-questionnaires §3.7). */
export interface BuilderSeed {
  title: string;
  type: string;
  questions: Question[];
}

/** Create or edit a questionnaire: title + type + sensitivity + a list of questions, with a check. */
export function QuestionnaireBuilder({
  questionnaire,
  seed,
  onDone,
}: {
  questionnaire: Questionnaire | null;
  seed?: BuilderSeed;
  onDone: () => void;
}): JSX.Element {
  const save = useQuestionnaireStore((s) => s.save);
  const remove = useQuestionnaireStore((s) => s.remove);
  const validate = useQuestionnaireStore((s) => s.validate);
  const customTypes = useQuestionnaireStore((s) => s.customTypes);
  const addType = useQuestionnaireStore((s) => s.addType);
  const storeImage = useQuestionnaireStore((s) => s.storeImage);
  const getImage = useQuestionnaireStore((s) => s.getImage);
  const improve = useQuestionnaireStore((s) => s.improveQuestion);
  const [imageErrors, setImageErrors] = useState<Record<string, string>>({});
  const [aiErrors, setAiErrors] = useState<Record<string, string>>({});
  const [improving, setImproving] = useState<Record<string, boolean>>({});

  // Whether the AI authoring features are usable (gates the generate panel + per-question reword).
  const [aiEnabled] = useSetting('ai.enabled');
  const [hasAiKey, setHasAiKey] = useState(false);
  useEffect(() => {
    void window.selfos
      ?.secretHas({ id: ANTHROPIC_API_KEY_ID })
      .then((v) => setHasAiKey(Boolean(v)));
  }, []);
  const aiReady = aiEnabled === true && hasAiKey;

  const [title, setTitle] = useState(questionnaire?.title ?? seed?.title ?? '');
  const [type, setType] = useState(questionnaire?.type ?? seed?.type ?? 'role-feedback');
  const [sensitivity, setSensitivity] = useState<SensitivityTier>(
    questionnaire?.sensitivity ?? 'standard',
  );
  const [drafts, setDrafts] = useState<QDraft[]>(
    questionnaire
      ? questionnaire.questions.map(fromQuestion)
      : seed
        ? seed.questions.map(fromGenerated)
        : [blankDraft()],
  );
  const [problems, setProblems] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  // Adding a custom type (an inline name field revealed by "New type").
  const [addingType, setAddingType] = useState(false);
  const [newType, setNewType] = useState('');
  const [typeError, setTypeError] = useState<string | null>(null);

  // Edit ⇄ Preview (test-on-self). Preview renders the live drafts as the recipient would see them.
  const [mode, setMode] = useState<BuilderMode>('edit');
  const previewQuestions = drafts
    .filter((d) => d.prompt.trim() !== '')
    .map((d) => toQuestion(d, drafts));

  const allPrompts = drafts.every((d) => d.prompt.trim() !== '');
  const canSave = title.trim() !== '' && allPrompts && !busy;

  const knownType = QUESTIONNAIRE_TYPES.some((t) => t.value === type) || customTypes.includes(type);
  const customList = [...customTypes, ...(knownType ? [] : [type])];

  const patch = (id: string, change: Partial<QDraft>): void => {
    setProblems(null);
    setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, ...change } : d)));
  };

  const confirmAddType = async (): Promise<void> => {
    const name = newType.trim();
    if (name === '') {
      setTypeError('Enter a name.');
      return;
    }
    const exists =
      QUESTIONNAIRE_TYPES.some((t) => t.label.toLowerCase() === name.toLowerCase()) ||
      customTypes.some((t) => t.toLowerCase() === name.toLowerCase());
    if (exists) {
      setTypeError('That type already exists.');
      return;
    }
    await addType(name);
    setType(name);
    setProblems(null);
    setAddingType(false);
    setNewType('');
  };

  const onPickImage = async (id: string, file: File | undefined): Promise<void> => {
    if (!file) return;
    if (!(ALLOWED_IMAGE_MIME as readonly string[]).includes(file.type)) {
      setImageErrors((e) => ({ ...e, [id]: 'Use a PNG, JPEG, WebP, or GIF image.' }));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImageErrors((e) => ({ ...e, [id]: 'Image must be under 5 MB.' }));
      return;
    }
    try {
      const stored = await storeImage(await fileToBase64(file), file.type);
      if (!stored) return;
      setImageErrors((e) => ({ ...e, [id]: '' }));
      patch(id, { media: { imagePath: stored.imagePath, alt: '', mime: stored.mime } });
    } catch {
      setImageErrors((e) => ({ ...e, [id]: 'Could not attach that image. Try again.' }));
    }
  };

  // Only clear the draft reference — never delete the vault file here, so an unsaved "remove" is
  // discarded cleanly (no dangling reference) and the now-unreferenced image is reaped by a later GC.
  const onRemoveImage = (d: QDraft): void => {
    setImageErrors((e) => ({ ...e, [d.id]: '' }));
    patch(d.id, { media: null });
  };

  const appendGenerated = (questions: Question[]): void => {
    setProblems(null);
    setDrafts((ds) => [...ds, ...questions.map(fromGenerated)]);
  };

  const onImprove = async (d: QDraft, instruction: string): Promise<void> => {
    if (improving[d.id]) return; // debounce: never fire a second (metered) call while one is in flight
    setAiErrors((e) => ({ ...e, [d.id]: '' }));
    setImproving((m) => ({ ...m, [d.id]: true }));
    try {
      const result = await improve({ prompt: d.prompt.trim(), type: d.type, instruction });
      if (result.ok && result.prompt) patch(d.id, { prompt: result.prompt });
      else setAiErrors((e) => ({ ...e, [d.id]: result.message ?? 'Couldn’t reword that one.' }));
    } finally {
      setImproving((m) => ({ ...m, [d.id]: false }));
    }
  };

  const input = (): QuestionnaireInput => ({
    ...(questionnaire ? { id: questionnaire.id } : {}),
    title: title.trim(),
    type,
    sensitivity,
    questions: drafts.map((d) => toQuestion(d, drafts)),
  });

  const onSave = async (): Promise<void> => {
    if (!canSave) return;
    setBusy(true);
    try {
      await save(input());
      onDone();
    } finally {
      setBusy(false);
    }
  };

  const onCheck = async (): Promise<void> => {
    if (!allPrompts) {
      setProblems(['Every question needs a prompt.']);
      return;
    }
    const rangeProblems = drafts
      .filter(
        (d) =>
          RANGE_TYPES.includes(d.type) &&
          (!Number.isFinite(d.min) || !Number.isFinite(d.max) || d.min >= d.max),
      )
      .map((d) => `"${d.prompt.trim()}" needs Min below Max.`);
    // Accessibility: an attached image must carry alt text (the relay page meets the same WCAG bar).
    const altProblems = drafts
      .filter((d) => d.media && d.media.alt.trim() === '')
      .map((d) => `The image on "${d.prompt.trim()}" needs a description (alt text).`);
    setProblems([...rangeProblems, ...altProblems, ...(await validate(input()))]);
  };

  const onRemove = async (): Promise<void> => {
    if (!questionnaire) return;
    setBusy(true);
    try {
      await remove(questionnaire.id);
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap={4}>
      <div className={styles.builderHeader}>
        <Heading level={3}>{questionnaire ? 'Edit questionnaire' : 'New questionnaire'}</Heading>
        <SegmentedControl<BuilderMode>
          aria-label="Builder mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'edit', label: 'Edit' },
            { value: 'preview', label: 'Preview' },
          ]}
        />
      </div>

      {mode === 'preview' ? (
        <QuestionnairePreview questions={previewQuestions} />
      ) : (
        <>
          <Card>
            <Stack gap={4}>
              <Field label="Title">
                {(props) => (
                  <TextInput
                    {...props}
                    value={title}
                    placeholder="e.g. Weekly check-in"
                    onChange={(event) => {
                      setProblems(null);
                      setTitle(event.target.value);
                    }}
                  />
                )}
              </Field>

              <div className={styles.metaRow}>
                <Field label="Type">
                  {(props) => (
                    <div className={styles.typePicker}>
                      <Select
                        {...props}
                        value={type}
                        onChange={(event) => {
                          setProblems(null);
                          setType(event.target.value);
                        }}
                      >
                        <optgroup label="Starter">
                          {QUESTIONNAIRE_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </optgroup>
                        {customList.length > 0 ? (
                          <optgroup label="Custom">
                            {customList.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </optgroup>
                        ) : null}
                      </Select>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setAddingType(true);
                          setNewType('');
                          setTypeError(null);
                        }}
                      >
                        <Plus size={14} aria-hidden="true" />
                        New type
                      </Button>
                    </div>
                  )}
                </Field>

                <Field label="Sensitivity">
                  {(props) => (
                    <Select
                      {...props}
                      value={sensitivity}
                      onChange={(event) => {
                        setProblems(null);
                        setSensitivity(event.target.value as SensitivityTier);
                      }}
                    >
                      {SENSITIVITY_OPTIONS.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>

              {addingType ? (
                <div className={styles.addType}>
                  <TextInput
                    value={newType}
                    aria-label="New type name"
                    placeholder="Name your type (e.g. Affair recovery)"
                    autoFocus
                    onChange={(event) => {
                      setTypeError(null);
                      setNewType(event.target.value);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void confirmAddType();
                      }
                    }}
                  />
                  <Button variant="primary" onClick={() => void confirmAddType()}>
                    Add
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setAddingType(false);
                      setTypeError(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              ) : null}
              {typeError ? (
                <p className={styles.typeError} role="alert">
                  {typeError}
                </p>
              ) : null}

              {SENSITIVITY_NOTES[sensitivity] ? (
                <Banner tone="info">{SENSITIVITY_NOTES[sensitivity]}</Banner>
              ) : null}
            </Stack>
          </Card>

          <QuestionnaireAiPanel
            aiReady={aiReady}
            type={type}
            sensitivity={sensitivity}
            existingPrompts={drafts.map((d) => d.prompt.trim()).filter(Boolean)}
            onGenerated={appendGenerated}
          />

          <div className={styles.questions}>
            {drafts.map((d, index) => {
              const candidates = drafts
                .slice(0, index)
                .map((t, i) => ({ draft: t, number: i + 1 }))
                .filter(
                  ({ draft }) =>
                    draft.type === 'yesNo' ||
                    (draft.type === 'singleChoice' &&
                      draft.options.some((o) => o.text.trim() !== '')),
                );
              const branchRef = d.branch
                ? candidates.find((c) => c.draft.id === d.branch?.whenQuestionId)
                : undefined;
              const branchOnId = branchRef ? branchRef.draft.id : '';

              return (
                <div key={d.id} className={styles.question}>
                  {d.aiDrafted ? (
                    <span className={styles.aiBadge}>
                      <Sparkles size={12} aria-hidden="true" />
                      AI draft — review it
                    </span>
                  ) : null}
                  <div className={styles.questionTop}>
                    <Field label={`Question ${index + 1}`}>
                      {(props) => (
                        <TextInput
                          {...props}
                          value={d.prompt}
                          placeholder="What do you want to ask?"
                          onChange={(event) => patch(d.id, { prompt: event.target.value })}
                        />
                      )}
                    </Field>
                    <IconButton
                      aria-label={`Remove question ${index + 1}`}
                      variant="secondary"
                      disabled={busy}
                      onClick={() => {
                        setProblems(null);
                        setDrafts((ds) => ds.filter((x) => x.id !== d.id));
                      }}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </IconButton>
                  </div>

                  {aiReady && d.prompt.trim() !== '' ? (
                    <div className={styles.aiAssist}>
                      <Text size="xs" tone="tertiary">
                        Reword:
                      </Text>
                      {['warmer', 'tighter'].map((instruction) => (
                        <button
                          key={instruction}
                          type="button"
                          className={styles.aiAssistButton}
                          disabled={improving[d.id]}
                          onClick={() => void onImprove(d, instruction)}
                        >
                          <Sparkles size={12} aria-hidden="true" />
                          {instruction === 'warmer' ? 'Warmer' : 'Tighter'}
                        </button>
                      ))}
                      {aiErrors[d.id] ? (
                        <Text size="xs" tone="secondary">
                          {aiErrors[d.id]}
                        </Text>
                      ) : null}
                    </div>
                  ) : null}

                  <Field label="Help text (optional)">
                    {(props) => (
                      <TextInput
                        {...props}
                        value={d.help}
                        placeholder="Extra context shown under the question"
                        onChange={(event) => patch(d.id, { help: event.target.value })}
                      />
                    )}
                  </Field>

                  <div className={styles.imageEditor}>
                    {d.media ? (
                      <>
                        <QuestionImage media={d.media} loadImage={getImage} />
                        <Field label="Image description (alt text)">
                          {(props) => (
                            <TextInput
                              {...props}
                              value={d.media?.alt ?? ''}
                              placeholder="Describe the image for screen readers"
                              onChange={(event) =>
                                patch(d.id, {
                                  media: d.media ? { ...d.media, alt: event.target.value } : null,
                                })
                              }
                            />
                          )}
                        </Field>
                        <Button variant="secondary" onClick={() => onRemoveImage(d)}>
                          <Trash2 size={14} aria-hidden="true" />
                          Remove image
                        </Button>
                      </>
                    ) : (
                      <label className={styles.addImage}>
                        <ImagePlus size={14} aria-hidden="true" />
                        Add image
                        <input
                          type="file"
                          className={styles.hiddenFile}
                          accept={ALLOWED_IMAGE_MIME.join(',')}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.target.value = ''; // allow re-picking the same file
                            void onPickImage(d.id, file);
                          }}
                        />
                      </label>
                    )}
                    {imageErrors[d.id] ? (
                      <p className={styles.typeError} role="alert">
                        {imageErrors[d.id]}
                      </p>
                    ) : null}
                  </div>

                  <div className={styles.typeRow}>
                    <Field label="Answer type">
                      {(props) => (
                        <Select
                          {...props}
                          value={d.type}
                          onChange={(event) =>
                            patch(d.id, { type: event.target.value as AnswerType })
                          }
                        >
                          {TYPE_OPTIONS.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    <div className={styles.requiredToggle}>
                      <Switch
                        checked={d.required}
                        onChange={(checked) => patch(d.id, { required: checked })}
                        aria-label={`Question ${index + 1} required`}
                      />
                      <Text size="sm">Required</Text>
                    </div>
                  </div>

                  {OPTION_TYPES.includes(d.type) ? (
                    <div className={styles.options}>
                      <Text size="sm" weight={500}>
                        Options
                      </Text>
                      {d.options.map((o, oi) => (
                        <div key={o.id} className={styles.optionRow}>
                          <TextInput
                            value={o.text}
                            aria-label={`Option ${oi + 1}`}
                            placeholder={`Option ${oi + 1}`}
                            onChange={(event) =>
                              patch(d.id, {
                                options: d.options.map((x) =>
                                  x.id === o.id ? { ...x, text: event.target.value } : x,
                                ),
                              })
                            }
                          />
                          <IconButton
                            aria-label={`Remove option ${oi + 1}`}
                            variant="secondary"
                            onClick={() =>
                              patch(d.id, { options: d.options.filter((x) => x.id !== o.id) })
                            }
                          >
                            <Trash2 size={14} aria-hidden="true" />
                          </IconButton>
                        </div>
                      ))}
                      <Button
                        variant="secondary"
                        onClick={() =>
                          patch(d.id, { options: [...d.options, { id: genId(), text: '' }] })
                        }
                      >
                        <Plus size={14} aria-hidden="true" />
                        Add option
                      </Button>
                    </div>
                  ) : null}

                  {d.type === 'matrix' ? (
                    <div className={styles.options}>
                      <Text size="sm" weight={500}>
                        Rows
                      </Text>
                      {d.rows.map((r, ri) => (
                        <div key={r.id} className={styles.optionRow}>
                          <TextInput
                            value={r.text}
                            aria-label={`Row ${ri + 1}`}
                            placeholder={`Row ${ri + 1}`}
                            onChange={(event) =>
                              patch(d.id, {
                                rows: d.rows.map((x) =>
                                  x.id === r.id ? { ...x, text: event.target.value } : x,
                                ),
                              })
                            }
                          />
                          <IconButton
                            aria-label={`Remove row ${ri + 1}`}
                            variant="secondary"
                            onClick={() =>
                              patch(d.id, { rows: d.rows.filter((x) => x.id !== r.id) })
                            }
                          >
                            <Trash2 size={14} aria-hidden="true" />
                          </IconButton>
                        </div>
                      ))}
                      <Button
                        variant="secondary"
                        onClick={() =>
                          patch(d.id, { rows: [...d.rows, { id: genId(), text: '' }] })
                        }
                      >
                        <Plus size={14} aria-hidden="true" />
                        Add row
                      </Button>
                    </div>
                  ) : null}

                  {RANGE_TYPES.includes(d.type) ? (
                    <>
                      <div className={styles.scaleRow}>
                        <Field label="Min">
                          {(props) => (
                            <TextInput
                              {...props}
                              type="number"
                              value={String(d.min)}
                              onChange={(event) =>
                                patch(d.id, { min: toFinite(event.target.value) })
                              }
                            />
                          )}
                        </Field>
                        <Field label="Max">
                          {(props) => (
                            <TextInput
                              {...props}
                              type="number"
                              value={String(d.max)}
                              onChange={(event) =>
                                patch(d.id, { max: toFinite(event.target.value) })
                              }
                            />
                          )}
                        </Field>
                      </div>
                      <div className={styles.scaleRow}>
                        <Field label="Low label (optional)">
                          {(props) => (
                            <TextInput
                              {...props}
                              value={d.minLabel}
                              placeholder="e.g. Never"
                              onChange={(event) => patch(d.id, { minLabel: event.target.value })}
                            />
                          )}
                        </Field>
                        <Field label="High label (optional)">
                          {(props) => (
                            <TextInput
                              {...props}
                              value={d.maxLabel}
                              placeholder="e.g. Always"
                              onChange={(event) => patch(d.id, { maxLabel: event.target.value })}
                            />
                          )}
                        </Field>
                      </div>
                    </>
                  ) : null}

                  {candidates.length > 0 ? (
                    <div className={styles.branchRow}>
                      <Field label="Only show this question">
                        {(props) => (
                          <Select
                            {...props}
                            value={branchOnId}
                            onChange={(event) => {
                              const value = event.target.value;
                              if (value === '') {
                                patch(d.id, { branch: null });
                                return;
                              }
                              const ref = drafts.find((x) => x.id === value);
                              const first = ref ? (triggerValues(ref)[0]?.value ?? '') : '';
                              patch(d.id, { branch: { whenQuestionId: value, equals: first } });
                            }}
                          >
                            <option value="">Always</option>
                            {candidates.map((c) => (
                              <option key={c.draft.id} value={c.draft.id}>
                                When question {c.number} answered…
                              </option>
                            ))}
                          </Select>
                        )}
                      </Field>
                      {branchRef ? (
                        <Field label="…equals">
                          {(props) => (
                            <Select
                              {...props}
                              value={d.branch?.equals ?? ''}
                              onChange={(event) =>
                                patch(d.id, {
                                  branch: {
                                    whenQuestionId: branchRef.draft.id,
                                    equals: event.target.value,
                                  },
                                })
                              }
                            >
                              {triggerValues(branchRef.draft).map((v) => (
                                <option key={v.value} value={v.value}>
                                  {v.label}
                                </option>
                              ))}
                            </Select>
                          )}
                        </Field>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}

            <Button
              variant="secondary"
              onClick={() => {
                setProblems(null);
                setDrafts((ds) => [...ds, blankDraft()]);
              }}
            >
              <Plus size={16} aria-hidden="true" />
              Add question
            </Button>
          </div>

          {problems !== null ? (
            <Banner tone={problems.length === 0 ? 'info' : 'warning'}>
              {problems.length === 0
                ? 'Looks good — this questionnaire is ready to send.'
                : problems.join(' ')}
            </Banner>
          ) : null}

          <div className={styles.footer}>
            <Button variant="secondary" onClick={() => void onCheck()} disabled={busy}>
              Check
            </Button>
            <div className={styles.footerActions}>
              <Button variant="primary" onClick={() => void onSave()} disabled={!canSave}>
                {questionnaire ? 'Save' : 'Create'}
              </Button>
              <Button variant="secondary" onClick={onDone} disabled={busy}>
                Cancel
              </Button>
              {questionnaire ? (
                <IconButton
                  aria-label="Delete questionnaire"
                  variant="secondary"
                  onClick={() => void onRemove()}
                  disabled={busy}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </IconButton>
              ) : null}
            </div>
          </div>
        </>
      )}
    </Stack>
  );
}

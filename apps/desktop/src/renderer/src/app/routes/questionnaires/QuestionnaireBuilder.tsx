import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useQuestionnaireStore } from '../../../stores/questionnaireStore';
import {
  Banner,
  Button,
  Card,
  Field,
  Heading,
  IconButton,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from '../../../design-system/components';
import type { AnswerType, Question, Questionnaire, QuestionnaireInput } from '@shared/schemas';
import styles from './Questionnaires.module.css';

/** A small starter taxonomy (the full list + custom types come with AI generation). */
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

/** Answer types this builder can author (matrix + question-images + branching are a later sub-slice). */
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
];
const OPTION_TYPES: AnswerType[] = [
  'singleChoice',
  'multiChoice',
  'ranking',
  'thisOrThat',
  'allocation',
];
const SCALE_TYPES: AnswerType[] = ['rating', 'slider'];

interface QDraft {
  id: string;
  type: AnswerType;
  prompt: string;
  required: boolean;
  options: { id: string; text: string }[];
  min: number;
  max: number;
}

const genId = (): string => `q-${Math.random().toString(36).slice(2, 10)}`;

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
    required: true,
    options: [
      { id: genId(), text: '' },
      { id: genId(), text: '' },
    ],
    min: 1,
    max: 5,
  };
}

function fromQuestion(q: Question): QDraft {
  return {
    id: q.id,
    type: q.type,
    prompt: q.prompt,
    required: q.required,
    options: (q.options && q.options.length > 0 ? q.options : ['', '']).map((text) => ({
      id: genId(),
      text,
    })),
    min: q.scale?.min ?? 1,
    max: q.scale?.max ?? 5,
  };
}

function toQuestion(d: QDraft): Question {
  return {
    id: d.id,
    type: d.type,
    prompt: d.prompt.trim(),
    required: d.required,
    ...(OPTION_TYPES.includes(d.type)
      ? { options: d.options.map((o) => o.text.trim()).filter(Boolean) }
      : {}),
    ...(SCALE_TYPES.includes(d.type) ? { scale: { min: d.min, max: d.max } } : {}),
  };
}

/** Create or edit a questionnaire: title + type + a list of questions, with a validation check. */
export function QuestionnaireBuilder({
  questionnaire,
  onDone,
}: {
  questionnaire: Questionnaire | null;
  onDone: () => void;
}): JSX.Element {
  const save = useQuestionnaireStore((s) => s.save);
  const remove = useQuestionnaireStore((s) => s.remove);
  const validate = useQuestionnaireStore((s) => s.validate);

  const [title, setTitle] = useState(questionnaire?.title ?? '');
  const [type, setType] = useState(questionnaire?.type ?? 'role-feedback');
  const [drafts, setDrafts] = useState<QDraft[]>(
    questionnaire ? questionnaire.questions.map(fromQuestion) : [blankDraft()],
  );
  const [problems, setProblems] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const allPrompts = drafts.every((d) => d.prompt.trim() !== '');
  const canSave = title.trim() !== '' && allPrompts && !busy;

  const patch = (id: string, change: Partial<QDraft>): void => {
    setProblems(null);
    setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, ...change } : d)));
  };

  const input = (): QuestionnaireInput => ({
    ...(questionnaire ? { id: questionnaire.id } : {}),
    title: title.trim(),
    type,
    sensitivity: 'standard',
    questions: drafts.map(toQuestion),
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
    const scaleProblems = drafts
      .filter(
        (d) =>
          SCALE_TYPES.includes(d.type) &&
          (!Number.isFinite(d.min) || !Number.isFinite(d.max) || d.min >= d.max),
      )
      .map((d) => `"${d.prompt.trim()}" needs Min below Max.`);
    setProblems([...scaleProblems, ...(await validate(input()))]);
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
      <Heading level={3}>{questionnaire ? 'Edit questionnaire' : 'New questionnaire'}</Heading>

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
          <Field label="Type">
            {(props) => (
              <Select
                {...props}
                value={type}
                onChange={(event) => {
                  setProblems(null);
                  setType(event.target.value);
                }}
              >
                {QUESTIONNAIRE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </Stack>
      </Card>

      <div className={styles.questions}>
        {drafts.map((d, index) => (
          <div key={d.id} className={styles.question}>
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

            <div className={styles.typeRow}>
              <Field label="Answer type">
                {(props) => (
                  <Select
                    {...props}
                    value={d.type}
                    onChange={(event) => patch(d.id, { type: event.target.value as AnswerType })}
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

            {SCALE_TYPES.includes(d.type) ? (
              <div className={styles.scaleRow}>
                <Field label="Min">
                  {(props) => (
                    <TextInput
                      {...props}
                      type="number"
                      value={String(d.min)}
                      onChange={(event) => patch(d.id, { min: toFinite(event.target.value) })}
                    />
                  )}
                </Field>
                <Field label="Max">
                  {(props) => (
                    <TextInput
                      {...props}
                      type="number"
                      value={String(d.max)}
                      onChange={(event) => patch(d.id, { max: toFinite(event.target.value) })}
                    />
                  )}
                </Field>
              </div>
            ) : null}
          </div>
        ))}

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
    </Stack>
  );
}

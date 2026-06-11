import { useEffect } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { visibleQuestions, allocationTotal } from '@selfos/core/questionnaires';
import type { AnswerValue, AnswerMap } from '@selfos/core/questionnaires';
import type { Question } from '@shared/schemas';
import { IconButton, Slider, Text, Textarea, TextInput } from '../../../design-system/components';
import { CrisisFooter } from '../sessions/CrisisFooter';
import styles from './QuestionnaireForm.module.css';

/**
 * The shared questionnaire-answering renderer (08-questionnaires §5.3) — used by preview / test-on-self
 * now, and the in-app Inbox + relay page later (one renderer, many hosts). It renders the currently
 * **visible** questions (branch-aware), one control per answer type, and never persists anything: the
 * host owns the `answers` state. The crisis footer + not-medical line are always present (§8.2).
 */
interface QuestionnaireFormProps {
  questions: Question[];
  answers: AnswerMap;
  onChange: (questionId: string, value: AnswerValue) => void;
}

const range = (min: number, max: number): number[] => {
  const lo = Math.ceil(Math.min(min, max));
  const hi = Math.floor(Math.max(min, max));
  return Array.from({ length: Math.max(0, hi - lo + 1) }, (_, i) => lo + i);
};

const asNumberMap = (value: AnswerValue | undefined): Record<string, number> =>
  value !== undefined && typeof value === 'object' && !Array.isArray(value) ? value : {};

/** A horizontal min→max scale of selectable points (rating, and each matrix row). */
function ScalePicker({
  min,
  max,
  value,
  onPick,
  ariaLabel,
}: {
  min: number;
  max: number;
  value: number | undefined;
  onPick: (n: number) => void;
  ariaLabel: string;
}): JSX.Element {
  return (
    <div className={styles.scale} role="radiogroup" aria-label={ariaLabel}>
      {range(min, max).map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={String(n)}
          className={
            value === n ? `${styles.scalePoint} ${styles.scalePointOn}` : styles.scalePoint
          }
          onClick={() => onPick(n)}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

/** A range slider; seeds to `min` on first render so the thumb position reflects a real answer. */
function SliderControl({
  question,
  value,
  set,
}: {
  question: Question;
  value: AnswerValue | undefined;
  set: (value: AnswerValue) => void;
}): JSX.Element {
  const scale = question.scale ?? { min: 0, max: 10 };
  // Seed the thumb to `min` once on mount so an untouched slider still reads as a real answer.
  useEffect(() => {
    if (value === undefined) set(scale.min);
  }, []);
  const current = typeof value === 'number' ? value : scale.min;
  return (
    <div className={styles.sliderWrap}>
      <Slider
        min={scale.min}
        max={scale.max}
        step={scale.step ?? 1}
        value={current}
        aria-label={question.prompt}
        onChange={(event) => set(Number(event.target.value))}
      />
      <div className={styles.sliderScale}>
        <Text size="xs" tone="secondary">
          {scale.minLabel ?? scale.min}
        </Text>
        <Text size="sm" weight={600}>
          {current}
        </Text>
        <Text size="xs" tone="secondary">
          {scale.maxLabel ?? scale.max}
        </Text>
      </div>
    </div>
  );
}

/** Reorderable list (↑/↓); seeds to the authored order so it counts as answered without forcing a move. */
function RankingControl({
  question,
  value,
  set,
}: {
  question: Question;
  value: AnswerValue | undefined;
  set: (value: AnswerValue) => void;
}): JSX.Element {
  const options = question.options ?? [];
  // Seed the authored order once on mount so an untouched ranking still counts as answered.
  useEffect(() => {
    if (value === undefined && options.length > 0) set([...options]);
  }, []);
  const order = Array.isArray(value) ? value : options;
  const move = (index: number, delta: number): void => {
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    const a = next[index];
    const b = next[target];
    if (a === undefined || b === undefined) return;
    next[index] = b;
    next[target] = a;
    set(next);
  };
  return (
    <ol className={styles.ranking}>
      {order.map((option, index) => (
        <li key={option} className={styles.rankRow}>
          <span className={styles.rankNum} aria-hidden="true">
            {index + 1}
          </span>
          <span className={styles.rankText}>{option}</span>
          <IconButton
            aria-label={`Move ${option} up`}
            variant="secondary"
            disabled={index === 0}
            onClick={() => move(index, -1)}
          >
            <ChevronUp size={16} aria-hidden="true" />
          </IconButton>
          <IconButton
            aria-label={`Move ${option} down`}
            variant="secondary"
            disabled={index === order.length - 1}
            onClick={() => move(index, 1)}
          >
            <ChevronDown size={16} aria-hidden="true" />
          </IconButton>
        </li>
      ))}
    </ol>
  );
}

/** Render the control for one question's answer type. */
function Control({
  question,
  value,
  set,
}: {
  question: Question;
  value: AnswerValue | undefined;
  set: (value: AnswerValue) => void;
}): JSX.Element {
  const options = question.options ?? [];
  switch (question.type) {
    case 'shortText':
      return (
        <TextInput
          value={typeof value === 'string' ? value : ''}
          aria-label={question.prompt}
          onChange={(event) => set(event.target.value)}
        />
      );
    case 'longText':
      return (
        <Textarea
          value={typeof value === 'string' ? value : ''}
          aria-label={question.prompt}
          onChange={(event) => set(event.target.value)}
        />
      );
    case 'date':
      return (
        <TextInput
          type="date"
          value={typeof value === 'string' ? value : ''}
          aria-label={question.prompt}
          onChange={(event) => set(event.target.value)}
        />
      );
    case 'yesNo':
      return (
        <div className={styles.choices} role="radiogroup" aria-label={question.prompt}>
          {[
            { label: 'Yes', on: value === true },
            { label: 'No', on: value === false },
          ].map((opt) => (
            <button
              key={opt.label}
              type="button"
              role="radio"
              aria-checked={opt.on}
              className={opt.on ? `${styles.pill} ${styles.pillOn}` : styles.pill}
              onClick={() => set(opt.label === 'Yes')}
            >
              {opt.label}
            </button>
          ))}
        </div>
      );
    case 'thisOrThat':
      return (
        <div className={styles.choices} role="radiogroup" aria-label={question.prompt}>
          {options.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={value === option}
              className={value === option ? `${styles.pill} ${styles.pillOn}` : styles.pill}
              onClick={() => set(option)}
            >
              {option}
            </button>
          ))}
        </div>
      );
    case 'singleChoice':
      return (
        <div className={styles.optionList} role="radiogroup" aria-label={question.prompt}>
          {options.map((option) => (
            <label key={option} className={styles.optionRow}>
              <input
                type="radio"
                name={question.id}
                checked={value === option}
                onChange={() => set(option)}
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
      );
    case 'multiChoice': {
      const selected = Array.isArray(value) ? value : [];
      return (
        <div className={styles.optionList} role="group" aria-label={question.prompt}>
          {options.map((option) => (
            <label key={option} className={styles.optionRow}>
              <input
                type="checkbox"
                checked={selected.includes(option)}
                onChange={() =>
                  set(
                    selected.includes(option)
                      ? selected.filter((x) => x !== option)
                      : [...selected, option],
                  )
                }
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
      );
    }
    case 'rating': {
      const scale = question.scale ?? { min: 1, max: 5 };
      return (
        <ScalePicker
          min={scale.min}
          max={scale.max}
          value={typeof value === 'number' ? value : undefined}
          onPick={set}
          ariaLabel={question.prompt}
        />
      );
    }
    case 'slider':
      return <SliderControl question={question} value={value} set={set} />;
    case 'ranking':
      return <RankingControl question={question} value={value} set={set} />;
    case 'matrix': {
      const matrix = question.matrix ?? { rows: [], min: 1, max: 5 };
      const current = asNumberMap(value);
      return (
        <div className={styles.matrix}>
          {matrix.rows.map((row) => (
            <div key={row} className={styles.matrixRow}>
              <span className={styles.matrixLabel}>{row}</span>
              <ScalePicker
                min={matrix.min}
                max={matrix.max}
                value={current[row]}
                onPick={(n) => set({ ...current, [row]: n })}
                ariaLabel={`${question.prompt} — ${row}`}
              />
            </div>
          ))}
        </div>
      );
    }
    case 'allocation': {
      const current = asNumberMap(value);
      const remaining = 100 - allocationTotal(value);
      return (
        <div className={styles.allocation}>
          {options.map((bucket) => (
            <div key={bucket} className={styles.allocationRow}>
              <span className={styles.allocationLabel}>{bucket}</span>
              <TextInput
                type="number"
                min={0}
                value={String(current[bucket] ?? 0)}
                aria-label={`${question.prompt} — ${bucket}`}
                onChange={(event) => {
                  // Clamp to ≥ 0 so a negative bucket can't fake a 100-point total (this control is
                  // the shared answering renderer the Inbox + relay will reuse).
                  const n = Number(event.target.value);
                  set({ ...current, [bucket]: Number.isFinite(n) ? Math.max(0, n) : 0 });
                }}
              />
            </div>
          ))}
          <Text size="sm" tone={remaining === 0 ? 'secondary' : 'accent'}>
            {remaining === 0 ? 'All 100 points allocated.' : `${remaining} of 100 points left.`}
          </Text>
        </div>
      );
    }
    default:
      return <Text tone="secondary">Unsupported question type.</Text>;
  }
}

/** One question: prompt (with a required marker), optional help, and its answer control. */
function QuestionField({
  question,
  value,
  onChange,
}: {
  question: Question;
  value: AnswerValue | undefined;
  onChange: (questionId: string, value: AnswerValue) => void;
}): JSX.Element {
  return (
    <fieldset className={styles.question}>
      <legend className={styles.prompt}>
        {question.prompt}
        {question.required ? (
          <>
            <span aria-hidden="true" className={styles.required}>
              {' '}
              *
            </span>
            <span className={styles.srOnly}> (required)</span>
          </>
        ) : null}
      </legend>
      {question.help ? (
        <Text size="sm" tone="secondary">
          {question.help}
        </Text>
      ) : null}
      <Control question={question} value={value} set={(v) => onChange(question.id, v)} />
    </fieldset>
  );
}

export function QuestionnaireForm({
  questions,
  answers,
  onChange,
}: QuestionnaireFormProps): JSX.Element {
  const visible = visibleQuestions(questions, answers);
  return (
    <div className={styles.form}>
      {visible.length === 0 ? (
        <Text tone="secondary">Add a question with a prompt to preview it.</Text>
      ) : (
        visible.map((question) => (
          <QuestionField
            key={question.id}
            question={question}
            value={answers[question.id]}
            onChange={onChange}
          />
        ))
      )}
      <CrisisFooter />
    </div>
  );
}

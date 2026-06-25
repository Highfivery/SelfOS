import { useEffect, useState, type ReactNode } from 'react';
import {
  visibleQuestions,
  allocationTotal,
  isDateEntryList,
  isRosterList,
} from '@selfos/core/questionnaires';
import type { AnswerValue, AnswerMap, RosterRow } from '@selfos/core/questionnaires';
import { matrixRowKey, matrixRowLabel, type Question } from '@selfos/core/schemas';
import { CrisisFooter } from './CrisisFooter';
import { QuestionImage, type LoadImage } from './QuestionImage';
import styles from './styles.module.css';

export type { LoadImage } from './QuestionImage';

/**
 * The shared questionnaire-answering renderer (08-questionnaires §5.3) — the ONE implementation used by
 * preview / test-on-self, the in-app Inbox, AND the relay answering page (one renderer, many hosts). It
 * renders the currently **visible** questions (branch-aware), one control per answer type, and never
 * persists anything: the host owns the `answers` state. The crisis footer + not-medical line are always
 * present (§8.2) — a host may swap in its own `footer`, but one is always shown.
 *
 * Self-contained: plain elements + token CSS, depending only on the pure `@selfos/core/questionnaires`
 * `answering` helper — no app design-system — so it bundles into the relay Worker's static page too.
 */
/**
 * Per-question sharing controls (43-relationship-scoped-onboarding-sharing §3.1/§5). Supplied ONLY by the
 * onboarding host — `@selfos/answering` stays free of the app design-system, so the host renders the actual
 * `RelationshipScopePicker` via `renderControl`. Absent ⇒ no sharing UI (questionnaires render unchanged).
 */
export interface QuestionSharing {
  /** Render the sharing control for a question's header row (e.g. a relationship-scope chip + popover). */
  renderControl: (questionId: string) => ReactNode;
}

interface QuestionnaireFormProps {
  questions: Question[];
  answers: AnswerMap;
  onChange: (questionId: string, value: AnswerValue) => void;
  /** Supplies decrypted image bytes for any question with `media`; omit to skip image rendering. */
  loadImage?: LoadImage;
  /** Per-question sharing controls (onboarding only, 43); omit ⇒ no sharing UI. */
  sharing?: QuestionSharing;
  /** Crisis affordance shown below the questions; defaults to the built-in `CrisisFooter` (§8.2). */
  footer?: ReactNode;
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
  labels,
  limitLabels,
}: {
  min: number;
  max: number;
  value: number | undefined;
  onPick: (n: number) => void;
  ariaLabel: string;
  // When given (one per point), each button shows its label instead of the bare number — a labelled matrix
  // (e.g. Hard no · Not interested · Curious · Like it · Love it). Buttons stay flex-wrapped, never overflowing.
  labels?: string[];
  // Labels rendered with a distinct boundary/limit tone (e.g. ['Hard no']) — a hard no reads as a boundary,
  // not just another feeling. Only meaningful alongside `labels`.
  limitLabels?: string[];
}): JSX.Element {
  return (
    <div className={styles.scale} role="radiogroup" aria-label={ariaLabel}>
      {range(min, max).map((n, i) => {
        const label = labels?.[i];
        const isLimit = label !== undefined && (limitLabels?.includes(label) ?? false);
        const cls = [
          styles.scalePoint,
          value === n ? styles.scalePointOn : '',
          isLimit ? styles.scalePointLimit : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={label ?? String(n)}
            className={cls}
            onClick={() => onPick(n)}
          >
            {label ?? n}
          </button>
        );
      })}
    </div>
  );
}

/** The labels for a labelled matrix — the N-point `pointLabels` when its length matches the point count, else
 * the legacy 3-point min/mid/maxLabel — or undefined for a plain numbered matrix. */
function matrixPointLabels(matrix: {
  min: number;
  max: number;
  minLabel?: string | undefined;
  midLabel?: string | undefined;
  maxLabel?: string | undefined;
  pointLabels?: string[] | undefined;
}): string[] | undefined {
  const span = matrix.max - matrix.min + 1;
  if (matrix.pointLabels && matrix.pointLabels.length === span) return matrix.pointLabels;
  if (matrix.max - matrix.min !== 2) return undefined;
  const { minLabel, midLabel, maxLabel } = matrix;
  if (!minLabel || !midLabel || !maxLabel) return undefined;
  return [minLabel, midLabel, maxLabel];
}

/** A range slider; the thumb SHOWS at the middle as a neutral starting position, but the value stays
 * UNCOMMITTED until the person actually moves it. */
function SliderControl({
  question,
  value,
  set,
}: {
  question: Question;
  value: AnswerValue | undefined;
  set: (value: AnswerValue) => void;
}): JSX.Element {
  // Rating questions default to a 1–5 scale, sliders to 0–10, when the author didn't set bounds.
  const scale =
    question.scale ?? (question.type === 'rating' ? { min: 1, max: 5 } : { min: 0, max: 10 });
  const middle = Math.round((scale.min + scale.max) / 2);
  // No auto-commit on mount (28-portrait-synthesis-optimization §pillar-3): an UNTOUCHED slider — optional or
  // required — records NOTHING, so it's not "answered" and never becomes a false-neutral portrait fact (an
  // untouched "energy" slider must not read as a deliberate "5/10"). The thumb still renders at `middle` as a
  // starting position; the value only exists once the person moves it.
  const current = typeof value === 'number' ? value : middle;
  // With descriptive labels at start/middle/end (18 §14.5), anchor all three under the track and drop the
  // raw number; otherwise keep the numeric min/value/max readout.
  const triLabelled = scale.midLabel !== undefined;
  return (
    <div className={styles.sliderWrap}>
      <input
        type="range"
        className={styles.slider}
        min={scale.min}
        max={scale.max}
        step={scale.step ?? 1}
        value={current}
        aria-label={question.prompt}
        onChange={(event) => set(Number(event.target.value))}
      />
      {triLabelled ? (
        <div className={styles.sliderTriLabels} aria-hidden="true">
          <span>{scale.minLabel}</span>
          <span>{scale.midLabel}</span>
          <span>{scale.maxLabel}</span>
        </div>
      ) : (
        <div className={styles.sliderScale}>
          <span className={styles.sliderEnd}>{scale.minLabel ?? scale.min}</span>
          <span className={styles.sliderValue}>{current}</span>
          <span className={styles.sliderEnd}>{scale.maxLabel ?? scale.max}</span>
        </div>
      )}
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
  // Ranking values are always a string list (this control only renders for `ranking` questions).
  const order: string[] = Array.isArray(value) ? (value as string[]) : options;
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
          <button
            type="button"
            className={styles.rankButton}
            aria-label={`Move ${option} up`}
            disabled={index === 0}
            onClick={() => move(index, -1)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M18 15l-6-6-6 6" stroke="currentColor" strokeWidth="2" />
            </svg>
          </button>
          <button
            type="button"
            className={styles.rankButton}
            aria-label={`Move ${option} down`}
            disabled={index === order.length - 1}
            onClick={() => move(index, 1)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" />
            </svg>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** A repeatable list of {label, date} rows (e.g. anniversaries) → a `dateList` answer. Empty rows are kept
 * in the working value but filtered out by `isAnswered`/persistence, so an untouched list reads as blank. */
function DateListControl({
  question,
  value,
  set,
}: {
  question: Question;
  value: AnswerValue | undefined;
  set: (value: AnswerValue) => void;
}): JSX.Element {
  const rows = isDateEntryList(value) ? value : [];
  const update = (i: number, patch: Partial<{ label: string; date: string }>): void =>
    set(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  return (
    <div className={styles.dateList}>
      {rows.map((row, i) => (
        <div key={i} className={styles.dateRow}>
          <input
            type="text"
            className={styles.input}
            value={row.label}
            placeholder="e.g. Anniversary"
            aria-label={`${question.prompt} — label ${i + 1}`}
            onChange={(event) => update(i, { label: event.target.value })}
          />
          <input
            type="date"
            className={styles.input}
            value={row.date}
            aria-label={`${question.prompt} — date ${i + 1}`}
            onChange={(event) => update(i, { date: event.target.value })}
          />
          <button
            type="button"
            className={styles.dateRemove}
            aria-label={`Remove ${row.label || `date ${i + 1}`}`}
            onClick={() => set(rows.filter((_, idx) => idx !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className={styles.dateAdd}
        onClick={() => set([...rows, { label: '', date: '' }])}
      >
        + Add a date
      </button>
    </div>
  );
}

/** A repeatable list of rows with configurable columns (e.g. kids: name/gender/age; pets: name/species/gender).
 * Each row is a small stacked card (fields stack vertically) so it never overflows at narrow widths. */
function RosterControl({
  question,
  value,
  set,
}: {
  question: Question;
  value: AnswerValue | undefined;
  set: (value: AnswerValue) => void;
}): JSX.Element {
  const cols = question.roster ?? [];
  const rows: RosterRow[] = isRosterList(value) ? value : [];
  const update = (i: number, key: string, v: string): void =>
    set(rows.map((r, idx) => (idx === i ? { ...r, [key]: v } : r)));
  return (
    <div className={styles.roster}>
      {rows.map((row, i) => (
        <div key={i} className={styles.rosterRow}>
          <div className={styles.rosterRowHead}>
            <span className={styles.rosterRowNum}>#{i + 1}</span>
            <button
              type="button"
              className={styles.dateRemove}
              aria-label={`Remove #${i + 1}`}
              onClick={() => set(rows.filter((_, idx) => idx !== i))}
            >
              ×
            </button>
          </div>
          {cols.map((col) => (
            <label key={col.key} className={styles.rosterField}>
              <span className={styles.rosterLabel}>{col.label}</span>
              {col.type === 'select' ? (
                <select
                  className={styles.input}
                  value={row[col.key] ?? ''}
                  aria-label={`${question.prompt} — ${col.label} ${i + 1}`}
                  onChange={(event) => update(i, col.key, event.target.value)}
                >
                  <option value="">—</option>
                  {(col.options ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={col.type === 'date' ? 'date' : 'text'}
                  className={styles.input}
                  value={row[col.key] ?? ''}
                  aria-label={`${question.prompt} — ${col.label} ${i + 1}`}
                  {...(col.type !== 'date' && col.placeholder
                    ? { placeholder: col.placeholder }
                    : {})}
                  onChange={(event) => update(i, col.key, event.target.value)}
                />
              )}
            </label>
          ))}
        </div>
      ))}
      <button type="button" className={styles.dateAdd} onClick={() => set([...rows, {}])}>
        + Add
      </button>
    </div>
  );
}

const OTHER = 'Other';

/**
 * One choice option as a left-aligned, full-width selectable card with a leading radio (single) / checkbox
 * (multi) indicator. Full-width + left-aligned so long option text reads cleanly at any length.
 */
function OptionCard({
  label,
  selected,
  multi,
  onClick,
}: {
  label: string;
  selected: boolean;
  multi: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      role={multi ? 'checkbox' : 'radio'}
      aria-checked={selected}
      className={selected ? `${styles.optionCard} ${styles.optionCardOn}` : styles.optionCard}
      onClick={onClick}
    >
      <span
        aria-hidden="true"
        className={`${styles.optionIndicator} ${
          multi ? styles.optionIndicatorCheck : styles.optionIndicatorRadio
        }`}
      />
      <span className={styles.optionLabel}>{label}</span>
    </button>
  );
}

/**
 * Single-choice as full-width option cards with an "Other" write-in (18 §14.3). The answer is the chosen option,
 * or — when "Other" is picked and text is typed — the free-text value (so downstream just sees the real value).
 * `otherOpen` keeps the write-in visible while empty; on mount it's derived from a value that isn't a preset option.
 */
function SingleChoiceControl({
  question,
  value,
  set,
}: {
  question: Question;
  value: AnswerValue | undefined;
  set: (value: AnswerValue) => void;
}): JSX.Element {
  const options = question.options ?? [];
  const presets = options.filter((o) => o !== OTHER);
  const hasOther = question.allowOther === true || options.includes(OTHER);
  const current = typeof value === 'string' ? value : '';
  const isCustom = current !== '' && !presets.includes(current);
  const [otherOpen, setOtherOpen] = useState(isCustom);

  return (
    <div>
      <div className={styles.optionCards} role="radiogroup" aria-label={question.prompt}>
        {presets.map((option) => (
          <OptionCard
            key={option}
            label={option}
            multi={false}
            selected={!otherOpen && current === option}
            onClick={() => {
              setOtherOpen(false);
              set(option);
            }}
          />
        ))}
        {hasOther ? (
          <OptionCard
            label={OTHER}
            multi={false}
            selected={otherOpen || isCustom}
            onClick={() => {
              setOtherOpen(true);
              if (!isCustom) set('');
            }}
          />
        ) : null}
      </div>
      {otherOpen ? (
        <input
          type="text"
          className={`${styles.input} ${styles.otherInput}`}
          value={isCustom ? current : ''}
          placeholder="Tell me more…"
          aria-label={`${question.prompt} — other`}
          onChange={(event) => set(event.target.value)}
        />
      ) : null}
    </div>
  );
}

/**
 * Multi-choice as full-width option cards with an "Other" write-in (18 §14.3). The answer array holds the selected preset
 * options PLUS any free-text the person typed (no literal "Other" stored) — so a clean round-trip: array −
 * presets = the write-in. `otherOpen` keeps the input visible while empty.
 */
function MultiChoiceControl({
  question,
  value,
  set,
}: {
  question: Question;
  value: AnswerValue | undefined;
  set: (value: AnswerValue) => void;
}): JSX.Element {
  const options = question.options ?? [];
  const presets = options.filter((o) => o !== OTHER);
  const hasOther = question.allowOther === true || options.includes(OTHER);
  // multiChoice values are always a string list (this control only renders for `multiChoice` questions).
  const selected: string[] = Array.isArray(value) ? (value as string[]) : [];
  const selectedPresets = selected.filter((s) => presets.includes(s));
  const customText = selected.filter((s) => !presets.includes(s)).join(', ');
  const [otherOpen, setOtherOpen] = useState(customText !== '');
  // Hold the raw write-in text locally so typing a space isn't trimmed away on each keystroke (the
  // committed answer array still trims each comma-segment, but the visible input keeps what was typed —
  // otherwise multi-word entries like "rock climbing" were impossible). Seeded once from the answer.
  const [otherText, setOtherText] = useState(customText);

  const commit = (nextPresets: string[], customCsv: string): void => {
    const customs = customCsv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    set([...nextPresets, ...customs]);
  };

  const onOtherInput = (raw: string): void => {
    setOtherText(raw);
    commit(selectedPresets, raw);
  };

  return (
    <div>
      <div className={styles.optionCards} role="group" aria-label={question.prompt}>
        {presets.map((option) => {
          const on = selectedPresets.includes(option);
          return (
            <OptionCard
              key={option}
              label={option}
              multi
              selected={on}
              onClick={() =>
                commit(
                  on ? selectedPresets.filter((x) => x !== option) : [...selectedPresets, option],
                  otherText,
                )
              }
            />
          );
        })}
        {hasOther ? (
          <OptionCard
            label={OTHER}
            multi
            selected={otherOpen || customText !== ''}
            onClick={() => {
              if (otherOpen) {
                setOtherOpen(false);
                setOtherText('');
                commit(selectedPresets, '');
              } else {
                setOtherOpen(true);
              }
            }}
          />
        ) : null}
      </div>
      {otherOpen ? (
        <input
          type="text"
          className={`${styles.input} ${styles.otherInput}`}
          value={otherText}
          placeholder="Add your own — separate with commas"
          aria-label={`${question.prompt} — other`}
          onChange={(event) => onOtherInput(event.target.value)}
        />
      ) : null}
    </div>
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
        <input
          type="text"
          className={styles.input}
          value={typeof value === 'string' ? value : ''}
          aria-label={question.prompt}
          {...(question.placeholder ? { placeholder: question.placeholder } : {})}
          onChange={(event) => set(event.target.value)}
        />
      );
    case 'longText':
      return (
        <textarea
          className={styles.textarea}
          rows={4}
          value={typeof value === 'string' ? value : ''}
          aria-label={question.prompt}
          {...(question.placeholder ? { placeholder: question.placeholder } : {})}
          onChange={(event) => set(event.target.value)}
        />
      );
    case 'date':
      return (
        <input
          type="date"
          className={styles.input}
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
        <div className={styles.optionCards} role="radiogroup" aria-label={question.prompt}>
          {options.map((option) => (
            <OptionCard
              key={option}
              label={option}
              multi={false}
              selected={value === option}
              onClick={() => set(option)}
            />
          ))}
        </div>
      );
    case 'singleChoice':
      return <SingleChoiceControl question={question} value={value} set={set} />;
    case 'multiChoice':
      return <MultiChoiceControl question={question} value={value} set={set} />;
    // Standalone scale questions (rating + slider) both render as a labelled slider — one consistent
    // control, no number-button grids (matrix keeps the compact per-row ScalePicker below).
    case 'rating':
    case 'slider':
      return <SliderControl question={question} value={value} set={set} />;
    case 'dateList':
      return <DateListControl question={question} value={value} set={set} />;
    case 'roster':
      return <RosterControl question={question} value={value} set={set} />;
    case 'ranking':
      return <RankingControl question={question} value={value} set={set} />;
    case 'matrix': {
      const matrix = question.matrix ?? { rows: [], min: 1, max: 5 };
      const current = asNumberMap(value);
      const pointLabels = matrixPointLabels(matrix);
      return (
        <div className={styles.matrix}>
          {matrix.rows.map((row) => {
            // A row is a plain string (key === label) OR a { key, label } pair (46 §4.2): key the answer by
            // the stable key, display the label.
            const key = matrixRowKey(row);
            const label = matrixRowLabel(row);
            return (
              <div key={key} className={styles.matrixRow}>
                <span className={styles.matrixLabel}>{label}</span>
                <ScalePicker
                  min={matrix.min}
                  max={matrix.max}
                  value={current[key]}
                  onPick={(n) => set({ ...current, [key]: n })}
                  ariaLabel={`${question.prompt} — ${label}`}
                  {...(pointLabels ? { labels: pointLabels } : {})}
                  {...(pointLabels && matrix.limitLabels
                    ? { limitLabels: matrix.limitLabels }
                    : {})}
                />
              </div>
            );
          })}
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
              <input
                type="number"
                min={0}
                className={`${styles.input} ${styles.allocationInput}`}
                value={String(current[bucket] ?? 0)}
                aria-label={`${question.prompt} — ${bucket}`}
                onChange={(event) => {
                  // Clamp to ≥ 0 so a negative bucket can't fake a 100-point total (this control is
                  // the shared answering renderer the Inbox + relay reuse).
                  const n = Number(event.target.value);
                  set({ ...current, [bucket]: Number.isFinite(n) ? Math.max(0, n) : 0 });
                }}
              />
            </div>
          ))}
          <p
            className={
              remaining === 0
                ? `${styles.allocationHint} ${styles.allocationHintDone}`
                : `${styles.allocationHint} ${styles.allocationHintLeft}`
            }
          >
            {remaining === 0 ? 'All 100 points allocated.' : `${remaining} of 100 points left.`}
          </p>
        </div>
      );
    }
    default:
      return <p className={styles.help}>Unsupported question type.</p>;
  }
}

/** One question: prompt (with a required marker), optional help + image, and its answer control. */
function QuestionField({
  question,
  value,
  onChange,
  loadImage,
  sharingControl,
}: {
  question: Question;
  value: AnswerValue | undefined;
  onChange: (questionId: string, value: AnswerValue) => void;
  loadImage?: LoadImage;
  /** A pre-rendered per-question sharing control (43) for the header row; omit ⇒ none. */
  sharingControl?: ReactNode;
}): JSX.Element {
  // A plain card with a visible prompt heading — NOT <fieldset>/<legend>, whose legend renders on the card's
  // top border and gets bisected when a long prompt wraps (the visible-overlap bug). Each control carries its
  // own aria-label (single inputs) or radiogroup/group label (choices, matrix), so the prompt still names the
  // control for screen readers without an aria-labelledby that would double-label and collide with it.
  const prompt = (
    <p className={styles.prompt}>
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
    </p>
  );
  return (
    <div className={styles.question}>
      {prompt}
      {/* 43 §3.1 — the sharing control sits on its own line directly UNDER the prompt, left-aligned (not
          floating right of a short prompt with a big empty gap). The inline sensitive-share confirm renders
          here too, co-located with the question. `flex: none` so it never causes an inner scrollbar (§12). */}
      {sharingControl ? <div className={styles.sharingSlot}>{sharingControl}</div> : null}
      {question.help ? <p className={styles.help}>{question.help}</p> : null}
      {question.media && loadImage ? (
        <QuestionImage media={question.media} loadImage={loadImage} />
      ) : null}
      <Control question={question} value={value} set={(v) => onChange(question.id, v)} />
    </div>
  );
}

export function QuestionnaireForm({
  questions,
  answers,
  onChange,
  loadImage,
  sharing,
  footer,
}: QuestionnaireFormProps): JSX.Element {
  const visible = visibleQuestions(questions, answers);
  const field = (question: Question): JSX.Element => (
    <QuestionField
      key={question.id}
      question={question}
      value={answers[question.id]}
      onChange={onChange}
      {...(loadImage ? { loadImage } : {})}
      {...(sharing ? { sharingControl: sharing.renderControl(question.id) } : {})}
    />
  );

  // Long forms can group questions under collapsible headings (18 §14.3). Ungrouped questions render first;
  // grouped ones follow as <details> in first-seen group order. Every group is **open by default** — the
  // accordion is for optional tidying, never for hiding questions (a collapsed group would silently swallow
  // inputs at the bottom of a section, so a person never sees them). They stay user-collapsible.
  const ungrouped = visible.filter((q) => !q.group);
  const groupOrder: string[] = [];
  for (const q of visible) if (q.group && !groupOrder.includes(q.group)) groupOrder.push(q.group);

  return (
    <div className={styles.form}>
      {visible.length === 0 ? (
        <p className={styles.empty}>Add a question with a prompt to preview it.</p>
      ) : (
        <>
          {ungrouped.map(field)}
          {groupOrder.length > 0 ? (
            <div className={styles.groups}>
              {groupOrder.map((name) => (
                <details key={name} className={styles.group} open>
                  <summary className={styles.groupSummary}>{name}</summary>
                  <div className={styles.groupBody}>
                    {visible.filter((q) => q.group === name).map(field)}
                  </div>
                </details>
              ))}
            </div>
          ) : null}
        </>
      )}
      {footer ?? <CrisisFooter />}
    </div>
  );
}

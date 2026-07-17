import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  visibleQuestions,
  allocationTotal,
  formatAnswerForDisplay,
  isAnswered,
  isDateEntryList,
  isDeclined,
  isRosterList,
  SKIP_REASON_PRESETS,
} from '@selfos/core/questionnaires';
import type { AnswerValue, AnswerMap, RosterRow } from '@selfos/core/questionnaires';
import {
  matrixRowKey,
  matrixRowLabel,
  type DeclinedAnswer,
  type Question,
} from '@selfos/core/schemas';
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

/**
 * Wizard mode, "unlocked" (08-questionnaires §25): one question per step, but you move freely (no
 * required-blocks-Next gate), jump via the navigator, and can skip any question with a reason. The form owns
 * navigation + the Review step + the action bar; the host supplies the terminal callbacks (Submit-on-review /
 * Save for later / Decline the whole thing) so the SAME bar works in the in-app Inbox AND the relay page
 * (design-system-free — plain token-CSS buttons). Presence of `wizard` ⇒ wizard mode; absent ⇒ the
 * all-at-once form (Preview, onboarding, self-tests stay unchanged).
 */
export interface WizardActions {
  /** Submit the whole response — fired from the Review step's Send button, which the form gates on every
   * required question being answered OR explicitly skipped (§25.3). The host still re-validates required. */
  onSubmit: () => void;
  /** The Review Send button's label — 'Send answers' by default, or 'Update answers' when editing (56 §3.1). */
  submitLabel?: string;
  /** "Save for later" — omit ⇒ the button is hidden (e.g. an external relay recipient can't resume). */
  onSaveForLater?: () => void;
  /** Decline the WHOLE questionnaire (distinct from a per-question skip) / cancel editing. Omit ⇒ hidden. */
  onDecline?: () => void;
  /** The escape action's label — default 'Decline'; 'Cancel' when editing. */
  declineLabel?: string;
  /** Disable the whole action bar while a host op is in flight. */
  busy?: boolean;
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
  /**
   * Show a progress indicator (08 §20.5): a slim bar (answered / total visible) at the top, plus a
   * "Question N of M" eyebrow on each card (numbered in render order). Default false ⇒ no progress UI (the
   * author's Preview, onboarding, and the self-tests stay plain). The Inbox + relay answering turn it on.
   */
  progress?: boolean;
  /**
   * Read-only render (08 §20.4): every answer control is inert. Used by the author's Preview — the questions
   * are wrapped in a `<fieldset disabled>`, which natively disables every descendant form control (inputs,
   * textareas, selects, AND the custom `<button>` controls) with no per-control threading. The crisis footer
   * stays OUTSIDE the fieldset, so "Get help now" is never disabled (§8.2). Default false ⇒ interactive
   * (the Inbox + relay answer as before).
   */
  disabled?: boolean;
  /**
   * The unlocked one-question-at-a-time wizard (08 §25): navigator + free navigation + per-question skip +
   * a Review step. When set, the form renders it instead of the all-at-once form. See {@link WizardActions}.
   */
  wizard?: WizardActions;
}

const range = (min: number, max: number): number[] => {
  const lo = Math.ceil(Math.min(min, max));
  const hi = Math.floor(Math.max(min, max));
  return Array.from({ length: Math.max(0, hi - lo + 1) }, (_, i) => lo + i);
};

const asNumberMap = (value: AnswerValue | undefined): Record<string, number> =>
  value !== undefined && typeof value === 'object' && !Array.isArray(value) && !isDeclined(value)
    ? value
    : {};

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
      // A row is a plain string (key === label) OR a { key, label } pair (46 §4.2): key the answer by the
      // stable key, display the label.
      const renderRow = (row: (typeof matrix.rows)[number]) => {
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
              {...(pointLabels && matrix.limitLabels ? { limitLabels: matrix.limitLabels } : {})}
            />
          </div>
        );
      };
      // Grouped render (49 §3.1): the intake activity matrix passes category groups, so its long row list
      // reads as full-width category headers above row groups — every group OPEN by default (a plain
      // heading, never a collapsed <details>, so the full surface renders to the bottom — CLAUDE.md §7/§12).
      // Questionnaire matrices pass no groups → the flat render below (byte-identical to the pre-49 output).
      if (matrix.groups && matrix.groups.length > 0) {
        const rowByKey = new Map(matrix.rows.map((row) => [matrixRowKey(row), row]));
        const grouped = new Set<string>();
        return (
          <div className={styles.matrix}>
            {matrix.groups.map((group, groupIndex) => (
              <section key={`${group.label}-${groupIndex}`} className={styles.matrixGroup}>
                <h4 className={styles.matrixGroupHeading}>{group.label}</h4>
                {group.rowKeys.map((key) => {
                  const row = rowByKey.get(key);
                  // Skip an unknown key, or one already rendered by an earlier group (defensive: groups must
                  // partition the rows — a duplicate would otherwise collide React keys).
                  if (!row || grouped.has(key)) return null;
                  grouped.add(key);
                  return renderRow(row);
                })}
              </section>
            ))}
            {/* Any row not covered by a group still renders (never silently dropped) — CLAUDE.md §7. */}
            {matrix.rows.filter((row) => !grouped.has(matrixRowKey(row))).map(renderRow)}
          </div>
        );
      }
      return <div className={styles.matrix}>{matrix.rows.map(renderRow)}</div>;
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
  number,
  total,
}: {
  question: Question;
  value: AnswerValue | undefined;
  onChange: (questionId: string, value: AnswerValue) => void;
  loadImage?: LoadImage;
  /** A pre-rendered per-question sharing control (43) for the header row; omit ⇒ none. */
  sharingControl?: ReactNode;
  /** 1-based position + total for the "Question N of M" eyebrow (08 §20.5); omit ⇒ no eyebrow. */
  number?: number;
  total?: number;
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
      {number !== undefined && total !== undefined ? (
        <span className={styles.qNumber}>
          Question {number} of {total}
        </span>
      ) : null}
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

/** The preset skip reasons (08 §25.2) — the canonical list from core, so the picker and the Results
 *  "unclear" count can't drift. "Not clear — needs more context" (the first) is the unclear flag. */
const SKIP_REASONS = SKIP_REASON_PRESETS;

/** One question's state in the wizard navigator (a chip / list-item). */
type QState = 'answered' | 'skipped' | 'current' | 'open';

/** The reason on a declined answer (empty when none / not a decline). */
const declineReasonOf = (v: AnswerValue | undefined): string =>
  isDeclined(v) && v.reason ? v.reason : '';

/**
 * The one-question-at-a-time wizard, "unlocked" (08-questionnaires §25). You move freely — no
 * required-blocks-Next gate — jump to any question via the navigator (state chips + a "See all questions"
 * overview), and can SKIP any question with an optional reason (a decline value, §25.2). A final Review step
 * gates Send until every required question is answered OR explicitly skipped (§25.3). It's branch-aware (a
 * revealed follow-up joins the visible set) and moves focus to the step heading on each change (§9). Used by
 * the in-app Inbox AND the relay page; the host supplies the terminal callbacks (Submit / Save / Decline).
 */
function WizardForm({
  visible,
  answers,
  onChange,
  loadImage,
  footer,
  actions,
}: {
  visible: Question[];
  answers: AnswerMap;
  onChange: (questionId: string, value: AnswerValue) => void;
  loadImage?: LoadImage;
  footer?: ReactNode;
  actions: WizardActions;
}): JSX.Element {
  const total = visible.length;
  const [step, setStep] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const [skipOpen, setSkipOpen] = useState(false);
  const [reasonSel, setReasonSel] = useState<string | null>(null);
  const [reasonText, setReasonText] = useState('');
  // A declined question the recipient chose to answer instead — show a fresh control (the stored decline
  // stays until they actually answer, so leaving without answering keeps it skipped).
  const [answerInstead, setAnswerInstead] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Clamp the step if the visible set shrank (a branch answer hid a later question). Steps are 0..total-1.
  const current = Math.min(step, Math.max(0, total - 1));
  useEffect(() => {
    if (step !== current) setStep(current);
  }, [step, current]);
  // Move focus to the step heading on every step / phase change so a screen-reader / keyboard user lands on
  // the new content, not back at the top of the page.
  useEffect(() => {
    headingRef.current?.focus();
  }, [current, reviewing]);

  const stateOf = (q: Question): Exclude<QState, 'current'> =>
    isAnswered(q, answers[q.id]) ? 'answered' : isDeclined(answers[q.id]) ? 'skipped' : 'open';
  const answeredCount = visible.filter((q) => stateOf(q) === 'answered').length;
  const skippedCount = visible.filter((q) => stateOf(q) === 'skipped').length;
  const toGo = total - answeredCount - skippedCount;
  // Required questions still needing an answer OR a decline — the review gate (§25.3).
  const outstanding = visible.filter((q) => q.required && stateOf(q) === 'open');
  const question = visible[current];
  const isLast = current >= total - 1;

  const leave = (): void => {
    setSkipOpen(false);
    setAnswerInstead(null);
  };
  const jumpTo = (i: number): void => {
    leave();
    setReviewing(false);
    setStep(i);
  };
  const goNext = (): void => {
    leave();
    if (isLast) setReviewing(true);
    else setStep(current + 1);
  };
  const goBack = (): void => {
    leave();
    setStep(Math.max(0, current - 1));
  };
  const openSkip = (): void => {
    setSkipOpen(true);
    setReasonSel(null);
    setReasonText('');
  };
  const confirmSkip = (): void => {
    if (!question) return;
    const reason = reasonText.trim() || reasonSel || '';
    const decline: DeclinedAnswer = reason ? { declined: true, reason } : { declined: true };
    onChange(question.id, decline);
    setSkipOpen(false);
    setAnswerInstead(null);
  };
  const reviewAnswerText = (q: Question, v: AnswerValue | undefined): string => {
    if (isAnswered(q, v)) return formatAnswerForDisplay(q, v) || '—';
    if (isDeclined(v)) return v.reason ? `Skipped — ${v.reason}` : 'Skipped';
    return q.required ? 'Needs an answer or a reason to send' : 'Left blank (optional)';
  };

  const declineButtons = (
    <>
      {actions.onSaveForLater ? (
        <button
          type="button"
          className={styles.wizardSecondary}
          disabled={actions.busy === true}
          onClick={actions.onSaveForLater}
        >
          Save for later
        </button>
      ) : null}
      {actions.onDecline ? (
        <button
          type="button"
          className={styles.wizardDecline}
          disabled={actions.busy === true}
          onClick={actions.onDecline}
        >
          {actions.declineLabel ?? 'Decline'}
        </button>
      ) : null}
    </>
  );

  const done = answeredCount + skippedCount;

  return (
    <div className={`${styles.form} ${styles.wizard}`}>
      {/* NAVIGATOR (§25.1) — progress + state chips (jump to any) + a "See all questions" overview. */}
      {total > 0 ? (
        <nav className={styles.nav} aria-label="Question navigator">
          <div className={styles.progressWrap}>
            <div
              className={styles.progressTrack}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={done}
              aria-label={`${answeredCount} answered, ${skippedCount} skipped, of ${total} questions`}
            >
              <span
                className={styles.progressBar}
                style={{ width: `${Math.round((done / total) * 100)}%` }}
              />
            </div>
            <span className={styles.progressLabel} aria-hidden="true">
              {reviewing ? 'Review' : `Question ${current + 1} of ${total}`}
            </span>
          </div>

          <div className={styles.dots}>
            {visible.map((q, i) => {
              const st: QState = !reviewing && i === current ? 'current' : stateOf(q);
              const mark = st === 'answered' ? '✓' : st === 'skipped' ? '⊘' : i + 1;
              const showReq = q.required && st !== 'answered' && st !== 'skipped';
              return (
                <button
                  key={q.id}
                  type="button"
                  className={styles.dot}
                  data-state={st}
                  aria-label={`Question ${i + 1}${q.required ? ', required' : ''} — ${st}`}
                  {...(!reviewing && i === current ? { 'aria-current': 'step' as const } : {})}
                  onClick={() => jumpTo(i)}
                >
                  {mark}
                  {showReq ? (
                    <span className={styles.req} aria-hidden="true">
                      *
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            className={styles.allToggle}
            aria-expanded={allOpen}
            onClick={() => setAllOpen((o) => !o)}
          >
            {allOpen ? 'Hide all questions' : 'See all questions'}
          </button>
          {allOpen ? (
            <ol className={styles.allList}>
              {visible.map((q, i) => {
                const st = stateOf(q);
                const mark = st === 'answered' ? '✓' : st === 'skipped' ? '⊘' : i + 1;
                const reason = declineReasonOf(answers[q.id]);
                return (
                  <li key={q.id}>
                    <button
                      type="button"
                      className={styles.allItem}
                      {...(!reviewing && i === current ? { 'data-current': 'true' } : {})}
                      onClick={() => jumpTo(i)}
                    >
                      <span className={styles.allBadge} data-state={st} aria-hidden="true">
                        {mark}
                      </span>
                      <span className={styles.allText}>
                        {q.prompt}
                        {st === 'answered' ? (
                          <span className={`${styles.allSub} ${styles.allDone}`}>Answered</span>
                        ) : st === 'skipped' ? (
                          <span className={`${styles.allSub} ${styles.allSkip}`}>
                            Skipped{reason ? ` — ${reason}` : ''}
                          </span>
                        ) : q.required ? (
                          <span className={styles.allSub}>Required · not yet answered</span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : null}
        </nav>
      ) : null}

      {/* STAGE — the current question, or the review, or the empty state. */}
      <div className={styles.wizardBody}>
        {total === 0 ? (
          <>
            <h3 className={styles.wizardStepTitle} tabIndex={-1} ref={headingRef}>
              No questions yet
            </h3>
            <p className={styles.empty}>Add a question with a prompt to preview it.</p>
          </>
        ) : reviewing ? (
          <div className={styles.review}>
            <h3 className={styles.wizardStepTitle} tabIndex={-1} ref={headingRef}>
              You’re almost done.
            </h3>
            <p className={styles.reviewLede}>
              {outstanding.length > 0 ? (
                <>
                  <strong className={styles.reviewWarn}>
                    {outstanding.length} required question{outstanding.length > 1 ? 's' : ''}
                  </strong>{' '}
                  still {outstanding.length > 1 ? 'need' : 'needs'} an answer or a reason before you
                  can send.
                </>
              ) : (
                'Everything required is answered or has a reason. Send whenever you’re ready.'
              )}
            </p>
            <ol className={styles.rlist}>
              {visible.map((q, i) => {
                const st = isAnswered(q, answers[q.id])
                  ? 'answered'
                  : isDeclined(answers[q.id])
                    ? 'skipped'
                    : q.required
                      ? 'missing'
                      : 'open';
                const mark = st === 'answered' ? '✓' : st === 'skipped' ? '⊘' : i + 1;
                return (
                  <li key={q.id} className={styles.rrow}>
                    <span className={styles.rBadge} data-state={st} aria-hidden="true">
                      {mark}
                    </span>
                    <div className={styles.rq}>
                      <p className={styles.rPrompt}>{q.prompt}</p>
                      <p className={styles.rAnswer} data-state={st}>
                        {reviewAnswerText(q, answers[q.id])}
                      </p>
                    </div>
                    <button type="button" className={styles.rEdit} onClick={() => jumpTo(i)}>
                      Edit
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        ) : (
          <div className={styles.qStage}>
            {/* The count lives next to the progress bar; the eyebrow just tags whether it's required. */}
            <span className={styles.qNumber}>{question?.required ? 'Required' : 'Optional'}</span>
            <h3 className={styles.wizardStepTitle} tabIndex={-1} ref={headingRef}>
              {question?.prompt ?? ''}
            </h3>
            {question ? (
              isDeclined(answers[question.id]) && answerInstead !== question.id ? (
                <div className={styles.skippedNote}>
                  <span aria-hidden="true">⊘</span>
                  <span>
                    <strong>Skipped.</strong>
                    {declineReasonOf(answers[question.id])
                      ? ` Reason: ${declineReasonOf(answers[question.id])}`
                      : ' No reason given.'}
                  </span>
                  <button
                    type="button"
                    className={styles.undoSkip}
                    onClick={() => setAnswerInstead(question.id)}
                  >
                    Answer it instead
                  </button>
                </div>
              ) : (
                <>
                  {question.help ? <p className={styles.help}>{question.help}</p> : null}
                  {question.media && loadImage ? (
                    <QuestionImage media={question.media} loadImage={loadImage} />
                  ) : null}
                  <Control
                    question={question}
                    value={answerInstead === question.id ? undefined : answers[question.id]}
                    set={(v) => onChange(question.id, v)}
                  />
                  <div className={styles.skipRow}>
                    {skipOpen ? (
                      <div className={styles.reason}>
                        <h4 className={styles.reasonHead}>
                          What’s making this one hard to answer?
                        </h4>
                        <p className={styles.reasonHint}>
                          Optional — “Not clear” tells the sender (and the app) to fix it.
                        </p>
                        <div className={styles.chips}>
                          {SKIP_REASONS.map((r) => (
                            <button
                              key={r}
                              type="button"
                              className={styles.chip}
                              aria-pressed={reasonSel === r}
                              onClick={() => setReasonSel((s) => (s === r ? null : r))}
                            >
                              {r}
                            </button>
                          ))}
                        </div>
                        <textarea
                          className={styles.reasonText}
                          placeholder="Or say it in your own words (optional)…"
                          value={reasonText}
                          onChange={(e) => setReasonText(e.target.value)}
                          aria-label="Reason for skipping (optional)"
                        />
                        <div className={styles.reasonActions}>
                          <button
                            type="button"
                            className={styles.wizardPrimary}
                            onClick={confirmSkip}
                          >
                            Skip this question
                          </button>
                          <button
                            type="button"
                            className={styles.wizardGhost}
                            onClick={() => setSkipOpen(false)}
                          >
                            Never mind
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button type="button" className={styles.skipBtn} onClick={openSkip}>
                        Skip this — I can’t or don’t want to answer
                      </button>
                    )}
                  </div>
                </>
              )
            ) : null}
          </div>
        )}
      </div>

      {/* Live summary — answered / skipped / to-go. */}
      {total > 0 ? (
        <div className={styles.summary} aria-live="polite">
          <span className={styles.sDone}>
            <strong>{answeredCount}</strong> answered
          </span>
          <span className={styles.sSkip}>
            <strong>{skippedCount}</strong> skipped
          </span>
          <span>
            <strong>{toGo}</strong> to go
          </span>
        </div>
      ) : null}

      {/* Action bar. DOM order == visual order == tab order (WCAG 2.4.3). */}
      <div className={styles.wizardActions}>
        {reviewing ? (
          <>
            <button
              type="button"
              className={styles.wizardBack}
              disabled={actions.busy === true}
              onClick={() => setReviewing(false)}
            >
              Keep editing
            </button>
            {declineButtons}
            <button
              type="button"
              className={styles.wizardPrimary}
              disabled={actions.busy === true || outstanding.length > 0}
              onClick={actions.onSubmit}
            >
              {actions.submitLabel ?? 'Send answers'}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={styles.wizardBack}
              disabled={current === 0 || actions.busy === true}
              onClick={goBack}
            >
              Back
            </button>
            {declineButtons}
            <button
              type="button"
              className={styles.wizardPrimary}
              disabled={actions.busy === true}
              onClick={goNext}
            >
              {isLast ? 'Review & send' : 'Next'}
            </button>
          </>
        )}
      </div>

      {footer ?? <CrisisFooter />}
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
  progress,
  disabled,
  wizard,
}: QuestionnaireFormProps): JSX.Element {
  const visible = visibleQuestions(questions, answers);

  // Wizard mode (08 §21.3): one question per step. Rendered as its own branch — it ignores grouping (a
  // wizard steps over the flat visible set) and owns the action bar. Everything else (the all-at-once form)
  // stays exactly as before.
  if (wizard) {
    return (
      <WizardForm
        visible={visible}
        answers={answers}
        onChange={onChange}
        {...(loadImage ? { loadImage } : {})}
        {...(footer !== undefined ? { footer } : {})}
        actions={wizard}
      />
    );
  }

  // Long forms can group questions under collapsible headings (18 §14.3). Ungrouped questions render first;
  // grouped ones follow as <details> in first-seen group order. Every group is **open by default** — the
  // accordion is for optional tidying, never for hiding questions (a collapsed group would silently swallow
  // inputs at the bottom of a section, so a person never sees them). They stay user-collapsible.
  const ungrouped = visible.filter((q) => !q.group);
  const groupOrder: string[] = [];
  for (const q of visible) if (q.group && !groupOrder.includes(q.group)) groupOrder.push(q.group);

  // Progress (08 §20.5): number each question 1..M in RENDER order (ungrouped first, then each group), so
  // "Question N of M" matches what the person sees even when a form is grouped. Answered count drives the bar.
  const renderOrder = progress
    ? [...ungrouped, ...groupOrder.flatMap((g) => visible.filter((q) => q.group === g))]
    : [];
  const numberOf = new Map(renderOrder.map((q, i) => [q.id, i + 1]));
  const total = visible.length;
  const answeredCount = progress ? visible.filter((q) => isAnswered(q, answers[q.id])).length : 0;

  const field = (question: Question): JSX.Element => {
    const number = progress ? numberOf.get(question.id) : undefined;
    return (
      <QuestionField
        key={question.id}
        question={question}
        value={answers[question.id]}
        onChange={onChange}
        {...(loadImage ? { loadImage } : {})}
        {...(sharing ? { sharingControl: sharing.renderControl(question.id) } : {})}
        {...(number !== undefined ? { number, total } : {})}
      />
    );
  };

  const questionsBody =
    visible.length === 0 ? (
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
    );

  return (
    <div className={styles.form}>
      {/* Progress (08 §20.5): a slim bar + a text count, shown only when the host opts in and there are
          questions. `role="progressbar"` carries the numeric state; the visible label is the text equivalent. */}
      {progress && total > 0 ? (
        <div className={styles.progressWrap}>
          <div
            className={styles.progressTrack}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={answeredCount}
            aria-label={`${answeredCount} of ${total} questions answered`}
          >
            <span
              className={styles.progressBar}
              style={{ width: `${Math.round((answeredCount / total) * 100)}%` }}
            />
          </div>
          {/* The progressbar's aria-label already announces the count; hide the visible text from the SR
              so it isn't read twice (the label is the visual equivalent, §9). */}
          <span className={styles.progressLabel} aria-hidden="true">
            {answeredCount} of {total} answered
          </span>
        </div>
      ) : null}
      {/* Read-only Preview (08 §20.4): a disabled <fieldset> makes every descendant control inert with no
          per-control wiring. The crisis footer stays OUTSIDE it, so "Get help now" always works (§8.2). */}
      {disabled ? (
        <fieldset className={styles.fieldset} disabled>
          {questionsBody}
        </fieldset>
      ) : (
        questionsBody
      )}
      {footer ?? <CrisisFooter />}
    </div>
  );
}

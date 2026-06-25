import {
  matrixRowKey,
  matrixRowLabel,
  type Answer,
  type Question,
  type SendAnswer,
} from '../schemas';
import { MAX_RESPONSE_BYTES } from '../relay/relayLimits';

/**
 * Pure answering logic shared by every host that renders a questionnaire to be answered — preview /
 * test-on-self now, the in-app Inbox and the relay page later (08-questionnaires §5.3). Kept in core
 * (no DOM) so the one implementation is reused and unit-tested without a renderer.
 *
 * `matrix` and `allocation` answers are a per-key number map (row → rating, bucket → amount); every
 * other type is a primitive or a string list. Branch triggers are usually `singleChoice`/`yesNo` (a
 * string/boolean), but a `multiChoice` trigger is also supported: its answer is an array, and the branch
 * matches when the array *includes* the branch value (e.g. show a per-substance frequency only when that
 * substance is selected).
 */
/** One entry of a `dateList` answer (a labeled date, e.g. an anniversary). */
export type DateEntryValue = { label: string; date: string };
/** One row of a `roster` answer — a record of column-key → value (e.g. {name, gender, age}). */
export type RosterRow = Record<string, string>;
export type AnswerValue =
  | string
  | number
  | boolean
  | string[]
  | Record<string, number>
  | DateEntryValue[]
  | RosterRow[];
export type AnswerMap = Record<string, AnswerValue>;

/** Whether a value is a `dateList` answer (an array of {label, date} entries, not a string list). */
export function isDateEntryList(value: AnswerValue | undefined): value is DateEntryValue[] {
  return (
    Array.isArray(value) &&
    value.every((e) => e !== null && typeof e === 'object' && 'label' in e && 'date' in e)
  );
}

/** Whether a value is a `roster` answer — an array of string-keyed string records (rows). Checked AFTER
 * `isDateEntryList` (a dateList row is also a string record, so test the more specific guard first). */
export function isRosterList(value: AnswerValue | undefined): value is RosterRow[] {
  return (
    Array.isArray(value) &&
    value.every(
      (r) =>
        r !== null &&
        typeof r === 'object' &&
        !Array.isArray(r) &&
        Object.values(r).every((v) => typeof v === 'string'),
    )
  );
}

/** Whether a question is shown given current answers — a branch hides it until its trigger matches. */
export function isQuestionVisible(question: Question, answers: AnswerMap): boolean {
  if (!question.branch) return true;
  const answer = answers[question.branch.whenQuestionId];
  // A multiChoice trigger answers with an array → match when it CONTAINS any expected value.
  if (Array.isArray(answer)) {
    if (question.branch.equalsAny)
      return question.branch.equalsAny.some((v) => answer.includes(v as never));
    return question.branch.equals !== undefined && answer.includes(question.branch.equals as never);
  }
  if (question.branch.equalsAny) return question.branch.equalsAny.includes(answer as never);
  return answer === question.branch.equals;
}

/** The questions currently shown, in order (branch-hidden ones removed). */
export function visibleQuestions(questions: Question[], answers: AnswerMap): Question[] {
  return questions.filter((q) => isQuestionVisible(q, answers));
}

/** The running total of an allocation answer (buckets distributing toward 100). */
export function allocationTotal(value: AnswerValue | undefined): number {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return Object.values(value).reduce((sum, n) => sum + (Number.isFinite(n) ? n : 0), 0);
  }
  return 0;
}

/**
 * A relay submission is sealed (ECDH + AES-GCM) and base64-encoded before upload, which expands the JSON
 * plaintext by ~4/3 and adds an envelope + ephemeral key. The relay rejects a sealed body over
 * `MAX_RESPONSE_BYTES` (08 §11.3); this estimates the SEALED size from the plaintext so a too-long response
 * is caught BEFORE encrypt/upload with a clear recipient-facing message (38 §3.9), rather than an opaque
 * relay rejection. Sharing `MAX_RESPONSE_BYTES` keeps the client cap from drifting from the server's.
 */
const SEAL_OVERHEAD_BYTES = 512; // envelope JSON fields + base64 ephemeral key + IV/tag headroom.

export interface ResponseSizeCheck {
  ok: boolean;
  estimatedBytes: number;
  maxBytes: number;
}

/** Estimate the SEALED byte size of a relay response payload from its serialized plaintext. */
export function estimateSealedResponseBytes(payload: unknown): number {
  const plaintext = new TextEncoder().encode(JSON.stringify(payload)).length;
  return Math.ceil((plaintext * 4) / 3) + SEAL_OVERHEAD_BYTES;
}

/** Whether a relay response payload will fit the relay's size cap once sealed (38 §3.9). */
export function responseSizeGuard(payload: unknown): ResponseSizeCheck {
  const estimatedBytes = estimateSealedResponseBytes(payload);
  return { ok: estimatedBytes <= MAX_RESPONSE_BYTES, estimatedBytes, maxBytes: MAX_RESPONSE_BYTES };
}

/** Whether a question has a usable answer for its type (an allocation must total exactly 100). */
export function isAnswered(question: Question, value: AnswerValue | undefined): boolean {
  if (value === undefined) return false;
  switch (question.type) {
    case 'shortText':
    case 'longText':
    case 'singleChoice':
    case 'thisOrThat':
    case 'date':
      return typeof value === 'string' && value.trim() !== '';
    case 'rating':
    case 'slider':
      return typeof value === 'number' && Number.isFinite(value);
    case 'yesNo':
      return typeof value === 'boolean';
    case 'multiChoice':
    case 'ranking':
      return Array.isArray(value) && value.length > 0;
    case 'dateList':
      return (
        isDateEntryList(value) && value.some((e) => e.label.trim() !== '' && e.date.trim() !== '')
      );
    case 'roster': {
      // Answered when ≥1 row has its FIRST column (the name) filled. The first column key is authored.
      if (!isRosterList(value)) return false;
      const firstKey = question.roster?.[0]?.key;
      return value.some((row) =>
        firstKey
          ? (row[firstKey]?.trim() ?? '') !== ''
          : Object.values(row).some((v) => v.trim() !== ''),
      );
    }
    case 'matrix': {
      const rows = question.matrix?.rows ?? [];
      if (
        rows.length === 0 ||
        value === null ||
        typeof value !== 'object' ||
        Array.isArray(value)
      ) {
        return false;
      }
      return rows.every((row) => typeof value[matrixRowKey(row)] === 'number');
    }
    case 'allocation':
      return allocationTotal(value) === 100;
    default:
      return false;
  }
}

/** Visible, required questions that don't yet have a usable answer (gates a test-on-self "Finish"). */
export function unansweredRequired(questions: Question[], answers: AnswerMap): Question[] {
  return visibleQuestions(questions, answers).filter(
    (q) => q.required && !isAnswered(q, answers[q.id]),
  );
}

/**
 * Render one answer as read-only display text for the sender's Results view (Standard sends only). Pure +
 * DOM-free so it's reused/tested in core; the renderer just prints the string. Returns '' for an empty
 * answer so callers can show a "—" placeholder.
 */
export function formatAnswerForDisplay(question: Question, value: AnswerValue | undefined): string {
  if (value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'string') return value.trim();
  // roster: rows of configurable columns → "Emma, Girl, 7; Liam, Boy, 4" (values in authored column order).
  if (question.type === 'roster' && isRosterList(value)) {
    const cols = question.roster ?? [];
    return value
      .map((row: RosterRow) =>
        cols
          .map((c) => row[c.key]?.trim())
          .filter(Boolean)
          .join(', '),
      )
      .filter((s) => s !== '')
      .join('; ');
  }
  // dateList: labeled dates → "Anniversary: 2014-06-21, …" (kept in entry order).
  if (isDateEntryList(value)) {
    return value
      .filter((e) => e.label.trim() && e.date.trim())
      .map((e) => `${e.label.trim()}: ${e.date.trim()}`)
      .join(', ');
  }
  if (Array.isArray(value)) {
    // ranking carries an ordered list → number it; multiChoice is an unordered set → comma-join.
    return question.type === 'ranking'
      ? value.map((v, i) => `${i + 1}. ${v}`).join(', ')
      : value.join(', ');
  }
  // matrix (rows → rating) / allocation (option → amount): print in the authored order. A matrix row may be a
  // { key, label } pair (46 §4.2) — look up by stable key, display the label.
  if (question.type === 'matrix') {
    return (question.matrix?.rows ?? [])
      .filter((r) => value[matrixRowKey(r)] !== undefined)
      .map((r) => `${matrixRowLabel(r)}: ${value[matrixRowKey(r)]}`)
      .join(', ');
  }
  return (question.options ?? [])
    .filter((k) => value[k] !== undefined)
    .map((k) => `${k}: ${value[k]}`)
    .join(', ');
}

/**
 * Format a whole response into display rows (prompt + formatted answer) for the surfaces that show raw
 * answers to a permitted reader — the sender's Standard Results, the break-glass reveal, and the
 * `eachSeesOwn` answerer's own answers (§3.6/§3.7/§8.4). One row per snapshot question, in authored order.
 */
export function formatResponseAnswers(questions: Question[], answers: Answer[]): SendAnswer[] {
  const byId = new Map(answers.map((a) => [a.questionId, a.value]));
  return questions.map((q) => ({
    prompt: q.prompt,
    answer: formatAnswerForDisplay(q, byId.get(q.id) as AnswerValue | undefined),
  }));
}

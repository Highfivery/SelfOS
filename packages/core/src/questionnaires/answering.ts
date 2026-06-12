import type { Answer, Question, SendAnswer } from '../schemas';

/**
 * Pure answering logic shared by every host that renders a questionnaire to be answered — preview /
 * test-on-self now, the in-app Inbox and the relay page later (08-questionnaires §5.3). Kept in core
 * (no DOM) so the one implementation is reused and unit-tested without a renderer.
 *
 * `matrix` and `allocation` answers are a per-key number map (row → rating, bucket → amount); every
 * other type is a primitive or a string list. Branch triggers are only `singleChoice`/`yesNo`, so a
 * branch only ever compares against a string or boolean.
 */
export type AnswerValue = string | number | boolean | string[] | Record<string, number>;
export type AnswerMap = Record<string, AnswerValue>;

/** Whether a question is shown given current answers — a branch hides it until its trigger matches. */
export function isQuestionVisible(question: Question, answers: AnswerMap): boolean {
  if (!question.branch) return true;
  return answers[question.branch.whenQuestionId] === question.branch.equals;
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
      return rows.every((row) => typeof value[row] === 'number');
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
  if (Array.isArray(value)) {
    // ranking carries an ordered list → number it; multiChoice is an unordered set → comma-join.
    return question.type === 'ranking'
      ? value.map((v, i) => `${i + 1}. ${v}`).join(', ')
      : value.join(', ');
  }
  // matrix (rows → rating) / allocation (option → amount): print in the authored order.
  const keys =
    question.type === 'matrix' ? (question.matrix?.rows ?? []) : (question.options ?? []);
  return keys
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

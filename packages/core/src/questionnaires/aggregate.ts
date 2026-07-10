import {
  matrixRowKey,
  matrixRowLabel,
  type Answer,
  type AnswerType,
  type PrivacyMode,
  type Question,
  type QuestionAggregate,
  type QuestionnaireAggregate,
} from '../schemas';

/**
 * The cross-recipient "At a glance" aggregate (08-questionnaires §20.7). Pure + DOM-free so it's reused/
 * tested in core; the bridge gathers a questionnaire's submitted sends (decrypting the answers it's allowed
 * to) and the renderer draws distributions/averages. **Privacy rule (§8.4):** categorical distributions
 * count **Standard** sends only (a Private recipient's selection is raw content); numeric averages fold in
 * **both** Standard and Private (numbers already reach the sender's trends, §13.5c); free-text/date/ranking
 * are a bare response count. It never emits a written answer.
 */

const NUMERIC: ReadonlySet<AnswerType> = new Set(['rating', 'slider']);
const NUMERIC_ROWS: ReadonlySet<AnswerType> = new Set(['matrix', 'allocation']);
const CATEGORICAL: ReadonlySet<AnswerType> = new Set([
  'singleChoice',
  'multiChoice',
  'thisOrThat',
  'yesNo',
]);

export interface AggregateSend {
  privacy: PrivacyMode;
  questions: Question[]; // the send's frozen snapshot
  answers: Answer[];
}

/** The keys+labels (rows/buckets) a matrix/allocation question carries, in authored order. */
function objectKeys(question: Question): { key: string; label: string }[] {
  if (question.type === 'matrix') {
    return (question.matrix?.rows ?? []).map((r) => ({
      key: matrixRowKey(r),
      label: matrixRowLabel(r),
    }));
  }
  return (question.options ?? []).map((o) => ({ key: o, label: o }));
}

/** The option labels a categorical question offers (for a stable, zero-inclusive distribution). yes/no has
 * fixed options; the rest read their authored `options`. */
function categoricalOptions(question: Question): string[] {
  if (question.type === 'yesNo') return ['Yes', 'No'];
  return question.options ?? [];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const mean = (xs: number[]): number =>
  xs.length === 0 ? 0 : round2(xs.reduce((a, b) => a + b, 0) / xs.length);

export function buildQuestionnaireAggregate(sends: AggregateSend[]): QuestionnaireAggregate {
  // Private sends are EXCLUDED from the aggregate entirely (08 §21.5): a private recipient's answers — words
  // AND numbers — are never shown, so they contribute nothing to any distribution/average/count. The "At a
  // glance" view is Standard sends only.
  const standardSends = sends.filter((s) => s.privacy === 'standard');

  // Representative question per id (first seen), preserving first-seen order across snapshots.
  const order: string[] = [];
  const repr = new Map<string, Question>();
  for (const send of standardSends) {
    for (const q of send.questions) {
      if (!repr.has(q.id)) {
        repr.set(q.id, q);
        order.push(q.id);
      }
    }
  }

  const out: QuestionAggregate[] = [];
  for (const questionId of order) {
    const question = repr.get(questionId);
    if (!question) continue;

    const answerOf = (s: AggregateSend): Answer['value'] | undefined =>
      s.answers.find((a) => a.questionId === questionId)?.value;
    // Standard sends that answered this question — the response count (private sends are already excluded).
    const responseCount = standardSends.filter((s) => answerOf(s) !== undefined).length;
    if (responseCount === 0) continue; // nothing answered → not in the at-a-glance

    const base = { questionId, prompt: question.prompt, responseCount };

    if (NUMERIC.has(question.type)) {
      // rating / slider — a single numeric value.
      const values: number[] = [];
      for (const s of standardSends) {
        const v = answerOf(s);
        if (typeof v === 'number' && Number.isFinite(v)) values.push(v);
      }
      if (values.length === 0) {
        out.push({ ...base, kind: 'count' });
        continue;
      }
      // The bar is positioned against the question's DECLARED scale (so 3.5 reads correctly on a 1–5), not
      // the observed value range — matching the SliderControl defaults (rating 1–5, slider 0–10).
      const scale =
        question.scale ?? (question.type === 'rating' ? { min: 1, max: 5 } : { min: 0, max: 10 });
      out.push({ ...base, kind: 'average', average: mean(values), min: scale.min, max: scale.max });
    } else if (NUMERIC_ROWS.has(question.type)) {
      // matrix / allocation — a per-row/bucket numeric map.
      const rows = objectKeys(question).map(({ key, label }) => {
        const values: number[] = [];
        for (const s of standardSends) {
          const v = answerOf(s);
          if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
            const n = (v as Record<string, number>)[key];
            if (typeof n === 'number' && Number.isFinite(n)) values.push(n);
          }
        }
        return { label, average: mean(values) };
      });
      if (question.type === 'matrix') {
        const min = question.matrix?.min ?? 1;
        const max = question.matrix?.max ?? 5;
        out.push({ ...base, kind: 'rows', rows, min, max });
      } else {
        out.push({ ...base, kind: 'allocation', rows });
      }
    } else if (CATEGORICAL.has(question.type)) {
      // choice / yes-no / this-or-that — a distribution over the Standard sends.
      const counts = new Map<string, number>(categoricalOptions(question).map((o) => [o, 0]));
      const bump = (label: string): void => {
        counts.set(label, (counts.get(label) ?? 0) + 1);
      };
      for (const s of standardSends) {
        const v = answerOf(s);
        if (v === undefined) continue;
        if (question.type === 'yesNo') {
          if (v === true) bump('Yes');
          else if (v === false) bump('No');
        } else if (typeof v === 'string') {
          bump(v);
        } else if (Array.isArray(v)) {
          for (const item of v) if (typeof item === 'string') bump(item);
        }
      }
      out.push({
        ...base,
        kind: 'distribution',
        options: [...counts].map(([label, count]) => ({ label, count })),
      });
    } else {
      // free-text / date / ranking — just the response count, never the content.
      out.push({ ...base, kind: 'count' });
    }
  }
  return { questions: out };
}

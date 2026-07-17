import {
  matrixRowKey,
  matrixRowLabel,
  type AnswerType,
  type Answer,
  type Question,
  type QuestionTrend,
  type TrendPoint,
  type TrendSeries,
} from '../schemas';
import { isDeclined } from './answering';

/**
 * Per-question rating-over-time trends (08-questionnaires §3.7). Pure + DOM-free so it's reused/tested in
 * core; the bridge gathers a questionnaire's submitted sends and the renderer charts the result. Aligns
 * numeric answers across re-asks by question id; one series per recipient (and, for matrix/allocation,
 * per row/bucket). A question appears only when some series has ≥2 points (i.e. a real re-ask happened).
 */

const TRENDABLE: ReadonlySet<AnswerType> = new Set(['rating', 'slider', 'matrix', 'allocation']);

export interface TrendSend {
  submittedAt: string;
  recipientName: string;
  questions: Question[]; // the send's frozen snapshot
  answers: Answer[];
}

/** The keys+labels (rows/buckets) a matrix/allocation question carries, in authored order. A matrix row may
 * be a { key, label } pair (46 §4.2) — look up the value by stable key, label the series with the label. */
function objectKeys(question: Question): { key: string; label: string }[] {
  if (question.type === 'matrix') {
    return (question.matrix?.rows ?? []).map((r) => ({
      key: matrixRowKey(r),
      label: matrixRowLabel(r),
    }));
  }
  return (question.options ?? []).map((o) => ({ key: o, label: o }));
}

export function buildQuestionTrends(sends: TrendSend[]): QuestionTrend[] {
  // Representative question per id (first seen), preserving first-seen order across snapshots.
  const order: string[] = [];
  const repr = new Map<string, Question>();
  for (const send of sends) {
    for (const q of send.questions) {
      if (!repr.has(q.id)) {
        repr.set(q.id, q);
        order.push(q.id);
      }
    }
  }

  const trends: QuestionTrend[] = [];
  for (const questionId of order) {
    const question = repr.get(questionId);
    if (!question || !TRENDABLE.has(question.type)) continue;

    const byLabel = new Map<string, TrendPoint[]>();
    const add = (label: string, at: string, value: number): void => {
      const points = byLabel.get(label) ?? [];
      points.push({ at, value });
      byLabel.set(label, points);
    };

    for (const send of sends) {
      const answer = send.answers.find((a) => a.questionId === questionId);
      if (!answer) continue;
      const value = answer.value;
      if (isDeclined(value)) continue; // a skipped question contributes no trend point (§25.5)
      if (question.type === 'rating' || question.type === 'slider') {
        if (typeof value === 'number' && Number.isFinite(value)) {
          add(send.recipientName, send.submittedAt, value);
        }
      } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        for (const { key, label } of objectKeys(question)) {
          const n = value[key];
          if (typeof n === 'number' && Number.isFinite(n)) {
            add(`${send.recipientName} · ${label}`, send.submittedAt, n);
          }
        }
      }
    }

    const series: TrendSeries[] = [];
    for (const [label, points] of byLabel) {
      points.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
      if (points.length >= 2) series.push({ label, points }); // a trend needs ≥2 re-asks
    }
    if (series.length > 0) trends.push({ questionId, prompt: question.prompt, series });
  }
  return trends;
}

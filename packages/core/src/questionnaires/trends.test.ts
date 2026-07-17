import { describe, expect, it } from 'vitest';
import type { Question } from '../schemas';
import { buildQuestionTrends, type TrendSend } from './trends';

const q = (over: Partial<Question> & Pick<Question, 'id' | 'type'>): Question => ({
  prompt: over.prompt ?? over.id,
  required: false,
  ...over,
});

describe('buildQuestionTrends', () => {
  it('builds a per-recipient rating series across re-asks (≥2 points)', () => {
    const questions = [q({ id: 'r', type: 'rating', prompt: 'Connection?' })];
    const sends: TrendSend[] = [
      {
        submittedAt: '2026-01-01',
        recipientName: 'Mara',
        questions,
        answers: [{ questionId: 'r', value: 3 }],
      },
      {
        submittedAt: '2026-02-01',
        recipientName: 'Mara',
        questions,
        answers: [{ questionId: 'r', value: 5 }],
      },
    ];
    const trends = buildQuestionTrends(sends);
    expect(trends).toHaveLength(1);
    expect(trends[0]?.prompt).toBe('Connection?');
    expect(trends[0]?.series).toHaveLength(1);
    expect(trends[0]?.series[0]?.label).toBe('Mara');
    expect(trends[0]?.series[0]?.points.map((p) => p.value)).toEqual([3, 5]);
  });

  it('orders points by time regardless of send order', () => {
    const questions = [q({ id: 'r', type: 'slider' })];
    const sends: TrendSend[] = [
      {
        submittedAt: '2026-03-01',
        recipientName: 'Mara',
        questions,
        answers: [{ questionId: 'r', value: 7 }],
      },
      {
        submittedAt: '2026-01-01',
        recipientName: 'Mara',
        questions,
        answers: [{ questionId: 'r', value: 2 }],
      },
    ];
    expect(buildQuestionTrends(sends)[0]?.series[0]?.points.map((p) => p.at)).toEqual([
      '2026-01-01',
      '2026-03-01',
    ]);
  });

  it('omits a question with fewer than two points in every series', () => {
    const questions = [q({ id: 'r', type: 'rating' })];
    const sends: TrendSend[] = [
      {
        submittedAt: '2026-01-01',
        recipientName: 'Mara',
        questions,
        answers: [{ questionId: 'r', value: 3 }],
      },
      {
        submittedAt: '2026-02-01',
        recipientName: 'Sam',
        questions,
        answers: [{ questionId: 'r', value: 4 }],
      },
    ];
    // One point per recipient → no trend yet.
    expect(buildQuestionTrends(sends)).toEqual([]);
  });

  it('splits matrix rows and allocation buckets into their own series', () => {
    const matrix = q({
      id: 'm',
      type: 'matrix',
      prompt: 'Rate areas',
      matrix: { rows: ['Trust', 'Fun'], min: 1, max: 5 },
    });
    const sends: TrendSend[] = [
      {
        submittedAt: '2026-01-01',
        recipientName: 'Mara',
        questions: [matrix],
        answers: [{ questionId: 'm', value: { Trust: 3, Fun: 4 } }],
      },
      {
        submittedAt: '2026-02-01',
        recipientName: 'Mara',
        questions: [matrix],
        answers: [{ questionId: 'm', value: { Trust: 5, Fun: 2 } }],
      },
    ];
    const series = buildQuestionTrends(sends)[0]?.series ?? [];
    expect(series.map((s) => s.label).sort()).toEqual(['Mara · Fun', 'Mara · Trust']);
    expect(series.find((s) => s.label === 'Mara · Trust')?.points.map((p) => p.value)).toEqual([
      3, 5,
    ]);
  });

  it('non-numeric questions never trend', () => {
    const questions = [q({ id: 't', type: 'shortText' })];
    const sends: TrendSend[] = [
      {
        submittedAt: '2026-01-01',
        recipientName: 'Mara',
        questions,
        answers: [{ questionId: 't', value: 'hi' }],
      },
      {
        submittedAt: '2026-02-01',
        recipientName: 'Mara',
        questions,
        answers: [{ questionId: 't', value: 'yo' }],
      },
    ];
    expect(buildQuestionTrends(sends)).toEqual([]);
  });

  it('a declined answer contributes no trend point (§25.5)', () => {
    const questions = [q({ id: 'r', type: 'rating', prompt: 'Connection?' })];
    const sends: TrendSend[] = [
      {
        submittedAt: '2026-01-01',
        recipientName: 'Mara',
        questions,
        answers: [{ questionId: 'r', value: 3 }],
      },
      {
        submittedAt: '2026-02-01',
        recipientName: 'Mara',
        questions,
        answers: [{ questionId: 'r', value: { declined: true, reason: 'Prefer not to say' } }],
      },
    ];
    // Only ONE real point remains, so there's no ≥2-point series — the decline never became a 0/NaN point.
    expect(buildQuestionTrends(sends)).toEqual([]);
  });
});

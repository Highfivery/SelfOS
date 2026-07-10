import { describe, expect, it } from 'vitest';
import {
  buildQuestionnaireAggregate,
  extractNumericAnswers,
  type AggregateSend,
} from './aggregate';
import type { Answer, PrivacyMode, Question } from '../schemas';

const q = (over: Partial<Question> & Pick<Question, 'id' | 'type' | 'prompt'>): Question => ({
  required: false,
  ...over,
});

const send = (privacy: PrivacyMode, questions: Question[], answers: Answer[]): AggregateSend => ({
  privacy,
  questions,
  answers,
});

describe('buildQuestionnaireAggregate (08 §20.7)', () => {
  it('distributes a choice question — counting STANDARD sends only (privacy §8.4)', () => {
    const question = q({ id: 'c', type: 'singleChoice', prompt: 'Pick', options: ['A', 'B'] });
    const agg = buildQuestionnaireAggregate([
      send('standard', [question], [{ questionId: 'c', value: 'A' }]),
      send('standard', [question], [{ questionId: 'c', value: 'B' }]),
      // A PRIVATE send answered too — its choice is raw content, so it MUST NOT appear in the distribution,
      // but it DOES count toward responseCount.
      send('private', [question], [{ questionId: 'c', value: 'A' }]),
    ]);
    const a = agg.questions[0];
    expect(a?.kind).toBe('distribution');
    expect(a?.responseCount).toBe(3);
    if (a?.kind === 'distribution') {
      expect(a.options).toEqual([
        { label: 'A', count: 1 }, // only the ONE standard 'A' — the private 'A' is excluded
        { label: 'B', count: 1 },
      ]);
      // 2 standard respondents; responseCount − standardCount = 1 answered privately (not shown).
      expect(a.standardCount).toBe(2);
    }
  });

  it('multiChoice: standardCount counts DISTINCT standard respondents, not summed selections (private count is right)', () => {
    const question = q({
      id: 'm',
      type: 'multiChoice',
      prompt: 'Which?',
      options: ['A', 'B', 'C'],
    });
    const agg = buildQuestionnaireAggregate([
      // Two STANDARD sends each pick MULTIPLE options (4 selections, but 2 respondents).
      send('standard', [question], [{ questionId: 'm', value: ['A', 'B'] }]),
      send('standard', [question], [{ questionId: 'm', value: ['A', 'C'] }]),
      // Three PRIVATE sends answered — counted, never shown.
      send('private', [question], [{ questionId: 'm', value: ['B'] }]),
      send('private', [question], [{ questionId: 'm', value: ['A'] }]),
      send('private', [question], [{ questionId: 'm', value: ['C'] }]),
    ]);
    const a = agg.questions[0];
    if (a?.kind === 'distribution') {
      expect(a.responseCount).toBe(5); // everyone answered
      expect(a.standardCount).toBe(2); // TWO standard respondents (not 4 summed selections)
      // So "answered privately" = 5 − 2 = 3 (correct), not 5 − 4 = 1 (the summed-selections bug).
      expect(a.responseCount - a.standardCount).toBe(3);
      // Distribution counts standard selections only: A×2, B×1, C×1.
      expect(a.options).toEqual([
        { label: 'A', count: 2 },
        { label: 'B', count: 1 },
        { label: 'C', count: 1 },
      ]);
    }
  });

  it('averages a numeric question — folding in BOTH Standard and Private (numbers are allowed)', () => {
    const question = q({ id: 'r', type: 'rating', prompt: 'How?', scale: { min: 1, max: 5 } });
    const agg = buildQuestionnaireAggregate([
      send('standard', [question], [{ questionId: 'r', value: 4 }]),
      send('private', [question], [{ questionId: 'r', value: 2 }]),
    ]);
    const a = agg.questions[0];
    expect(a?.kind).toBe('average');
    if (a?.kind === 'average') {
      expect(a.average).toBe(3); // (4 + 2) / 2 — the private numeric value contributes
      // min/max are the DECLARED scale bounds (1–5), so the bar positions correctly — not the value range.
      expect(a.min).toBe(1);
      expect(a.max).toBe(5);
    }
  });

  it('yes/no distributes with fixed Yes/No options (standard-only)', () => {
    const question = q({ id: 'y', type: 'yesNo', prompt: 'Agree?' });
    const agg = buildQuestionnaireAggregate([
      send('standard', [question], [{ questionId: 'y', value: true }]),
      send('standard', [question], [{ questionId: 'y', value: false }]),
      send('standard', [question], [{ questionId: 'y', value: true }]),
    ]);
    const a = agg.questions[0];
    if (a?.kind === 'distribution') {
      expect(a.options).toEqual([
        { label: 'Yes', count: 2 },
        { label: 'No', count: 1 },
      ]);
    }
  });

  it('averages each matrix row (Standard + Private)', () => {
    const question = q({
      id: 'm',
      type: 'matrix',
      prompt: 'Rate',
      matrix: { rows: ['Speed', 'Care'], min: 1, max: 5 },
    });
    const agg = buildQuestionnaireAggregate([
      send('standard', [question], [{ questionId: 'm', value: { Speed: 4, Care: 2 } }]),
      send('private', [question], [{ questionId: 'm', value: { Speed: 2, Care: 4 } }]),
    ]);
    const a = agg.questions[0];
    expect(a?.kind).toBe('rows');
    if (a?.kind === 'rows') {
      expect(a.rows).toEqual([
        { label: 'Speed', average: 3 },
        { label: 'Care', average: 3 },
      ]);
    }
  });

  it('free-text is only a response count — never the written content', () => {
    const question = q({ id: 't', type: 'longText', prompt: 'Tell me' });
    const agg = buildQuestionnaireAggregate([
      send('standard', [question], [{ questionId: 't', value: 'a private thought' }]),
      send('private', [question], [{ questionId: 't', value: 'another one' }]),
    ]);
    const a = agg.questions[0];
    expect(a?.kind).toBe('count');
    expect(a?.responseCount).toBe(2);
    // The written text never appears anywhere in the aggregate.
    expect(JSON.stringify(agg)).not.toContain('private thought');
    expect(JSON.stringify(agg)).not.toContain('another one');
  });

  it('omits a question no one answered', () => {
    const question = q({ id: 'r', type: 'rating', prompt: 'How?' });
    const agg = buildQuestionnaireAggregate([send('standard', [question], [])]);
    expect(agg.questions).toEqual([]);
  });
});

describe('extractNumericAnswers (08 §20.8 — a private send card)', () => {
  it('returns rating/slider values + matrix rows with scale bounds, and NO text/categorical content', () => {
    const questions: Question[] = [
      q({ id: 'r', type: 'rating', prompt: 'How connected?', scale: { min: 1, max: 5 } }),
      q({
        id: 'm',
        type: 'matrix',
        prompt: 'Rate us',
        matrix: { rows: ['Speed', 'Care'], min: 1, max: 5 },
      }),
      q({ id: 't', type: 'longText', prompt: 'Anything else?' }),
      q({ id: 'c', type: 'singleChoice', prompt: 'Word?', options: ['Calm', 'Tense'] }),
    ];
    const nums = extractNumericAnswers(questions, [
      { questionId: 'r', value: 4 },
      { questionId: 'm', value: { Speed: 5, Care: 3 } },
      { questionId: 't', value: 'a private written thought' },
      { questionId: 'c', value: 'Tense' },
    ]);
    expect(nums).toEqual([
      { prompt: 'How connected?', row: null, value: 4, min: 1, max: 5 },
      { prompt: 'Rate us', row: 'Speed', value: 5, min: 1, max: 5 },
      { prompt: 'Rate us', row: 'Care', value: 3, min: 1, max: 5 },
    ]);
    // The written text + the categorical selection are NEVER returned (§8.4).
    expect(JSON.stringify(nums)).not.toContain('private written thought');
    expect(JSON.stringify(nums)).not.toContain('Tense');
  });

  it('returns [] when a private send has no numeric questions', () => {
    const questions: Question[] = [q({ id: 't', type: 'longText', prompt: 'Thoughts?' })];
    expect(extractNumericAnswers(questions, [{ questionId: 't', value: 'secret' }])).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { buildQuestionnaireAggregate, type AggregateSend } from './aggregate';
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

describe('buildQuestionnaireAggregate (08 §21.5 — private excluded ENTIRELY)', () => {
  it('a choice distribution counts STANDARD sends only; a private choice is NOT counted or shown', () => {
    const question = q({ id: 'c', type: 'singleChoice', prompt: 'Pick', options: ['A', 'B'] });
    const agg = buildQuestionnaireAggregate([
      send('standard', [question], [{ questionId: 'c', value: 'A' }]),
      send('standard', [question], [{ questionId: 'c', value: 'B' }]),
      // A PRIVATE send answered too — it contributes NOTHING (not to the distribution, not to responseCount).
      send('private', [question], [{ questionId: 'c', value: 'A' }]),
    ]);
    const a = agg.questions[0];
    expect(a?.kind).toBe('distribution');
    // responseCount is STANDARD respondents only — the private send is excluded (§21.5).
    expect(a?.responseCount).toBe(2);
    if (a?.kind === 'distribution') {
      expect(a.options).toEqual([
        { label: 'A', count: 1 }, // only the ONE standard 'A' — the private 'A' is excluded
        { label: 'B', count: 1 },
      ]);
    }
  });

  it('a numeric average excludes PRIVATE sends (their numbers are never shown, §21.5)', () => {
    const question = q({ id: 'r', type: 'rating', prompt: 'How?', scale: { min: 1, max: 5 } });
    const agg = buildQuestionnaireAggregate([
      send('standard', [question], [{ questionId: 'r', value: 4 }]),
      // A PRIVATE send rated 2 — it does NOT pull the average toward 3; it's excluded entirely.
      send('private', [question], [{ questionId: 'r', value: 2 }]),
    ]);
    const a = agg.questions[0];
    expect(a?.kind).toBe('average');
    if (a?.kind === 'average') {
      expect(a.average).toBe(4); // the standard 4 only — the private 2 is NOT folded in
      expect(a.responseCount).toBe(1);
      expect(a.min).toBe(1);
      expect(a.max).toBe(5);
    }
  });

  it('a question answered ONLY by private sends does not appear in the aggregate', () => {
    const question = q({ id: 'r', type: 'rating', prompt: 'How?', scale: { min: 1, max: 5 } });
    const agg = buildQuestionnaireAggregate([
      send('private', [question], [{ questionId: 'r', value: 3 }]),
      send('private', [question], [{ questionId: 'r', value: 5 }]),
    ]);
    expect(agg.questions).toEqual([]); // no standard responses → nothing to show
  });

  it('yes/no distributes with fixed Yes/No options (standard-only)', () => {
    const question = q({ id: 'y', type: 'yesNo', prompt: 'Agree?' });
    const agg = buildQuestionnaireAggregate([
      send('standard', [question], [{ questionId: 'y', value: true }]),
      send('standard', [question], [{ questionId: 'y', value: false }]),
      send('standard', [question], [{ questionId: 'y', value: true }]),
      send('private', [question], [{ questionId: 'y', value: false }]), // excluded
    ]);
    const a = agg.questions[0];
    if (a?.kind === 'distribution') {
      expect(a.responseCount).toBe(3); // the 3 standard, not the private
      expect(a.options).toEqual([
        { label: 'Yes', count: 2 },
        { label: 'No', count: 1 },
      ]);
    }
  });

  it('averages each matrix row over STANDARD sends only', () => {
    const question = q({
      id: 'm',
      type: 'matrix',
      prompt: 'Rate',
      matrix: { rows: ['Speed', 'Care'], min: 1, max: 5 },
    });
    const agg = buildQuestionnaireAggregate([
      send('standard', [question], [{ questionId: 'm', value: { Speed: 4, Care: 2 } }]),
      send('private', [question], [{ questionId: 'm', value: { Speed: 2, Care: 4 } }]), // excluded
    ]);
    const a = agg.questions[0];
    expect(a?.kind).toBe('rows');
    if (a?.kind === 'rows') {
      expect(a.rows).toEqual([
        { label: 'Speed', average: 4 }, // the standard 4 only
        { label: 'Care', average: 2 },
      ]);
    }
  });

  it('free-text is only a STANDARD response count — never the written content, private excluded', () => {
    const question = q({ id: 't', type: 'longText', prompt: 'Tell me' });
    const agg = buildQuestionnaireAggregate([
      send('standard', [question], [{ questionId: 't', value: 'a standard thought' }]),
      send('private', [question], [{ questionId: 't', value: 'a private thought' }]),
    ]);
    const a = agg.questions[0];
    expect(a?.kind).toBe('count');
    expect(a?.responseCount).toBe(1); // the standard one only
    // No written text of any kind appears in the aggregate.
    expect(JSON.stringify(agg)).not.toContain('standard thought');
    expect(JSON.stringify(agg)).not.toContain('private thought');
  });

  it('omits a question no one answered', () => {
    const question = q({ id: 'r', type: 'rating', prompt: 'How?' });
    const agg = buildQuestionnaireAggregate([send('standard', [question], [])]);
    expect(agg.questions).toEqual([]);
  });

  it('a per-question decline is transparent — not a response, not in any distribution (§25.5)', () => {
    const question = q({ id: 'c', type: 'singleChoice', prompt: 'Pick', options: ['A', 'B'] });
    const agg = buildQuestionnaireAggregate([
      send('standard', [question], [{ questionId: 'c', value: 'A' }]),
      // A standard send that SKIPPED this question — it must not count as a response nor bump a bucket.
      send('standard', [question], [{ questionId: 'c', value: { declined: true, reason: 'x' } }]),
    ]);
    const a = agg.questions[0];
    expect(a?.responseCount).toBe(1); // only the real 'A' answer — the decline is not a response
    if (a?.kind === 'distribution') {
      expect(a.options).toEqual([
        { label: 'A', count: 1 },
        { label: 'B', count: 0 },
      ]);
    }
  });

  it('a numeric average ignores a declined answer (§25.5)', () => {
    const question = q({ id: 'r', type: 'rating', prompt: 'How?', scale: { min: 1, max: 5 } });
    const agg = buildQuestionnaireAggregate([
      send('standard', [question], [{ questionId: 'r', value: 4 }]),
      send('standard', [question], [{ questionId: 'r', value: { declined: true } }]),
    ]);
    const a = agg.questions[0];
    expect(a?.kind).toBe('average');
    if (a?.kind === 'average') {
      expect(a.average).toBe(4); // the decline pulls nothing toward a lower average
      expect(a.responseCount).toBe(1);
    }
  });

  it('counts skips + how many flagged "Not clear" per question (§25.5)', () => {
    const question = q({ id: 'r', type: 'rating', prompt: 'How?', scale: { min: 1, max: 5 } });
    const agg = buildQuestionnaireAggregate([
      send('standard', [question], [{ questionId: 'r', value: 4 }]),
      send(
        'standard',
        [question],
        [{ questionId: 'r', value: { declined: true, reason: 'Not clear — needs more context' } }],
      ),
      send(
        'standard',
        [question],
        [{ questionId: 'r', value: { declined: true, reason: 'Prefer not to say' } }],
      ),
      // A PRIVATE send's skip is excluded from the aggregate entirely (§21.5) — counts stay Standard-only.
      send(
        'private',
        [question],
        [{ questionId: 'r', value: { declined: true, reason: 'Not clear — needs more context' } }],
      ),
    ]);
    const a = agg.questions[0];
    expect(a?.responseCount).toBe(1); // one real answer
    expect(a?.skipped).toBe(2); // two Standard skips (the private one is excluded)
    expect(a?.unclear).toBe(1); // one of them flagged "Not clear"
  });

  it('surfaces a question EVERYONE skipped (responseCount 0, skipped > 0 — §25.5)', () => {
    const question = q({ id: 'r', type: 'shortText', prompt: 'The hard one?' });
    const agg = buildQuestionnaireAggregate([
      send(
        'standard',
        [question],
        [{ questionId: 'r', value: { declined: true, reason: 'Not clear — needs more context' } }],
      ),
    ]);
    // It still appears (so the author sees the reword nudge) even with zero real answers.
    const a = agg.questions[0];
    expect(a?.questionId).toBe('r');
    expect(a?.responseCount).toBe(0);
    expect(a?.skipped).toBe(1);
    expect(a?.unclear).toBe(1);
  });
});

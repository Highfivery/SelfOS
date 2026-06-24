import { describe, expect, it } from 'vitest';
import type { Question } from '../schemas';
import { MAX_RESPONSE_BYTES } from '../relay/relayLimits';
import {
  allocationTotal,
  estimateSealedResponseBytes,
  formatAnswerForDisplay,
  isAnswered,
  isQuestionVisible,
  responseSizeGuard,
  unansweredRequired,
  visibleQuestions,
} from './answering';

function q(over: Partial<Question> & Pick<Question, 'id' | 'type'>): Question {
  return { prompt: over.prompt ?? over.id, required: false, ...over };
}

describe('answering — branch visibility', () => {
  const q1 = q({ id: 'q1', type: 'singleChoice', options: ['Yes', 'No'] });
  const q2 = q({
    id: 'q2',
    type: 'shortText',
    branch: { whenQuestionId: 'q1', equals: 'Yes', action: 'show' },
  });

  it('hides a branched question until its trigger matches', () => {
    expect(isQuestionVisible(q2, {})).toBe(false);
    expect(isQuestionVisible(q2, { q1: 'No' })).toBe(false);
    expect(isQuestionVisible(q2, { q1: 'Yes' })).toBe(true);
  });

  it('always shows an unbranched question', () => {
    expect(isQuestionVisible(q1, {})).toBe(true);
  });

  it('shows an equalsAny-branched question when the answer is any of the listed values', () => {
    const q3 = q({
      id: 'q3',
      type: 'shortText',
      branch: { whenQuestionId: 'q1', equalsAny: ['Love it', 'Sometimes'], action: 'show' },
    });
    expect(isQuestionVisible(q3, {})).toBe(false);
    expect(isQuestionVisible(q3, { q1: 'Not for me' })).toBe(false);
    expect(isQuestionVisible(q3, { q1: 'Sometimes' })).toBe(true);
    expect(isQuestionVisible(q3, { q1: 'Love it' })).toBe(true);
  });

  it('filters the list to visible questions in order', () => {
    expect(visibleQuestions([q1, q2], {}).map((x) => x.id)).toEqual(['q1']);
    expect(visibleQuestions([q1, q2], { q1: 'Yes' }).map((x) => x.id)).toEqual(['q1', 'q2']);
  });

  it('shows a question when a multiChoice trigger CONTAINS the branch value', () => {
    const dep = q({
      id: 'cannabisFreq',
      type: 'singleChoice',
      branch: { whenQuestionId: 'used', equals: 'Cannabis', action: 'show' },
    });
    expect(isQuestionVisible(dep, {})).toBe(false);
    expect(isQuestionVisible(dep, { used: ['Cocaine'] })).toBe(false);
    expect(isQuestionVisible(dep, { used: ['Cannabis', 'Cocaine'] })).toBe(true);
  });

  it('shows an equalsAny question when a multiChoice trigger contains any listed value', () => {
    const dep = q({
      id: 'd',
      type: 'shortText',
      branch: { whenQuestionId: 'used', equalsAny: ['Cannabis', 'Ketamine'], action: 'show' },
    });
    expect(isQuestionVisible(dep, { used: ['Cocaine'] })).toBe(false);
    expect(isQuestionVisible(dep, { used: ['Ketamine'] })).toBe(true);
  });

  it('matches a yes/no boolean trigger', () => {
    const dependent = q({
      id: 'q3',
      type: 'shortText',
      branch: { whenQuestionId: 'q0', equals: true, action: 'show' },
    });
    expect(isQuestionVisible(dependent, { q0: false })).toBe(false);
    expect(isQuestionVisible(dependent, { q0: true })).toBe(true);
  });
});

describe('answering — isAnswered per type', () => {
  it('treats text/choice/date as answered only when non-blank', () => {
    expect(isAnswered(q({ id: 'a', type: 'shortText' }), '  ')).toBe(false);
    expect(isAnswered(q({ id: 'a', type: 'shortText' }), 'hi')).toBe(true);
    expect(isAnswered(q({ id: 'a', type: 'date' }), '')).toBe(false);
    expect(isAnswered(q({ id: 'a', type: 'singleChoice' }), 'Yes')).toBe(true);
  });

  it('treats rating/slider as answered for any finite number (incl. 0)', () => {
    expect(isAnswered(q({ id: 'a', type: 'rating' }), 0)).toBe(true);
    expect(isAnswered(q({ id: 'a', type: 'slider' }), Number.NaN)).toBe(false);
  });

  it('treats yes/no as answered once a boolean is set', () => {
    expect(isAnswered(q({ id: 'a', type: 'yesNo' }), false)).toBe(true);
    expect(isAnswered(q({ id: 'a', type: 'yesNo' }), undefined)).toBe(false);
  });

  it('treats multiChoice/ranking as answered with a non-empty list', () => {
    expect(isAnswered(q({ id: 'a', type: 'multiChoice' }), [])).toBe(false);
    expect(isAnswered(q({ id: 'a', type: 'multiChoice' }), ['x'])).toBe(true);
  });

  it('requires every matrix row to be rated', () => {
    const matrix = q({ id: 'a', type: 'matrix', matrix: { rows: ['r1', 'r2'], min: 1, max: 5 } });
    expect(isAnswered(matrix, { r1: 3 })).toBe(false);
    expect(isAnswered(matrix, { r1: 3, r2: 4 })).toBe(true);
  });

  it('treats a dateList as answered only with a complete label+date row', () => {
    const dl = q({ id: 'a', type: 'dateList' });
    expect(isAnswered(dl, [])).toBe(false);
    expect(isAnswered(dl, [{ label: 'Anniversary', date: '' }])).toBe(false);
    expect(isAnswered(dl, [{ label: '', date: '2014-06-21' }])).toBe(false);
    expect(isAnswered(dl, [{ label: 'Anniversary', date: '2014-06-21' }])).toBe(true);
  });

  it('treats a roster as answered only when ≥1 row has its first column (name) filled', () => {
    const r = q({
      id: 'kids',
      type: 'roster',
      roster: [
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'gender', label: 'Gender', type: 'select', options: ['Girl', 'Boy'] },
      ],
    });
    expect(isAnswered(r, [])).toBe(false);
    expect(isAnswered(r, [{ gender: 'Girl' }])).toBe(false); // name (first column) empty
    expect(isAnswered(r, [{ name: 'Emma', gender: 'Girl' }])).toBe(true);
  });

  it('requires an allocation to total exactly 100', () => {
    const alloc = q({ id: 'a', type: 'allocation', options: ['x', 'y'] });
    expect(allocationTotal({ x: 60, y: 30 })).toBe(90);
    expect(isAnswered(alloc, { x: 60, y: 30 })).toBe(false);
    expect(isAnswered(alloc, { x: 60, y: 40 })).toBe(true);
  });
});

describe('answering — unansweredRequired', () => {
  it('lists only visible required questions that are blank', () => {
    const questions: Question[] = [
      q({ id: 'q1', type: 'singleChoice', required: true, options: ['Yes', 'No'] }),
      q({ id: 'q2', type: 'shortText', required: true }),
      q({
        id: 'q3',
        type: 'shortText',
        required: true,
        branch: { whenQuestionId: 'q1', equals: 'Yes', action: 'show' },
      }),
    ];
    // q3 is hidden (q1 ≠ Yes) so it isn't required yet; q1 + q2 are blank.
    expect(unansweredRequired(questions, {}).map((x) => x.id)).toEqual(['q1', 'q2']);
    // Answer q1=Yes (reveals q3) and q2; q3 becomes the only outstanding required one.
    expect(unansweredRequired(questions, { q1: 'Yes', q2: 'done' }).map((x) => x.id)).toEqual([
      'q3',
    ]);
  });
});

describe('answering — formatAnswerForDisplay', () => {
  it('renders each answer type as read-only display text', () => {
    expect(formatAnswerForDisplay(q({ id: 'a', type: 'yesNo' }), true)).toBe('Yes');
    expect(formatAnswerForDisplay(q({ id: 'a', type: 'yesNo' }), false)).toBe('No');
    expect(formatAnswerForDisplay(q({ id: 'a', type: 'rating' }), 4)).toBe('4');
    expect(formatAnswerForDisplay(q({ id: 'a', type: 'shortText' }), '  hi  ')).toBe('hi');
    expect(
      formatAnswerForDisplay(q({ id: 'a', type: 'multiChoice', options: ['A', 'B'] }), ['A', 'B']),
    ).toBe('A, B');
    // ranking is ordered → numbered
    expect(
      formatAnswerForDisplay(q({ id: 'a', type: 'ranking', options: ['A', 'B'] }), ['B', 'A']),
    ).toBe('1. B, 2. A');
    // matrix prints rows in authored order
    expect(
      formatAnswerForDisplay(
        q({ id: 'a', type: 'matrix', matrix: { rows: ['Trust', 'Fun'], min: 1, max: 5 } }),
        { Fun: 5, Trust: 4 },
      ),
    ).toBe('Trust: 4, Fun: 5');
    // allocation prints options in authored order, keeping an explicit 0
    expect(
      formatAnswerForDisplay(q({ id: 'a', type: 'allocation', options: ['X', 'Y'] }), {
        Y: 100,
        X: 0,
      }),
    ).toBe('X: 0, Y: 100');
  });

  it('renders a roster as "v, v; v, v" rows in authored column order', () => {
    const r = q({
      id: 'kids',
      type: 'roster',
      roster: [
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'gender', label: 'Gender', type: 'select', options: ['Girl', 'Boy'] },
        { key: 'age', label: 'Age', type: 'text' },
      ],
    });
    expect(
      formatAnswerForDisplay(r, [
        { name: 'Emma', gender: 'Girl', age: '7' },
        { name: 'Liam', gender: 'Boy', age: '' },
        { name: '', gender: '', age: '' },
      ]),
    ).toBe('Emma, Girl, 7; Liam, Boy');
  });

  it('renders a dateList as "label: date" pairs, dropping incomplete rows', () => {
    expect(
      formatAnswerForDisplay(q({ id: 'a', type: 'dateList' }), [
        { label: 'Anniversary', date: '2014-06-21' },
        { label: 'Incomplete', date: '' },
      ]),
    ).toBe('Anniversary: 2014-06-21');
  });

  it('returns an empty string for an unanswered value', () => {
    expect(formatAnswerForDisplay(q({ id: 'a', type: 'shortText' }), undefined)).toBe('');
  });
});

describe('responseSizeGuard (38 §3.9)', () => {
  it('passes a normal-sized response', () => {
    const payload = { kind: 'submit', answers: [{ questionId: 'q1', value: 'Doing well' }] };
    const check = responseSizeGuard(payload);
    expect(check.ok).toBe(true);
    expect(check.maxBytes).toBe(MAX_RESPONSE_BYTES);
  });

  it('fails a response whose sealed size would exceed the relay cap', () => {
    // A ~250 KB free-text answer base64-expands past the 256 KB sealed cap.
    const payload = { kind: 'submit', answers: [{ questionId: 'q1', value: 'x'.repeat(250_000) }] };
    const check = responseSizeGuard(payload);
    expect(check.ok).toBe(false);
    expect(check.estimatedBytes).toBeGreaterThan(MAX_RESPONSE_BYTES);
  });

  it('estimates the SEALED size above the raw plaintext (base64 + envelope overhead)', () => {
    const payload = { value: 'y'.repeat(1000) };
    const raw = new TextEncoder().encode(JSON.stringify(payload)).length;
    expect(estimateSealedResponseBytes(payload)).toBeGreaterThan(raw);
  });

  it('shares the relay cap constant (the client guard can’t drift from the server)', () => {
    // The guard reports MAX_RESPONSE_BYTES — the SAME constant the relay Worker enforces.
    expect(responseSizeGuard({}).maxBytes).toBe(MAX_RESPONSE_BYTES);
  });
});

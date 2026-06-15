import { describe, expect, it } from 'vitest';
import type { IntakeSectionMeta } from '@shared/channels';
import { isAnswered, overallProgress, sectionProgress } from './progress';
import type { IntakeSectionStatus } from './progress';

const meta = (over: Partial<IntakeSectionMeta>): IntakeSectionMeta => ({
  id: 'x',
  title: 'X',
  blurb: '',
  restricted: false,
  adult: false,
  tier: 'invited',
  mode: 'form',
  opener: '',
  ...over,
});

describe('isAnswered', () => {
  it('treats empty string / list / object / nullish as unanswered, real values as answered', () => {
    expect(isAnswered(undefined)).toBe(false);
    expect(isAnswered('')).toBe(false);
    expect(isAnswered('  ')).toBe(false);
    expect(isAnswered([])).toBe(false);
    expect(isAnswered({})).toBe(false);
    expect(isAnswered('hi')).toBe(true);
    expect(isAnswered(['a'])).toBe(true);
    expect(isAnswered(0)).toBe(true); // a rating/slider of 0 is a real answer
    expect(isAnswered(false)).toBe(true); // a "No" is a real answer
    expect(isAnswered({ row: 3 })).toBe(true);
  });
});

describe('sectionProgress', () => {
  const section = meta({
    questions: [
      { id: 'a', type: 'shortText', prompt: 'A', required: false },
      { id: 'b', type: 'singleChoice', prompt: 'B', required: false, options: ['Yes', 'No'] },
      { id: 'c', type: 'longText', prompt: 'C', required: false },
    ],
  });

  it('counts answered vs total visible questions', () => {
    expect(sectionProgress(section, { a: 'hello', b: 'Yes' })).toEqual({ answered: 2, total: 3 });
    expect(sectionProgress(section, {})).toEqual({ answered: 0, total: 3 });
  });

  it('a chat-only section (no questions) reports 0/0', () => {
    expect(sectionProgress(meta({ questions: undefined as never }), {})).toEqual({
      answered: 0,
      total: 0,
    });
  });

  it('excludes branch-hidden questions from the total (branch-aware)', () => {
    const branched = meta({
      questions: [
        { id: 'trigger', type: 'yesNo', prompt: 'T', required: false },
        {
          id: 'followup',
          type: 'shortText',
          prompt: 'F',
          required: false,
          branch: { whenQuestionId: 'trigger', equals: true, action: 'show' },
        },
      ],
    });
    // The follow-up is hidden until the trigger is true → only 1 question counts.
    expect(sectionProgress(branched, { trigger: false })).toEqual({ answered: 1, total: 1 });
    // Trigger true → the follow-up appears → 2 total, 1 answered.
    expect(sectionProgress(branched, { trigger: true })).toEqual({ answered: 1, total: 2 });
  });
});

describe('overallProgress', () => {
  const metas = [meta({ id: 's1' }), meta({ id: 's2' }), meta({ id: 's3' }), meta({ id: 's4' })];
  it('counts completed + skipped out of all sections and a completed %', () => {
    const status = new Map<string, IntakeSectionStatus>([
      ['s1', 'complete'],
      ['s2', 'skipped'],
      ['s3', 'complete'],
    ]);
    expect(overallProgress(metas, (id) => status.get(id))).toEqual({
      completed: 2,
      skipped: 1,
      total: 4,
      pct: 50,
    });
  });
});

import { describe, expect, it } from 'vitest';
import { SHARING_PRESETS } from '../people/sharingPresets';
import {
  defaultScopeForQuestion,
  effectiveAnswerScope,
  questionCategory,
  questionDefaultsPrivate,
} from './sharingCategory';

describe('intake sharingCategory (43 §4)', () => {
  it('maps a section to its sharing category', () => {
    expect(questionCategory('basics', 'gender')).toBe('basics');
    expect(questionCategory('values', 'values')).toBe('values');
    expect(questionCategory('want', 'anything')).toBe('goals');
    expect(questionCategory('health', 'sleepSchedule')).toBe('health');
    expect(questionCategory('work-money', 'q')).toBe('work');
    expect(questionCategory('joy-play', 'q')).toBe('joy');
    expect(questionCategory('weighs', 'weighsWhat')).toBe('trauma');
    expect(questionCategory('intimacy', 'drawnTo')).toBe('intimacy');
  });

  it('falls back to basics for an unknown section', () => {
    expect(questionCategory('does-not-exist', 'q')).toBe('basics');
  });

  it('a non-restricted question defaults to its category preset', () => {
    expect(defaultScopeForQuestion('basics', 'gender')).toEqual(SHARING_PRESETS.basics);
    // health is partner-only by preset
    expect(defaultScopeForQuestion('health', 'sleepSchedule')).toEqual(['partner']);
  });

  it('a restricted question defaults to Private (empty) regardless of category', () => {
    // a per-question restricted answer in a non-restricted section
    expect(questionDefaultsPrivate('health', 'substancesUsed')).toBe(true);
    expect(defaultScopeForQuestion('health', 'substancesUsed')).toEqual([]);
    // a wholly-restricted section
    expect(questionDefaultsPrivate('intimacy', 'drawnTo')).toBe(true);
    expect(defaultScopeForQuestion('intimacy', 'drawnTo')).toEqual([]);
    expect(defaultScopeForQuestion('weighs', 'weighsWhat')).toEqual([]);
  });

  it('returns a fresh array (no shared mutation of the preset constant)', () => {
    const a = defaultScopeForQuestion('basics', 'gender');
    a.push('ex');
    expect(SHARING_PRESETS.basics).not.toContain('ex');
  });

  describe('effectiveAnswerScope — the share-by-default backfill (44 audit)', () => {
    it('honors an explicit choice, including an explicit [] (deliberately Private)', () => {
      expect(
        effectiveAnswerScope('health', 'sleepSchedule', { sleepSchedule: ['partner'] }),
      ).toEqual(['partner']);
      // An explicit empty array is a deliberate Private — NOT backfilled to the default.
      expect(effectiveAnswerScope('basics', 'gender', { gender: [] })).toEqual([]);
    });

    it('backfills the category default when there is no stored entry (pre-spec portrait)', () => {
      // No answerSharing at all → an answered non-restricted question shares per its preset.
      expect(effectiveAnswerScope('health', 'sleepSchedule', undefined)).toEqual(['partner']);
      expect(effectiveAnswerScope('basics', 'gender', {})).toEqual(SHARING_PRESETS.basics);
    });

    it('keeps a restricted question Private under backfill (no surprise share)', () => {
      expect(effectiveAnswerScope('intimacy', 'drawnTo', undefined)).toEqual([]);
      expect(effectiveAnswerScope('weighs', 'weighsWhat', {})).toEqual([]);
      expect(effectiveAnswerScope('health', 'substancesUsed', undefined)).toEqual([]);
    });
  });
});

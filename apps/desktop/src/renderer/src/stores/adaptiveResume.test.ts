import { describe, expect, it } from 'vitest';

import { resumePhase } from './adaptiveTestStore';

/**
 * 74 §3.4 — where a resumed take picks up.
 *
 * This is the difference between "close it whenever, it picks up here" being true and being a lie: without
 * it, a second sitting lands at the top of a ~1,100-entry bank the person already walked.
 */
describe('resumePhase', () => {
  it('starts a fresh take at the bank', () => {
    expect(resumePhase(undefined)).toBe('bank');
    expect(resumePhase([])).toBe('bank');
  });

  it('moves PAST a closed pass — a stamped turn means that phase finished', () => {
    expect(resumePhase([{ phase: 'bank' }])).toBe('split');
    expect(resumePhase([{ phase: 'bank' }, { phase: 'split' }])).toBe('lines');
  });

  it('resumes an AI phase where it is — those are many-turned and advance themselves', () => {
    expect(resumePhase([{ phase: 'bank' }, { phase: 'split' }, { phase: 'lines' }])).toBe('lines');
    expect(resumePhase([{ phase: 'bank' }, { phase: 'probe' }])).toBe('probe');
  });

  it('takes the FURTHEST phase reached, whatever order the turns arrive in', () => {
    expect(resumePhase([{ phase: 'scenario' }, { phase: 'bank' }, { phase: 'lines' }])).toBe(
      'scenario',
    );
  });
});

import { describe, expect, it } from 'vitest';

import { resumePhase } from './adaptiveTestStore';

/**
 * 74 §3.4 — where a resumed take picks up.
 *
 * This is the difference between "close it whenever, it picks up here" being true and being a lie: without
 * it, a second sitting lands at the top of a ~1,100-entry bank the person already walked.
 */
describe('resumePhase', () => {
  it('starts a fresh take at the pet names — the first phase (74 §3.6.8)', () => {
    expect(resumePhase(undefined)).toBe('names');
    expect(resumePhase([])).toBe('names');
  });

  it('moves past a closed NAMES pass into the deck', () => {
    expect(resumePhase([{ phase: 'names' }])).toBe('bank');
  });

  it('moves PAST a closed pass — a stamped turn means that phase finished', () => {
    // The split is folded into the words (74 §3.6.13), so a closed deck goes straight to the lines.
    expect(resumePhase([{ phase: 'bank' }])).toBe('lines');
    expect(resumePhase([{ phase: 'bank' }, { phase: 'split' }])).toBe('lines');
  });

  it('resumes an AI phase where it is — those are many-turned and advance themselves', () => {
    expect(resumePhase([{ phase: 'bank' }, { phase: 'lines' }])).toBe('lines');
    expect(resumePhase([{ phase: 'bank' }, { phase: 'probe' }])).toBe('probe');
  });

  it('takes the FURTHEST phase reached, whatever order the turns arrive in', () => {
    expect(resumePhase([{ phase: 'scenario' }, { phase: 'bank' }, { phase: 'lines' }])).toBe(
      'scenario',
    );
  });
});

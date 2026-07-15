import { describe, expect, it } from 'vitest';
import { rankRecommendations } from './rank';
import { BUILT_IN_RECOMMENDATION_PROVIDERS } from './providers';
import type { PersonRecommendationState } from './schemas';

const NOW = new Date('2026-07-15T12:00:00.000Z');

/** A baseline state with only `questionnaires.answer` granted, so the auto-checkin provider is isolated. */
function state(over: Partial<PersonRecommendationState> = {}): PersonRecommendationState {
  return {
    capabilities: new Set(['questionnaires.answer']),
    adultAcknowledged: false,
    proactivity: 'active',
    now: NOW,
    crisis: false,
    isNew: false,
    configured: true,
    openGoals: [],
    openSessions: 0,
    hasSynthesisCache: false,
    canSynthesize: false,
    portraitStale: false,
    depthInvitation: null,
    guidedSuggestionCount: 0,
    lightActivity: false,
    questionnaireGapHint: false,
    memoryStale: false,
    ...over,
  };
}

const ids = (s: PersonRecommendationState, dismissed = new Set<string>()): string[] =>
  rankRecommendations([...BUILT_IN_RECOMMENDATION_PROVIDERS], s, { dismissed }).map((r) => r.id);

describe('auto-checkin recommendation provider (63)', () => {
  it('surfaces when a check-in is waiting', () => {
    expect(ids(state({ autoCheckinWaiting: 1 }))).toContain('auto-checkin');
    expect(ids(state({ autoCheckinWaiting: 3 }))).toContain('auto-checkin');
  });

  it('does not surface when nothing is waiting (absent ⇒ 0)', () => {
    expect(ids(state({ autoCheckinWaiting: 0 }))).not.toContain('auto-checkin');
    expect(ids(state({}))).not.toContain('auto-checkin');
  });

  it('is gated by questionnaires.answer (no dead card)', () => {
    expect(
      ids(state({ capabilities: new Set(['sessions.own']), autoCheckinWaiting: 2 })),
    ).not.toContain('auto-checkin');
  });

  it('re-surfaces at a new count via the signal-aware dismissKey', () => {
    const dismissed = new Set(['rec:auto-checkin:1']); // dismissed while 1 was waiting
    expect(ids(state({ autoCheckinWaiting: 1 }), dismissed)).not.toContain('auto-checkin');
    expect(ids(state({ autoCheckinWaiting: 2 }), dismissed)).toContain('auto-checkin');
  });
});

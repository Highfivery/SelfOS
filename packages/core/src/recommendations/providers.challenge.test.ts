import { describe, expect, it } from 'vitest';
import { rankRecommendations } from './rank';
import { BUILT_IN_RECOMMENDATION_PROVIDERS } from './providers';
import type { PersonRecommendationState } from './schemas';

const NOW = new Date('2026-06-26T12:00:00.000Z');

function state(over: Partial<PersonRecommendationState> = {}): PersonRecommendationState {
  return {
    capabilities: new Set(['challenges.own']),
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

const ids = (s: PersonRecommendationState): string[] =>
  rankRecommendations([...BUILT_IN_RECOMMENDATION_PROVIDERS], s, { dismissed: new Set() }).map(
    (r) => r.id,
  );

describe('challenge recommendation providers (52)', () => {
  it('surfaces challenge-checkin when an active challenge’s check-in is due', () => {
    expect(
      ids(
        state({
          challengeCheckInDue: true,
          challengeCheckInSignature: 'c1:2026-06-20',
          activeChallenge: true,
        }),
      ),
    ).toContain('challenge-checkin');
  });

  it('surfaces suggest-challenge when there is no active one + it is suggestable + AI is configured', () => {
    expect(ids(state({ challengeSuggestable: true, configured: true }))).toContain(
      'suggest-challenge',
    );
  });

  it('does NOT suggest while a challenge is active', () => {
    expect(ids(state({ activeChallenge: true, challengeSuggestable: true }))).not.toContain(
      'suggest-challenge',
    );
  });

  it('does NOT suggest when AI is unconfigured (the suggester needs AI)', () => {
    expect(ids(state({ challengeSuggestable: true, configured: false }))).not.toContain(
      'suggest-challenge',
    );
  });

  it('is gated by the challenges.own capability (no dead CTA)', () => {
    expect(ids(state({ capabilities: new Set(), challengeCheckInDue: true }))).not.toContain(
      'challenge-checkin',
    );
  });
});

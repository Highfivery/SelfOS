import { describe, expect, it } from 'vitest';
import type { Goal } from '../schemas';
import { rankRecommendations } from './rank';
import {
  listRecommendationProviders,
  registerRecommendationProvider,
  resetRecommendationProviders,
} from './registry';
import type { PersonRecommendationState, RecommendationProvider } from './schemas';

const NOW = new Date('2026-06-25T12:00:00.000Z');

function goal(over: Partial<Goal> = {}): Goal {
  return {
    id: 'g1',
    schemaVersion: 1,
    subjectPersonId: 'p1',
    text: 'finish the project',
    status: 'open',
    provenance: { at: '2026-04-01T00:00:00.000Z' },
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    lastTouchedAt: '2026-04-01T00:00:00.000Z', // ~85 days untouched → stale
    ...over,
  };
}

function state(over: Partial<PersonRecommendationState> = {}): PersonRecommendationState {
  return {
    capabilities: new Set(['sessions.own', 'intake.own', 'memory.own', 'questionnaires.create']),
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

describe('rankRecommendations — relevance ordering', () => {
  it('ranks a resume-session above a stale goal above a generic guided invite', () => {
    const recs = rankRecommendations(
      listRecommendationProviders(),
      state({
        openSessions: 1,
        openGoals: [goal()],
        lightActivity: true,
      }),
    );
    const ids = recs.map((r) => r.id);
    expect(ids[0]).toBe('continue-session');
    expect(ids).toEqual(['continue-session', 'stale-goal', 'guided-suggestion']);
  });

  it('caps the set by proactivity level', () => {
    const rich = state({
      openSessions: 1,
      openGoals: [goal()],
      portraitStale: true,
      memoryStale: true,
      lightActivity: true,
    });
    expect(
      rankRecommendations(listRecommendationProviders(), { ...rich, proactivity: 'gentle' }),
    ).toHaveLength(2);
    expect(
      rankRecommendations(listRecommendationProviders(), { ...rich, proactivity: 'active' }),
    ).toHaveLength(3);
  });

  it('proactivity off returns [] (the section will not render)', () => {
    const recs = rankRecommendations(
      listRecommendationProviders(),
      state({ proactivity: 'off', openSessions: 1, openGoals: [goal()] }),
    );
    expect(recs).toEqual([]);
  });

  it('a recurring-crisis signal suppresses ALL pushes regardless of candidates', () => {
    const recs = rankRecommendations(
      listRecommendationProviders(),
      state({ crisis: true, openSessions: 1, openGoals: [goal()], portraitStale: true }),
    );
    expect(recs).toEqual([]);
  });

  it('a brand-new person gets no pushes (getting-started owns the screen)', () => {
    const recs = rankRecommendations(
      listRecommendationProviders(),
      state({ isNew: true, openSessions: 1, lightActivity: true }),
    );
    expect(recs).toEqual([]);
  });

  it('variety-dedup keeps the top N from being N of one domain', () => {
    // Three memory-domain candidates available; with N=2 the top set should not be two memory cards.
    const recs = rankRecommendations(
      listRecommendationProviders(),
      state({
        proactivity: 'gentle', // cap 2
        hasSynthesisCache: true, // memory, score 65
        portraitStale: true, // memory, score 60
        memoryStale: true, // memory, score 45
        openSessions: 1, // session, score 90
      }),
    );
    expect(recs).toHaveLength(2);
    const domains = recs.map((r) => r.domain);
    expect(new Set(domains).size).toBe(2); // varied, not two memory cards
    expect(domains).toContain('session');
    expect(domains).toContain('memory');
  });

  it('drops a dismissed recommendation by its signal-aware dismissKey', () => {
    const base = state({ openSessions: 1, openGoals: [goal()] });
    const recs = rankRecommendations(listRecommendationProviders(), base);
    const staleRec = recs.find((r) => r.id === 'stale-goal');
    expect(staleRec).toBeDefined();
    // The dismissKey carries the goal id + its touch stamp (so re-staling the SAME goal won't re-nag it).
    expect(staleRec?.dismissKey).toBe('stale-goal:g1:2026-04-01T00:00:00.000Z');

    const filtered = rankRecommendations(listRecommendationProviders(), base, {
      dismissed: new Set([`rec:${staleRec?.dismissKey}`]),
    }).map((r) => r.id);
    expect(filtered).not.toContain('stale-goal');
    expect(filtered).toContain('continue-session');
  });

  it('re-surfaces a dismissed goal nudge when the signal CHANGES (a different/re-touched goal), never on the same one', () => {
    const dismissed = new Set(['rec:stale-goal:g1:2026-04-01T00:00:00.000Z']);

    // Same goal, same touch stamp → stays dismissed (no re-nag on the same signal).
    const same = rankRecommendations(
      listRecommendationProviders(),
      state({ openGoals: [goal()] }),
      { dismissed },
    ).map((r) => r.id);
    expect(same).not.toContain('stale-goal');

    // The goal was touched again (a new lastTouchedAt) then re-staled → its dismissKey changes → re-surfaces.
    const touched = rankRecommendations(
      listRecommendationProviders(),
      state({ openGoals: [goal({ lastTouchedAt: '2026-05-15T00:00:00.000Z' })] }),
      { dismissed },
    ).map((r) => r.id);
    expect(touched).toContain('stale-goal');
  });
});

describe('rankRecommendations — capability + 18+ gating', () => {
  it('drops a capabilityGate provider when the capability is absent (never a candidate)', () => {
    const withCap = rankRecommendations(
      listRecommendationProviders(),
      state({ questionnaireGapHint: true }),
    ).map((r) => r.id);
    expect(withCap).toContain('questionnaire-gap');

    const withoutCap = rankRecommendations(
      listRecommendationProviders(),
      state({ questionnaireGapHint: true, capabilities: new Set(['sessions.own']) }),
    ).map((r) => r.id);
    expect(withoutCap).not.toContain('questionnaire-gap');
  });

  it('drops an adultGate provider until the 18+ ack, then surfaces it', () => {
    resetRecommendationProviders();
    const intimacy: RecommendationProvider = {
      id: 'intimacy-exercise',
      domain: 'intimacy',
      adultGate: true,
      relevance: () => ({
        id: 'intimacy-exercise',
        label: 'Try the attachment reflection',
        reason: 'Builds on what you shared.',
        route: '/sessions',
        score: 70,
      }),
    };
    registerRecommendationProvider(intimacy);

    const notAcked = rankRecommendations(
      listRecommendationProviders(),
      state({ adultAcknowledged: false }),
    ).map((r) => r.id);
    expect(notAcked).not.toContain('intimacy-exercise');

    const acked = rankRecommendations(
      listRecommendationProviders(),
      state({ adultAcknowledged: true }),
    ).map((r) => r.id);
    expect(acked).toContain('intimacy-exercise');
    resetRecommendationProviders();
  });
});

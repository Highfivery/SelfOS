import { describe, expect, it } from 'vitest';
import { rankRecommendations } from './rank';
import { BUILT_IN_RECOMMENDATION_PROVIDERS } from './providers';
import type { PersonRecommendationState } from './schemas';

const NOW = new Date('2026-06-26T12:00:00.000Z');

/** A baseline state with EVERY gate granted + AI configured, so a single override isolates one provider. */
function state(over: Partial<PersonRecommendationState> = {}): PersonRecommendationState {
  return {
    capabilities: new Set(['tests.own', 'sessions.own']),
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

const rank = (s: PersonRecommendationState, dismissed = new Set<string>()) =>
  rankRecommendations([...BUILT_IN_RECOMMENDATION_PROVIDERS], s, { dismissed });
const ids = (s: PersonRecommendationState, dismissed = new Set<string>()): string[] =>
  rank(s, dismissed).map((r) => r.id);

describe('Slice-B recommendation providers (50/51/48)', () => {
  describe('take-a-test (50)', () => {
    it('invites a first self-assessment when no personality/relationships test is taken', () => {
      expect(ids(state({ testResults: [] }))).toContain('take-a-test');
    });

    it('stops firing once a profile (personality/relationships) test is taken', () => {
      expect(
        ids(
          state({
            testResults: [{ instrument: 'IPIP', group: 'personality', takenAt: '2026-06-01' }],
          }),
        ),
      ).not.toContain('take-a-test');
    });

    it('still invites if the person has ONLY done a wellbeing check-in (not a profile test)', () => {
      expect(
        ids(
          state({
            testResults: [{ instrument: 'PHQ-9', group: 'wellbeing', takenAt: '2026-06-01' }],
          }),
        ),
      ).toContain('take-a-test');
    });

    it('is gated by tests.own (no dead CTA)', () => {
      expect(
        ids(state({ capabilities: new Set(['sessions.own']), testResults: [] })),
      ).not.toContain('take-a-test');
    });
  });

  describe('wellbeing-checkin (51)', () => {
    it('gently invites a re-check when one is due, and is NOT 18+-gated', () => {
      const s = state({
        adultAcknowledged: false,
        wellbeingCheckinDue: true,
        lastWellbeingCheckinAt: '2026-06-01',
      });
      expect(ids(s)).toContain('wellbeing-checkin');
    });

    it('does not nudge when no check-in is due', () => {
      expect(ids(state({ wellbeingCheckinDue: false }))).not.toContain('wellbeing-checkin');
    });

    it('carries a signal-aware dismissKey (the last check-in date) so the SAME overdue does not re-nag', () => {
      const s = state({ wellbeingCheckinDue: true, lastWellbeingCheckinAt: '2026-06-01' });
      const rec = rank(s).find((r) => r.id === 'wellbeing-checkin');
      expect(rec?.dismissKey).toBe('wellbeing-checkin:2026-06-01');
      // Dismissing it suppresses it...
      expect(ids(s, new Set(['rec:wellbeing-checkin:2026-06-01']))).not.toContain(
        'wellbeing-checkin',
      );
      // ...but a NEW check-in (a fresh date) re-surfaces a future overdue.
      expect(
        ids(
          state({ wellbeingCheckinDue: true, lastWellbeingCheckinAt: '2026-07-15' }),
          new Set(['rec:wellbeing-checkin:2026-06-01']),
        ),
      ).toContain('wellbeing-checkin');
    });

    it('is gated by tests.own', () => {
      expect(
        ids(state({ capabilities: new Set(['sessions.own']), wellbeingCheckinDue: true })),
      ).not.toContain('wellbeing-checkin');
    });
  });

  describe('intimacy-exercise (48)', () => {
    const engaged = [{ instrument: 'Kink interests', group: 'intimacy', takenAt: '2026-06-01' }];

    it('invites a guided intimacy exercise once 18+ is acked AND an intimacy test is taken', () => {
      expect(ids(state({ adultAcknowledged: true, testResults: engaged }))).toContain(
        'intimacy-exercise',
      );
    });

    it('is filtered until the 18+ ack — never a premature exposure', () => {
      expect(ids(state({ adultAcknowledged: false, testResults: engaged }))).not.toContain(
        'intimacy-exercise',
      );
    });

    it('does not fire for an acked person who has not engaged intimacy (no intimacy test)', () => {
      expect(
        ids(
          state({
            adultAcknowledged: true,
            testResults: [{ instrument: 'IPIP', group: 'personality', takenAt: '2026-06-01' }],
          }),
        ),
      ).not.toContain('intimacy-exercise');
    });

    it('is gated by sessions.own', () => {
      expect(
        ids(
          state({
            capabilities: new Set(['tests.own']),
            adultAcknowledged: true,
            testResults: engaged,
          }),
        ),
      ).not.toContain('intimacy-exercise');
    });
  });
});

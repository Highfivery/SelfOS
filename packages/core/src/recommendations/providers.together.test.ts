import { describe, expect, it } from 'vitest';
import { rankRecommendations } from './rank';
import { BUILT_IN_RECOMMENDATION_PROVIDERS } from './providers';
import { computeTogetherHomeNudge } from './togetherNudge';
import type { PersonRecommendationState } from './schemas';
import type { TogetherSessionSummary } from '../schemas';

const NOW = new Date('2026-07-11T12:00:00.000Z');
const ME = 'me';
const PARTNER = 'partner';

function state(over: Partial<PersonRecommendationState> = {}): PersonRecommendationState {
  return {
    capabilities: new Set(['together.own']),
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

function summary(over: Partial<TogetherSessionSummary> = {}): TogetherSessionSummary {
  return {
    id: 's1',
    pairKey: 'me~partner',
    initiatorPersonId: ME,
    participants: [
      { personId: ME, displayName: 'Ben' },
      { personId: PARTNER, displayName: 'Angel' },
    ],
    status: 'active',
    yourTurn: false,
    unreadCount: 0,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...over,
  };
}

describe('computeTogetherHomeNudge (§3.12)', () => {
  it('surfaces a pending invitation the viewer was SENT (they are not the initiator), named by the partner', () => {
    const n = computeTogetherHomeNudge(
      [summary({ status: 'invited', initiatorPersonId: PARTNER })],
      ME,
      NOW,
    );
    expect(n?.kind).toBe('invite');
    expect(n?.partnerName).toBe('Angel');
    expect(n?.sessionId).toBe('s1');
  });

  it('does NOT surface an invitation the viewer THEMSELVES sent (they are the initiator, waiting)', () => {
    const n = computeTogetherHomeNudge(
      [summary({ status: 'invited', initiatorPersonId: ME })],
      ME,
      NOW,
    );
    expect(n).toBeNull();
  });

  it('surfaces the viewer’s turn on an active session', () => {
    const n = computeTogetherHomeNudge([summary({ status: 'active', yourTurn: true })], ME, NOW);
    expect(n?.kind).toBe('turn');
  });

  it('prioritizes a pending invite over a your-turn session', () => {
    const n = computeTogetherHomeNudge(
      [
        summary({ id: 'a', status: 'active', yourTurn: true }),
        summary({ id: 'b', status: 'invited', initiatorPersonId: PARTNER }),
      ],
      ME,
      NOW,
    );
    expect(n?.kind).toBe('invite');
    expect(n?.sessionId).toBe('b');
  });

  it('surfaces a quiet pair only when the last completed session is >14 days old', () => {
    const fresh = computeTogetherHomeNudge(
      [summary({ status: 'complete', lastMessageAt: '2026-07-05T00:00:00.000Z' })],
      ME,
      NOW,
    );
    expect(fresh).toBeNull(); // 6 days — not quiet
    const quiet = computeTogetherHomeNudge(
      [summary({ status: 'complete', lastMessageAt: '2026-06-01T00:00:00.000Z' })],
      ME,
      NOW,
    );
    expect(quiet?.kind).toBe('quiet');
    expect(quiet?.sessionId).toBeUndefined(); // routes to /together, not a session
  });

  it('returns null when there is nothing to surface (a recently-active session, no turn/invite)', () => {
    expect(
      computeTogetherHomeNudge(
        [summary({ status: 'active', yourTurn: false, lastMessageAt: NOW.toISOString() })],
        ME,
        NOW,
      ),
    ).toBeNull();
  });

  it('does NOT fire a quiet nudge while the SAME pair has an in-flight session (no contradiction, §7)', () => {
    // An active session with Angel (her turn) + an old completed one with Angel → NOT quiet.
    const n = computeTogetherHomeNudge(
      [
        summary({
          id: 'active',
          status: 'active',
          yourTurn: false,
          lastMessageAt: NOW.toISOString(),
        }),
        summary({ id: 'old', status: 'complete', lastMessageAt: '2026-06-01T00:00:00.000Z' }),
      ],
      ME,
      NOW,
    );
    expect(n).toBeNull();
  });

  it('still nudges a genuinely-quiet pair even when a DIFFERENT pair is active', () => {
    const n = computeTogetherHomeNudge(
      [
        // Pair A (Angel): active, her turn — no nudge from this pair.
        summary({ id: 'a', status: 'active', yourTurn: false, lastMessageAt: NOW.toISOString() }),
        // Pair B (Cara): quiet >14 days — should surface.
        summary({
          id: 'b',
          pairKey: 'cara~me',
          participants: [
            { personId: ME, displayName: 'Ben' },
            { personId: 'cara', displayName: 'Cara' },
          ],
          status: 'complete',
          lastMessageAt: '2026-06-01T00:00:00.000Z',
        }),
      ],
      ME,
      NOW,
    );
    expect(n?.kind).toBe('quiet');
    expect(n?.partnerName).toBe('Cara');
  });
});

describe('the together-session provider (§3.12)', () => {
  it('fires when a nudge is present + the gate is granted; routes to the session', () => {
    const recs = rank(
      state({
        togetherNudge: {
          kind: 'turn',
          sessionId: 's1',
          pairKey: 'me~partner',
          partnerName: 'Angel',
          stamp: 'x',
        },
      }),
    );
    const rec = recs.find((r) => r.id === 'together-session');
    expect(rec).toBeTruthy();
    expect(rec?.route).toBe('/together/session/s1');
    expect(rec?.reason).toContain('Angel');
  });

  it('is filtered out without the together.own capability (no dead CTA)', () => {
    expect(
      ids(
        state({
          capabilities: new Set(),
          togetherNudge: {
            kind: 'invite',
            sessionId: 's1',
            pairKey: 'me~partner',
            partnerName: 'Angel',
            stamp: 'x',
          },
        }),
      ),
    ).not.toContain('together-session');
  });

  it('contributes nothing when there is no nudge', () => {
    expect(ids(state({ togetherNudge: null }))).not.toContain('together-session');
  });

  it('a quiet nudge routes to the Together home + re-surfaces on a new signal stamp', () => {
    const recs = rank(
      state({
        togetherNudge: {
          kind: 'quiet',
          pairKey: 'me~partner',
          partnerName: 'Angel',
          stamp: '2026-06-01',
        },
      }),
    );
    const rec = recs.find((r) => r.id === 'together-session');
    expect(rec?.route).toBe('/together');
    expect(rec?.dismissKey).toBe('together:quiet:me~partner:2026-06-01');
  });
});

describe('pulse-checkin provider (spec 61)', () => {
  it('surfaces when a check-in is due, routes to Together, dismissKey keyed on lastCheckInAt', () => {
    const recs = rank(
      state({
        pulseCheckinDue: {
          partnerPersonId: 'angel',
          partnerName: 'Angel',
          lastCheckInAt: '2026-07-01T00:00:00.000Z',
        },
      }),
    );
    const rec = recs.find((r) => r.id === 'pulse-checkin');
    expect(rec?.route).toBe('/together');
    expect(rec?.label).toContain('Angel');
    expect(rec?.dismissKey).toBe('pulse-checkin:angel:2026-07-01T00:00:00.000Z');
  });

  it('uses `never` in the dismissKey when there is no prior check-in', () => {
    const rec = rank(
      state({ pulseCheckinDue: { partnerPersonId: 'angel', partnerName: 'Angel' } }),
    ).find((r) => r.id === 'pulse-checkin');
    expect(rec?.dismissKey).toBe('pulse-checkin:angel:never');
  });

  it('contributes nothing when not due, and is gated by together.own', () => {
    expect(ids(state({ pulseCheckinDue: null }))).not.toContain('pulse-checkin');
    expect(
      ids(
        state({
          capabilities: new Set(),
          pulseCheckinDue: { partnerPersonId: 'angel', partnerName: 'Angel' },
        }),
      ),
    ).not.toContain('pulse-checkin');
  });
});

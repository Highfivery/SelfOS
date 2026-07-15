import { describe, expect, it } from 'vitest';
import type { AssignmentStatus } from '../schemas';
import {
  AUTO_CHECKIN_EXPIRY_DAYS,
  allocateIntents,
  type AutoAssignmentView,
  backoffTier,
  effectiveIntervalDays,
  hasPendingIntimacy,
  isStreamDue,
  MAX_PER_AUTHOR_PER_RUN,
  planStreams,
  queueDepth,
  shouldRunAutoCheckins,
  type StreamState,
} from './planner';

const now = new Date('2026-07-15T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number): string => new Date(now.getTime() - n * DAY).toISOString();
const inDays = (n: number): string => new Date(now.getTime() + n * DAY).toISOString();

function a(
  status: AssignmentStatus,
  createdDaysAgo: number,
  extra: Partial<AutoAssignmentView> = {},
): AutoAssignmentView {
  return { status, createdAt: daysAgo(createdDaysAgo), ...extra };
}

describe('shouldRunAutoCheckins', () => {
  it('runs when enabled + has targets + never checked', () => {
    expect(
      shouldRunAutoCheckins({
        enabled: true,
        hasEnabledTargets: true,
        lastCheckedAt: undefined,
        now,
      }),
    ).toBe(true);
  });
  it('does not run when disabled or no enabled targets', () => {
    expect(
      shouldRunAutoCheckins({
        enabled: false,
        hasEnabledTargets: true,
        lastCheckedAt: undefined,
        now,
      }),
    ).toBe(false);
    expect(
      shouldRunAutoCheckins({
        enabled: true,
        hasEnabledTargets: false,
        lastCheckedAt: undefined,
        now,
      }),
    ).toBe(false);
  });
  it('throttles to once per 24h, then runs again', () => {
    expect(
      shouldRunAutoCheckins({
        enabled: true,
        hasEnabledTargets: true,
        lastCheckedAt: daysAgo(0.5),
        now,
      }),
    ).toBe(false);
    expect(
      shouldRunAutoCheckins({
        enabled: true,
        hasEnabledTargets: true,
        lastCheckedAt: daysAgo(1.1),
        now,
      }),
    ).toBe(true);
  });
});

describe('queueDepth', () => {
  it('counts answerable, not-yet-expired sends only', () => {
    const assignments = [
      a('sent', 1),
      a('opened', 2),
      a('inProgress', 3),
      a('submitted', 4), // answered — not in queue
      a('declined', 5), // resolved — not in queue
      a('sent', 20, { expiresAt: daysAgo(1) }), // past expiry — ignored
    ];
    expect(queueDepth(assignments, now)).toBe(3);
  });
});

describe('backoffTier', () => {
  it('is 0 when the most recent resolution was an answer', () => {
    expect(backoffTier([a('submitted', 1), a('declined', 5), a('declined', 9)], now)).toBe(0);
  });
  it('counts a single ignore (past-expiry) as disengaged', () => {
    expect(backoffTier([a('sent', 25, { expiresAt: daysAgo(10) })], now)).toBe(1);
    expect(backoffTier([a('declined', 1)], now)).toBe(1);
    expect(backoffTier([a('declined', 1), a('declined', 2)], now)).toBe(2);
  });
  it('rises with consecutive disengaged, skipping pending, capped at 3', () => {
    // newest→oldest after sort: pending(skip), declined, declined, declined, submitted(reset boundary)
    const assignments = [
      a('sent', 0.1), // pending — skipped
      a('declined', 1),
      a('declined', 2),
      a('declined', 3),
      a('submitted', 6), // older than the streak → the break comes after 3 disengaged
    ];
    expect(backoffTier(assignments, now)).toBe(3);
  });
});

describe('effectiveIntervalDays', () => {
  it('stretches the interval by back-off tier; tier 3 = paused', () => {
    expect(effectiveIntervalDays('daily', 0)).toBe(1);
    expect(effectiveIntervalDays('daily', 1)).toBe(3);
    expect(effectiveIntervalDays('daily', 2)).toBe(7);
    expect(effectiveIntervalDays('daily', 3)).toBe(Infinity);
    expect(effectiveIntervalDays('weekly', 0)).toBe(7);
    expect(effectiveIntervalDays('weekly', 1)).toBe(7); // base already ≥ 3
  });
});

describe('isStreamDue', () => {
  const stream = (
    assignments: AutoAssignmentView[],
    cadence: StreamState['cadence'] = 'daily',
  ): StreamState => ({
    targetId: 't',
    cadence,
    assignments,
  });
  it('is due when never run', () => {
    expect(isStreamDue(stream([]), now)).toBe(true);
  });
  it('respects the base interval', () => {
    expect(isStreamDue(stream([a('submitted', 0.5)]), now)).toBe(false); // < 1 day
    expect(isStreamDue(stream([a('submitted', 2)]), now)).toBe(true); // > 1 day
  });
  it('is never due when soft-paused (tier 3)', () => {
    const paused = [a('declined', 1), a('declined', 2), a('declined', 3)];
    expect(isStreamDue(stream(paused), now)).toBe(false);
  });
});

describe('planStreams', () => {
  const stream = (targetId: string, assignments: AutoAssignmentView[]): StreamState => ({
    targetId,
    cadence: 'daily',
    assignments,
  });
  it('tops a fresh stream up toward the target depth, bounded by MAX_PER_RUN', () => {
    const plans = planStreams({ streams: [stream('t1', [])], now });
    expect(plans).toEqual([{ targetId: 't1', slots: 2 }]); // TARGET_DEPTH 3 capped by MAX_PER_RUN 2
  });
  it('pauses a stream at the hard cap and skips a not-due one', () => {
    const full = stream('full', [
      a('sent', 1),
      a('sent', 1),
      a('opened', 1),
      a('sent', 1),
      a('sent', 1),
    ]);
    const notDue = stream('notDue', [a('submitted', 0.2)]);
    expect(planStreams({ streams: [full, notDue], now })).toEqual([]);
  });
  it('caps the total across streams at MAX_PER_AUTHOR_PER_RUN', () => {
    const streams = [stream('t1', []), stream('t2', []), stream('t3', [])];
    const plans = planStreams({ streams, now });
    const total = plans.reduce((n, p) => n + p.slots, 0);
    expect(total).toBe(MAX_PER_AUTHOR_PER_RUN); // 2 + 2, third gets 0
    expect(plans.length).toBe(2);
  });
});

describe('allocateIntents', () => {
  it('reserves one intimacy slot then fills with variety', () => {
    expect(allocateIntents(2, { reserveIntimacy: true })).toEqual(['intimacy', 'deepen']);
    expect(allocateIntents(1, { reserveIntimacy: true })).toEqual(['intimacy']);
  });
  it('fills with varied topical intents when intimacy is not reserved', () => {
    expect(allocateIntents(2, { reserveIntimacy: false })).toEqual(['deepen', 'explore']);
  });
});

describe('hasPendingIntimacy', () => {
  it('detects a pending intimacy check-in but not a resolved one', () => {
    expect(hasPendingIntimacy([a('sent', 1, { intent: 'intimacy' })], now)).toBe(true);
    expect(hasPendingIntimacy([a('submitted', 1, { intent: 'intimacy' })], now)).toBe(false);
    expect(hasPendingIntimacy([a('sent', 1, { intent: 'deepen' })], now)).toBe(false);
  });
});

it('exports a sane expiry constant', () => {
  expect(AUTO_CHECKIN_EXPIRY_DAYS).toBeGreaterThan(0);
  // future-dated expiry helper sanity (used by the orchestrator)
  expect(new Date(inDays(AUTO_CHECKIN_EXPIRY_DAYS)).getTime()).toBeGreaterThan(now.getTime());
});

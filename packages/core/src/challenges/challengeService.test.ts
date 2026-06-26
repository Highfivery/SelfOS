import { beforeEach, describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { FileSystem } from '../host';
import type { ChallengeMarker } from '../conversations/guidedSteps';
import { listInsightsForPerson } from '../insights';
import { listGoals } from '../goals';
import {
  captureFromMarker,
  checkInDueChallenge,
  featuredActiveChallenge,
  getChallenge,
  isCheckInDue,
  listChallenges,
  recordCheckIn,
  seedGoalFromChallenge,
  setChallengeStatus,
  snoozeCheckIn,
} from './challengeService';

const key = generateMasterKey();
const now = new Date('2026-06-26T12:00:00.000Z');
let fs: FileSystem;
beforeEach(() => {
  fs = memFileSystem();
});

const marker = (over: Partial<ChallengeMarker> = {}): ChallengeMarker => ({
  action: 'Strike up one conversation with a stranger this week',
  comfort: 3,
  lifeArea: 'Relationships',
  checkInDays: 7,
  ...over,
});

describe('captureFromMarker', () => {
  it('creates an active challenge with normalized fields + a future check-in', async () => {
    const c = await captureFromMarker({
      fs,
      key,
      personId: 'p1',
      conversationId: 'c1',
      marker: marker(),
      now,
    });
    expect(c).not.toBeNull();
    expect(c?.status).toBe('active');
    expect(c?.action).toBe('Strike up one conversation with a stranger this week');
    expect(c?.comfort).toBe(3);
    expect(c?.lifeArea).toBe('Relationships');
    expect(c?.subjectPersonId).toBe('p1');
    expect(c?.conversationId).toBe('c1');
    expect(c?.agreedAt).toBe(now.toISOString());
    // check-in is 7 days out
    expect(new Date(c!.checkInAt!).getTime()).toBe(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  });

  it('clamps comfort to 1..5, normalizes the life-area, and clamps checkInDays', async () => {
    const c = await captureFromMarker({
      fs,
      key,
      personId: 'p1',
      conversationId: 'c1',
      marker: marker({ comfort: 9, lifeArea: 'relationships', checkInDays: 999 }),
      now,
    });
    expect(c?.comfort).toBe(5);
    expect(c?.lifeArea).toBe('Relationships'); // canonical taxonomy casing
    // clamped to the max 30-day window
    expect(new Date(c!.checkInAt!).getTime()).toBe(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  });

  it('derives `adult` for an intimacy domain / Intimacy life-area', async () => {
    const c = await captureFromMarker({
      fs,
      key,
      personId: 'p1',
      conversationId: 'c1',
      marker: marker({ domain: 'intimacy', lifeArea: 'Intimacy' }),
      now,
    });
    expect(c?.adult).toBe(true);
    expect(c?.domain).toBe('intimacy');
  });

  it('REFINES (does not duplicate) when the same conversation already has an active challenge (§4.3)', async () => {
    const first = await captureFromMarker({
      fs,
      key,
      personId: 'p1',
      conversationId: 'c1',
      marker: marker(),
      now,
    });
    const later = new Date(now.getTime() + 60_000);
    const second = await captureFromMarker({
      fs,
      key,
      personId: 'p1',
      conversationId: 'c1',
      marker: marker({ action: 'Make it a quick hello instead', comfort: 2 }),
      now: later,
    });
    expect(second?.id).toBe(first?.id); // same record, refined
    expect(second?.action).toBe('Make it a quick hello instead');
    expect(second?.comfort).toBe(2);
    const all = await listChallenges(fs, key, 'p1');
    expect(all.filter((c) => c.status === 'active')).toHaveLength(1);
  });

  it('rejects an empty action', async () => {
    const c = await captureFromMarker({
      fs,
      key,
      personId: 'p1',
      conversationId: 'c1',
      marker: { action: '   ' },
      now,
    });
    expect(c).toBeNull();
  });
});

describe('lifecycle + check-in', () => {
  async function active(over: Partial<ChallengeMarker> = {}): Promise<string> {
    const c = await captureFromMarker({
      fs,
      key,
      personId: 'p1',
      conversationId: 'c1',
      marker: marker(over),
      now,
    });
    return c!.id;
  }

  it('setChallengeStatus moves a challenge to abandoned', async () => {
    const id = await active();
    const updated = await setChallengeStatus(fs, key, 'p1', id, 'abandoned', now);
    expect(updated?.status).toBe('abandoned');
  });

  it('snoozeCheckIn keeps it active and pushes the check-in out', async () => {
    const id = await active();
    const later = new Date(now.getTime() + 9 * 24 * 60 * 60 * 1000);
    const updated = await snoozeCheckIn(fs, key, 'p1', id, later);
    expect(updated?.status).toBe('active');
    expect(new Date(updated!.checkInAt!).getTime()).toBe(later.getTime() + 7 * 24 * 60 * 60 * 1000);
  });

  it('recordCheckIn marks done + produces a session Insight with provenance.challengeId (deterministic)', async () => {
    const id = await active();
    const result = await recordCheckIn({
      fs,
      key,
      personId: 'p1',
      challengeId: id,
      outcome: 'did',
      reflection: 'It was easier than I feared',
      now,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.challenge.status).toBe('done');
    expect(result.challenge.outcome).toBe('did');
    expect(result.challenge.reflection).toBe('It was easier than I feared');
    const insights = await listInsightsForPerson(fs, key, 'p1');
    expect(insights).toHaveLength(1);
    const insight = insights[0]!;
    expect(insight.source).toBe('session');
    expect(insight.approved).toBe(true);
    expect(insight.provenance.challengeId).toBe(id);
    expect(insight.facts.some((f) => f.text.includes('Strike up one conversation'))).toBe(true);
    // a non-adult challenge's facts are NOT restricted
    expect(insight.facts.every((f) => !f.restricted)).toBe(true);
  });

  it("a SEXUAL challenge's reflection facts are restricted (own-context-only, §8.4)", async () => {
    const id = await active({ domain: 'intimacy', lifeArea: 'Intimacy' });
    const result = await recordCheckIn({
      fs,
      key,
      personId: 'p1',
      challengeId: id,
      outcome: 'partly',
      now,
    });
    expect(result.ok).toBe(true);
    const insight = (await listInsightsForPerson(fs, key, 'p1'))[0]!;
    expect(insight.facts.length).toBeGreaterThan(0);
    expect(insight.facts.every((f) => f.restricted === true)).toBe(true);
    expect(insight.facts.every((f) => f.shareable === false)).toBe(true);
  });

  it('an adult challenge with NO life-area defaults the reflection to Intimacy (SF1 — stays usable on-topic)', async () => {
    // domain:'intimacy' makes it adult, but with NO explicit lifeArea. Restricted facts with no life-area
    // fail CLOSED in summarizeForContext (withheld everywhere) — so default to 'Intimacy' to keep it usable.
    const c = await captureFromMarker({
      fs,
      key,
      personId: 'p1',
      conversationId: 'c1',
      marker: {
        action: 'Try something new with a partner',
        comfort: 3,
        checkInDays: 7,
        domain: 'intimacy',
      },
      now,
    });
    expect(c?.adult).toBe(true);
    expect(c?.lifeArea).toBeUndefined();
    const result = await recordCheckIn({
      fs,
      key,
      personId: 'p1',
      challengeId: c!.id,
      outcome: 'did',
      now,
    });
    expect(result.ok).toBe(true);
    const insight = (await listInsightsForPerson(fs, key, 'p1'))[0]!;
    expect(insight.facts.every((f) => f.restricted === true)).toBe(true);
    expect(insight.facts.every((f) => f.lifeArea === 'Intimacy')).toBe(true);
    expect(insight.categories).toContain('Intimacy');
  });

  it('a re-check-in REUSES the insightId (preserving createdAt)', async () => {
    const id = await active();
    const first = await recordCheckIn({
      fs,
      key,
      personId: 'p1',
      challengeId: id,
      outcome: 'did',
      now,
    });
    expect(first.ok && first.insightId).toBeTruthy();
    const later = new Date(now.getTime() + 60_000);
    const second = await recordCheckIn({
      fs,
      key,
      personId: 'p1',
      challengeId: id,
      outcome: 'partly',
      reflection: 'on reflection, partly',
      now: later,
    });
    expect(second.ok && second.insightId).toBe(first.ok && first.insightId);
    const insights = await listInsightsForPerson(fs, key, 'p1');
    expect(insights).toHaveLength(1); // updated in place, not duplicated
    expect(insights[0]!.createdAt).toBe(now.toISOString());
    expect(insights[0]!.updatedAt).toBe(later.toISOString());
  });

  it('recordCheckIn on a missing challenge returns NOT_FOUND', async () => {
    const result = await recordCheckIn({
      fs,
      key,
      personId: 'p1',
      challengeId: 'nope',
      outcome: 'did',
      now,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('NOT_FOUND');
  });
});

describe('seedGoalFromChallenge (offer-to, §11 Q6)', () => {
  it('creates a 39 Goal from the challenge action + back-links seededGoalId; idempotent', async () => {
    const c = await captureFromMarker({
      fs,
      key,
      personId: 'p1',
      conversationId: 'c1',
      marker: marker(),
      now,
    });
    const seeded = await seedGoalFromChallenge(fs, key, 'p1', c!.id, now);
    expect(seeded?.seededGoalId).toBeTruthy();
    const goals = await listGoals(fs, key, 'p1');
    expect(goals).toHaveLength(1);
    expect(goals[0]!.text).toBe(c!.action);
    // idempotent — a second call doesn't create a second goal
    await seedGoalFromChallenge(fs, key, 'p1', c!.id, now);
    expect(await listGoals(fs, key, 'p1')).toHaveLength(1);
  });
});

describe('pure helpers', () => {
  it('featuredActiveChallenge returns the active one; isCheckInDue / checkInDueChallenge respect status + checkInAt', async () => {
    const c = await captureFromMarker({
      fs,
      key,
      personId: 'p1',
      conversationId: 'c1',
      marker: marker(),
      now,
    });
    const list = await listChallenges(fs, key, 'p1');
    expect(featuredActiveChallenge(list)?.id).toBe(c!.id);
    // not yet due (check-in is 7 days out)
    expect(isCheckInDue(c!, now)).toBe(false);
    expect(checkInDueChallenge(list, now)).toBeUndefined();
    // …but due after the window passes
    const after = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);
    expect(isCheckInDue(c!, after)).toBe(true);
    expect(checkInDueChallenge(list, after)?.id).toBe(c!.id);
  });

  it('listChallenges skips the suggestion.enc sidecar', async () => {
    await captureFromMarker({
      fs,
      key,
      personId: 'p1',
      conversationId: 'c1',
      marker: marker(),
      now,
    });
    // a stray sidecar file in the same dir must not parse as a Challenge
    await fs.writeAtomic(
      'people/p1/challenges/suggestion.enc',
      new TextEncoder().encode('garbage'),
    );
    const list = await listChallenges(fs, key, 'p1');
    expect(list).toHaveLength(1);
  });

  it('per-person isolation: another person never sees p1’s challenges', async () => {
    await captureFromMarker({
      fs,
      key,
      personId: 'p1',
      conversationId: 'c1',
      marker: marker(),
      now,
    });
    expect(await listChallenges(fs, key, 'p2')).toHaveLength(0);
    expect(
      await getChallenge(fs, key, 'p2', (await listChallenges(fs, key, 'p1'))[0]!.id),
    ).toBeNull();
  });
});

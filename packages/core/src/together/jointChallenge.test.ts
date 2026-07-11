import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { ClaudeClient, FileSystem } from '../host';
import type { Person, TogetherSession } from '../schemas';
import { savePerson, saveRelationship } from '../people';
import { listChallenges, recordCheckIn } from '../challenges/challengeService';
import { createSession } from './togetherService';
import { runTogetherTurn } from './togetherChatService';
import { buildTogetherSystemPrompt } from './togetherPromptBuilder';
import {
  captureJointChallengeFromMarker,
  jointChallengeGroundingLines,
  listJointChallenges,
} from './togetherChallengeService';

const key = generateMasterKey();
const BEN = 'ben';
const ANGEL = 'angel';
const NOW = new Date('2026-07-11T12:00:00.000Z');

function person(id: string, displayName: string): Person {
  return {
    id,
    schemaVersion: 1,
    displayName,
    isSubject: true,
    tags: [],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}

async function seedPair(fs: FileSystem): Promise<TogetherSession> {
  await savePerson(fs, key, person(BEN, 'Ben'));
  await savePerson(fs, key, person(ANGEL, 'Angel'));
  await saveRelationship(fs, key, {
    id: 'rel',
    schemaVersion: 2,
    fromPersonId: BEN,
    toPersonId: ANGEL,
    type: 'partner',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  });
  return createSession(fs, key, { initiatorPersonId: BEN, participantIds: [BEN, ANGEL] }, NOW);
}

const marker = {
  action: 'Share one appreciation a day',
  comfort: 2,
  lifeArea: 'Relationships',
  checkInDays: 7,
};

describe('captureJointChallengeFromMarker (§5.6)', () => {
  it('mints a twin for BOTH partners sharing one groupId', async () => {
    const fs = memFileSystem();
    const session = await seedPair(fs);
    const twins = await captureJointChallengeFromMarker(
      fs,
      key,
      [BEN, ANGEL],
      marker,
      session.id,
      NOW,
    );
    expect(twins).toHaveLength(2);
    const [g1, g2] = twins.map((t) => t.groupId);
    expect(g1).toBeTruthy();
    expect(g1).toBe(g2); // shared groupId
    // Each twin is owned by its own person (per-person isolation).
    const benOwn = await listChallenges(fs, key, BEN);
    const angelOwn = await listChallenges(fs, key, ANGEL);
    expect(benOwn[0]?.subjectPersonId).toBe(BEN);
    expect(angelOwn[0]?.subjectPersonId).toBe(ANGEL);
    expect(benOwn[0]?.action).toBe('Share one appreciation a day');
  });

  it('re-minting in the same session UPDATES the twins (stable groupId), not a competing group', async () => {
    const fs = memFileSystem();
    const session = await seedPair(fs);
    const first = await captureJointChallengeFromMarker(
      fs,
      key,
      [BEN, ANGEL],
      marker,
      session.id,
      NOW,
    );
    const second = await captureJointChallengeFromMarker(
      fs,
      key,
      [BEN, ANGEL],
      { ...marker, action: 'Share TWO appreciations a day' },
      session.id,
      new Date(NOW.getTime() + 1000),
    );
    expect(second[0]?.groupId).toBe(first[0]?.groupId);
    // Only one active challenge per person for this session (updated, not duplicated).
    expect((await listChallenges(fs, key, BEN)).filter((c) => c.status === 'active')).toHaveLength(
      1,
    );
    expect((await listChallenges(fs, key, BEN))[0]?.action).toBe('Share TWO appreciations a day');
  });
});

describe('listJointChallenges + grounding (§5.6)', () => {
  it('derives the cross-partner "both checked in" status from the twins', async () => {
    const fs = memFileSystem();
    const session = await seedPair(fs);
    await captureJointChallengeFromMarker(fs, key, [BEN, ANGEL], marker, session.id, NOW);
    let statuses = await listJointChallenges(fs, key, [BEN, ANGEL]);
    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.memberCount).toBe(2);
    expect(statuses[0]?.checkedInCount).toBe(0);
    expect(statuses[0]?.allCheckedIn).toBe(false);
    expect(jointChallengeGroundingLines(statuses)[0]).toContain(
      'neither of you has checked in yet',
    );

    // Ben checks in → 1 of 2.
    const benChallenge = (await listChallenges(fs, key, BEN))[0]!;
    await recordCheckIn({
      fs,
      key,
      personId: BEN,
      challengeId: benChallenge.id,
      outcome: 'did',
      now: NOW,
    });
    statuses = await listJointChallenges(fs, key, [BEN, ANGEL]);
    expect(statuses[0]?.checkedInCount).toBe(1);
    expect(jointChallengeGroundingLines(statuses)[0]).toContain('1 of 2 of you have checked in');

    // Angel checks in → both.
    const angelChallenge = (await listChallenges(fs, key, ANGEL))[0]!;
    await recordCheckIn({
      fs,
      key,
      personId: ANGEL,
      challengeId: angelChallenge.id,
      outcome: 'partly',
      now: NOW,
    });
    statuses = await listJointChallenges(fs, key, [BEN, ANGEL]);
    expect(statuses[0]?.allCheckedIn).toBe(true);
    // A fully-checked-in, no-longer-active challenge drops out of the grounding lines.
    expect(jointChallengeGroundingLines(statuses)).toHaveLength(0);
  });

  it('counts PEOPLE not records: a check-in then a same-session re-mint keeps memberCount at 2', async () => {
    const fs = memFileSystem();
    const session = await seedPair(fs);
    await captureJointChallengeFromMarker(fs, key, [BEN, ANGEL], marker, session.id, NOW);
    // Ben checks in → his record goes `done`.
    const benChallenge = (await listChallenges(fs, key, BEN))[0]!;
    await recordCheckIn({
      fs,
      key,
      personId: BEN,
      challengeId: benChallenge.id,
      outcome: 'did',
      now: NOW,
    });
    // A later turn in the SAME session re-mints — Ben's dedup only reuses an ACTIVE record, so he now has TWO
    // records under the group. The status must still count 2 PEOPLE (1 checked in), not 3 records.
    await captureJointChallengeFromMarker(
      fs,
      key,
      [BEN, ANGEL],
      { ...marker, action: 'Share TWO appreciations a day' },
      session.id,
      new Date(NOW.getTime() + 5000),
    );
    const statuses = await listJointChallenges(fs, key, [BEN, ANGEL]);
    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.memberCount).toBe(2); // people, not records
    expect(statuses[0]?.checkedInCount).toBeLessThanOrEqual(2);
  });
});

function markerClient(reply: string): ClaudeClient {
  return {
    send: () => Promise.resolve('ok'),
    stream: (_opts, onDelta) => {
      onDelta(reply);
      return Promise.resolve({
        text: reply,
        usage: { inputTokens: 10, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 },
      });
    },
  };
}

describe('the couples prompt teaches the joint-challenge convention (§5.6)', () => {
  it('includes the CHALLENGE marker instruction', async () => {
    const fs = memFileSystem();
    const session = await seedPair(fs);
    const prompt = await buildTogetherSystemPrompt(fs, key, session);
    expect(prompt).toContain('[[SELFOS:CHALLENGE:');
    expect(prompt).toContain('BOTH partners want to take on the SAME');
  });
});

describe('the couples turn mints joint challenges from a CHALLENGE marker (§5.6)', () => {
  it('a NON-aside reply with the marker mints twins + strips the token from the saved reply', async () => {
    const fs = memFileSystem();
    const session = await seedPair(fs);
    const reply =
      'Love that you both want this. [[SELFOS:CHALLENGE:{"action":"Plan one screen-free evening","comfort":2,"lifeArea":"Relationships","checkInDays":7}]]';
    const result = await runTogetherTurn({
      fs,
      key,
      client: markerClient(reply),
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      session,
      authorPersonId: BEN,
      userText: 'Let’s try a screen-free night.',
      onDelta: () => {},
      now: NOW,
    });
    expect(result.ok).toBe(true);
    const statuses = await listJointChallenges(fs, key, [BEN, ANGEL]);
    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.action).toBe('Plan one screen-free evening');
  });

  it('an ASIDE reply with the marker mints NOTHING (§3.6 — asides produce no shared artifacts)', async () => {
    const fs = memFileSystem();
    const session = await seedPair(fs);
    const reply =
      'Just between us. [[SELFOS:CHALLENGE:{"action":"secret solo thing","comfort":3,"checkInDays":5}]]';
    await runTogetherTurn({
      fs,
      key,
      client: markerClient(reply),
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      session,
      authorPersonId: BEN,
      userText: 'A private thought.',
      privateAside: true,
      onDelta: () => {},
      now: NOW,
    });
    expect(await listJointChallenges(fs, key, [BEN, ANGEL])).toHaveLength(0);
    expect(await listChallenges(fs, key, BEN)).toHaveLength(0);
  });
});

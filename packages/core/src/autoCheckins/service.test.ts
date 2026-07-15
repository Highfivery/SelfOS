import { describe, expect, it } from 'vitest';
import { acknowledgeAdult } from '../conversations/guidanceService';
import { generateMasterKey } from '../crypto';
import type { ClaudeClient, FileSystem } from '../host';
import { memFileSystem } from '../host/memFileSystem';
import { upsertPerson } from '../people/peopleService';
import { upsertRelationship } from '../people/relationshipService';
import { listAssignments } from '../questionnaires/assignmentService';
import { getQuestionnaire, listQuestionnaires } from '../questionnaires/questionnaireService';
import type { AutoCheckinTarget, RelationshipType } from '../schemas';
import { setAppBudget } from '../usage/budgetService';
import { recordUsage } from '../usage/usageStore';
import { writeEncryptedJson } from '../vault';
import { setAutoCheckinConfig } from './prefsService';
import { runAutoCheckins, type RunAutoCheckinsInput } from './service';

const key = generateMasterKey();
const now = new Date('2026-07-15T12:00:00.000Z');

const GEN_JSON = JSON.stringify({
  title: 'A quick check-in',
  questions: [{ type: 'shortText', prompt: 'What has been on your mind lately?' }],
});

function fakeClient(text = GEN_JSON): ClaudeClient {
  return {
    send: () => Promise.resolve(text),
    stream: (_options, onDelta) => {
      onDelta(text);
      return Promise.resolve({
        text,
        usage: { inputTokens: 10, outputTokens: 20, cacheWriteTokens: 0, cacheReadTokens: 0 },
      });
    },
  };
}

async function seedIntakeComplete(fs: FileSystem, personId: string): Promise<void> {
  await writeEncryptedJson(
    fs,
    `people/${personId}/intake/session.enc`,
    {
      id: `intake-${personId}`,
      schemaVersion: 1,
      personId,
      status: 'complete',
      sections: [],
      startedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
    key,
  );
}

/** A person who has finished onboarding (+ optionally acked 18+ / has a birthday). */
async function seedPerson(
  fs: FileSystem,
  opts: { name: string; birthday?: string; ack?: boolean },
): Promise<string> {
  const person = await upsertPerson(fs, key, {
    displayName: opts.name,
    isSubject: true,
    tags: [],
    pronouns: 'they/them',
    ...(opts.birthday ? { birthday: opts.birthday } : {}),
  });
  await seedIntakeComplete(fs, person.id);
  if (opts.ack) await acknowledgeAdult(fs, key, person.id);
  return person.id;
}

const selfTarget = (over: Partial<AutoCheckinTarget> = {}): AutoCheckinTarget => ({
  id: 't-self',
  target: { kind: 'self' },
  enabled: true,
  includeIntimacy: true,
  explorationFocus: '',
  cadence: 'daily',
  ...over,
});

const personTarget = (
  personId: string,
  over: Partial<AutoCheckinTarget> = {},
): AutoCheckinTarget => ({
  id: 't-other',
  target: { kind: 'person', personId },
  enabled: true,
  includeIntimacy: true,
  explorationFocus: '',
  cadence: 'daily',
  ...over,
});

function runInput(
  fs: FileSystem,
  author: string,
  over: Partial<RunAutoCheckinsInput> = {},
): RunAutoCheckinsInput {
  return {
    fs,
    key,
    client: fakeClient(),
    apiKey: 'sk-x',
    model: 'claude-sonnet-4-6',
    personId: author,
    now,
    crisis: false,
    auto: true,
    ...over,
  };
}

describe('runAutoCheckins — self stream', () => {
  it('generates check-ins with provenance, including an unfiltered intimacy one when 18+ acked', async () => {
    const fs = memFileSystem();
    const author = await seedPerson(fs, { name: 'Ben', ack: true });
    await setAutoCheckinConfig(fs, key, author, { enabled: true, targets: [selfTarget()] });

    const result = await runAutoCheckins(runInput(fs, author));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A fresh stream tops up to MAX_PER_RUN (2): one intimacy + one topical.
    expect(result.created).toHaveLength(2);
    expect(result.created.some((c) => c.intent === 'intimacy')).toBe(true);

    // Each generated questionnaire carries auto-checkin provenance naming the stream.
    for (const c of result.created) {
      const q = await getQuestionnaire(fs, key, c.questionnaireId);
      expect(q?.autoCheckin?.targetId).toBe('t-self');
      expect(q?.recipient).toEqual({ kind: 'person', personId: author });
    }
    // The intimacy one is the unfiltered intimacy type.
    const intimacy = result.created.find((c) => c.intent === 'intimacy');
    const intimacyQ = intimacy ? await getQuestionnaire(fs, key, intimacy.questionnaireId) : null;
    expect(intimacyQ?.type).toBe('intimacy');
    expect(intimacyQ?.sensitivity).toBe('unfiltered');

    // The sends landed in the recipient's (own) inbox.
    const inbox = await listAssignments(fs, key, { recipientPersonId: author });
    expect(inbox).toHaveLength(2);
  });

  it('generates only non-intimate check-ins when the 18+ ack is absent', async () => {
    const fs = memFileSystem();
    const author = await seedPerson(fs, { name: 'Ben', ack: false });
    await setAutoCheckinConfig(fs, key, author, { enabled: true, targets: [selfTarget()] });

    const result = await runAutoCheckins(runInput(fs, author));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created.length).toBeGreaterThan(0);
    expect(result.created.some((c) => c.intent === 'intimacy')).toBe(false);
  });

  it('pauses everything during a crisis (no generation)', async () => {
    const fs = memFileSystem();
    const author = await seedPerson(fs, { name: 'Ben', ack: true });
    await setAutoCheckinConfig(fs, key, author, { enabled: true, targets: [selfTarget()] });

    const result = await runAutoCheckins(runInput(fs, author, { crisis: true }));
    expect(result).toMatchObject({ ok: false, reason: 'CRISIS' });
    expect(await listAssignments(fs, key, { recipientPersonId: author })).toHaveLength(0);
  });

  it('reports AI_OFF when there is no API key', async () => {
    const fs = memFileSystem();
    const author = await seedPerson(fs, { name: 'Ben', ack: true });
    await setAutoCheckinConfig(fs, key, author, { enabled: true, targets: [selfTarget()] });

    const result = await runAutoCheckins(runInput(fs, author, { apiKey: null }));
    expect(result).toMatchObject({ ok: false, reason: 'AI_OFF' });
  });

  it('is throttled on an auto run within 24h, but a manual Run now ignores the throttle', async () => {
    const fs = memFileSystem();
    const author = await seedPerson(fs, { name: 'Ben', ack: true });
    await setAutoCheckinConfig(fs, key, author, { enabled: true, targets: [selfTarget()] });
    const recent = new Date(now.getTime() - 60 * 60 * 1000).toISOString(); // 1h ago

    const auto = await runAutoCheckins(runInput(fs, author, { auto: true, lastCheckedAt: recent }));
    expect(auto).toMatchObject({ ok: false, reason: 'SKIPPED' });

    const manual = await runAutoCheckins(
      runInput(fs, author, { auto: false, lastCheckedAt: recent }),
    );
    expect(manual.ok).toBe(true);
    if (manual.ok) expect(manual.created.length).toBeGreaterThan(0);
  });

  it('reports BUDGET (and generates nothing) when the app budget is over', async () => {
    const fs = memFileSystem();
    const author = await seedPerson(fs, { name: 'Ben', ack: true });
    await setAutoCheckinConfig(fs, key, author, { enabled: true, targets: [selfTarget()] });
    await setAppBudget(fs, key, { limitUsd: 0.5, period: 'week', warnRatio: 0.8 });
    await recordUsage(fs, key, {
      id: 'u1',
      schemaVersion: 1,
      type: 'chat',
      personId: author,
      model: 'claude-sonnet-4-6',
      at: now.toISOString(),
      inputTokens: 0,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      costUsd: 1,
    });

    const result = await runAutoCheckins(runInput(fs, author));
    expect(result).toMatchObject({ ok: false, reason: 'BUDGET' });
    expect(await listAssignments(fs, key, { recipientPersonId: author })).toHaveLength(0);
  });

  it('skips a slot whose generated question is an invalid authoring-only type — no orphan def, run continues', async () => {
    const fs = memFileSystem();
    const author = await seedPerson(fs, { name: 'Ben', ack: true });
    await setAutoCheckinConfig(fs, key, author, { enabled: true, targets: [selfTarget()] });
    // A generated `matrix` has no rows → validateQuestionnaire rejects it → createAssignment would THROW.
    const matrixJson = JSON.stringify({
      title: 'Rate',
      questions: [{ type: 'matrix', prompt: 'Rate these areas' }],
    });

    const result = await runAutoCheckins(runInput(fs, author, { client: fakeClient(matrixJson) }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created).toHaveLength(0);
    expect(result.skipped.length).toBeGreaterThan(0);
    expect(result.skipped.every((s) => s.reason === 'generate:invalid')).toBe(true);
    // Pre-validation happens BEFORE saving, so no orphan questionnaire def is left behind, and no send exists.
    expect(await listQuestionnaires(fs, key)).toHaveLength(0);
    expect(await listAssignments(fs, key, { recipientPersonId: author })).toHaveLength(0);
  });

  it('skips when auto check-ins are off', async () => {
    const fs = memFileSystem();
    const author = await seedPerson(fs, { name: 'Ben', ack: true });
    await setAutoCheckinConfig(fs, key, author, { enabled: false, targets: [selfTarget()] });
    const result = await runAutoCheckins(runInput(fs, author));
    expect(result).toMatchObject({ ok: false, reason: 'SKIPPED' });
  });
});

describe('runAutoCheckins — other-person targets (intimacy gating §8.2)', () => {
  async function seedPair(
    relType: RelationshipType,
    opts: { targetAck?: boolean; targetBirthday?: string } = {},
  ) {
    const fs = memFileSystem();
    const author = await upsertPerson(fs, key, { displayName: 'Ben', isSubject: true, tags: [] });
    await acknowledgeAdult(fs, key, author.id);
    const target = await seedPerson(fs, {
      name: 'Angel',
      birthday: opts.targetBirthday ?? '1992-03-01',
      ack: opts.targetAck ?? true,
    });
    await upsertRelationship(fs, key, {
      fromPersonId: author.id,
      toPersonId: target,
      type: relType,
    });
    await setAutoCheckinConfig(fs, key, author.id, {
      enabled: true,
      targets: [personTarget(target)],
    });
    return { fs, author: author.id, target };
  }

  it('sends unfiltered intimacy to a PARTNER when both have acked 18+', async () => {
    const { fs, author, target } = await seedPair('partner');
    const result = await runAutoCheckins(runInput(fs, author));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created.every((c) => c.recipientPersonId === target)).toBe(true);
    expect(result.created.some((c) => c.intent === 'intimacy')).toBe(true);
    // The sends are addressed to the target, from the author.
    const sent = await listAssignments(fs, key, {
      senderPersonId: author,
      recipientPersonId: target,
    });
    expect(sent.length).toBeGreaterThan(0);
  });

  it('never sends intimacy to a NON-partner (still sends topical check-ins)', async () => {
    const { fs, author } = await seedPair('sibling');
    const result = await runAutoCheckins(runInput(fs, author));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created.length).toBeGreaterThan(0);
    expect(result.created.some((c) => c.intent === 'intimacy')).toBe(false);
  });

  it('does not send intimacy to a partner who has NOT acked 18+', async () => {
    const { fs, author } = await seedPair('partner', { targetAck: false });
    const result = await runAutoCheckins(runInput(fs, author));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created.some((c) => c.intent === 'intimacy')).toBe(false);
  });

  it('skips a minor other-target entirely (not-adult)', async () => {
    const { fs, author, target } = await seedPair('partner', { targetBirthday: '2015-01-01' });
    const result = await runAutoCheckins(runInput(fs, author));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created).toHaveLength(0);
    expect(result.skipped.some((s) => s.reason === 'not-adult')).toBe(true);
    expect(await listAssignments(fs, key, { recipientPersonId: target })).toHaveLength(0);
  });
});

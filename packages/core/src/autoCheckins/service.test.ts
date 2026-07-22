import { describe, expect, it } from 'vitest';
import { acknowledgeAdult } from '../conversations/guidanceService';
import { generateMasterKey } from '../crypto';
import type { ClaudeClient, FileSystem } from '../host';
import { memFileSystem } from '../host/memFileSystem';
import { upsertPerson } from '../people/peopleService';
import { upsertRelationship } from '../people/relationshipService';
import { createAssignment, listAssignments } from '../questionnaires/assignmentService';
import {
  getQuestionnaire,
  listQuestionnaires,
  saveQuestionnaire,
} from '../questionnaires/questionnaireService';
import type { AutoCheckinTarget, RelationshipType } from '../schemas';
import { setAppBudget } from '../usage/budgetService';
import { recordUsage } from '../usage/usageStore';
import { writeEncryptedJson } from '../vault';
import { setAutoCheckinBlock, setAutoCheckinConfig } from './prefsService';
import {
  listIncomingAutoCheckinStreams,
  runAutoCheckins,
  type RunAutoCheckinsInput,
} from './service';

const key = generateMasterKey();
const now = new Date('2026-07-15T12:00:00.000Z');

const GEN_JSON = JSON.stringify({
  title: 'A quick check-in',
  questions: [{ type: 'shortText', prompt: 'What has been on your mind lately?' }],
});

/** What the gap-finder returns — the ground a topical slot is built from. Since §27.5 there is NO generic
 *  fallback, so a fake that answers every call with `GEN_JSON` yields NO topical check-ins at all. The fake
 *  therefore has to answer the gap-finder call faithfully, exactly as the real one does. */
const SUGGEST_JSON = JSON.stringify([
  {
    title: 'How work has been landing',
    type: 'general',
    rationale: 'You mentioned a stretch at work but never unpacked how it felt.',
    questions: [{ type: 'shortText', prompt: 'What part of work has felt heaviest?' }],
  },
  {
    title: 'What rest looks like now',
    type: 'general',
    rationale: 'Nothing on record about how you actually recover.',
    questions: [{ type: 'shortText', prompt: 'What actually restores you?' }],
  },
]);

/** A gap-finder call is identified by its system prompt (the real client sees the same distinction). */
function isGapFinderCall(system: string): boolean {
  return system.includes('You suggest the NEXT questionnaires');
}

function fakeClient(text = GEN_JSON, suggestText = SUGGEST_JSON): ClaudeClient {
  const pick = (system: string | undefined): string =>
    isGapFinderCall(system ?? '') ? suggestText : text;
  return {
    send: (options) => Promise.resolve(pick(options.system)),
    stream: (options, onDelta) => {
      const out = pick(options.system);
      onDelta(out);
      return Promise.resolve({
        text: out,
        usage: { inputTokens: 10, outputTokens: 20, cacheWriteTokens: 0, cacheReadTokens: 0 },
      });
    },
  };
}

/**
 * The genuine "no new ground" state (§27.5) is the gap-finder's HONEST empty state — its pre-call
 * thin-context bail, or every suggestion being a covered-topic dup. Both carry NO `reason`. A literal `[]`
 * reply is NOT that: it classifies as a parse failure and is now reported distinctly (§27.6), so tests for
 * the empty path drive it with a thin-context person (`seedPerson({ thin: true })`) instead of a fake reply.
 */

/**
 * A client that RECORDS every user message it is sent, so a test can assert what actually reached the model
 * on the auto path. Without this the engine's prompt wiring is untestable here: the existing tests assert
 * only how many check-ins were created, so removing the `intimacyCoverage` argument entirely left the whole
 * suite green while the reported bug (#314) survived on the one path the reporter is actually on.
 */
function capturingClient(): { client: ClaudeClient; prompts: string[] } {
  const prompts: string[] = [];
  const base = fakeClient();
  return {
    prompts,
    client: {
      send: (options) => {
        prompts.push(options.messages.map((m) => m.content).join('\n'));
        return base.send(options);
      },
      stream: (options, onDelta) => {
        prompts.push(options.messages.map((m) => m.content).join('\n'));
        return base.stream(options, onDelta);
      },
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
  opts: { name: string; birthday?: string; ack?: boolean; thin?: boolean },
): Promise<string> {
  const person = await upsertPerson(fs, key, {
    displayName: opts.name,
    isSubject: true,
    tags: [],
    pronouns: 'they/them',
    // Substantive context so the gap-finder's PRE-CALL thin-context guard doesn't bail before the model is
    // ever asked. Without this a seeded person has only identity boilerplate, so since §27.5 (no filler) every
    // topical slot would be skipped and the test would be asserting the empty path by accident.
    ...(opts.thin ? {} : { notes: 'Has been stretched thin at work lately and sleeping badly.' }),
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

// #314 — the engine used to fill a topical slot with a generic brief whenever the gap-finder found nothing,
// so it produced check-ins simply because the toggle was on. There is no fallback now (08 §27.5).
describe('runAutoCheckins — no filler when there is no new ground (08 §27.5)', () => {
  it('SKIPS a topical slot when the gap-finder finds nothing, and records why', async () => {
    const fs = memFileSystem();
    // 18+ NOT acked, so there is no intimacy slot — every slot this run is topical. A `thin` person has no
    // substantive context, so the gap-finder honestly bails pre-call: the real "no new ground" state.
    const author = await seedPerson(fs, { name: 'Ben', thin: true });
    await setAutoCheckinConfig(fs, key, author, {
      enabled: true,
      targets: [selfTarget({ includeIntimacy: false })],
    });

    const result = await runAutoCheckins(runInput(fs, author));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Nothing sent — the correct output when there is nothing new to ask.
    expect(result.created).toHaveLength(0);
    expect(await listAssignments(fs, key, { recipientPersonId: author })).toHaveLength(0);
    // ...and the quiet run is inspectable rather than indistinguishable from a broken one.
    expect(result.skipped.some((s) => s.reason === 'no-new-topic')).toBe(true);
  });

  // THE regression guard for #314 on the path the reporter is actually on. Every other test here asserts
  // only how many check-ins were created, so dropping the `intimacyCoverage` argument to `generateQuestions`
  // left the entire suite green while the bug survived. Assert what reaches the MODEL, not just the counts.
  it('sends the coverage map to the model, so worked-through ground is off-limits (08 §27.3)', async () => {
    const fs = memFileSystem();
    const author = await seedPerson(fs, { name: 'Ben', ack: true });
    // Rate an oral act in onboarding, then work that ground through with SATURATION_ASKS intimacy sends.
    await writeEncryptedJson(
      fs,
      `people/${author}/intake/session.enc`,
      {
        id: `intake-${author}`,
        schemaVersion: 1,
        personId: author,
        status: 'complete',
        sections: [
          {
            id: 'intimacy',
            status: 'complete',
            restricted: true,
            messages: [],
            answers: {
              getSpecific: true,
              ownAnatomy: 'Cock (penis)',
              partnerAnatomy: ['Pussy (vulva)'],
              activities: { 'oral-receiving': 5 },
            },
          },
        ],
        startedAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
      key,
    );
    for (let i = 0; i < 3; i += 1) {
      const q = await saveQuestionnaire(fs, key, {
        title: `Oral check-in ${i + 1}`,
        type: 'intimacy',
        sensitivity: 'unfiltered',
        recipient: { kind: 'person', personId: author },
        questions: [
          {
            id: `q-${i}`,
            type: 'shortText',
            prompt: 'What do you like most about receiving oral?',
            required: false,
          },
        ],
      });
      await createAssignment(fs, key, {
        questionnaireId: q.id,
        senderPersonId: author,
        recipient: { kind: 'person', personId: author },
        channel: 'inApp',
        privacy: 'private',
        senderVisibleToRecipient: true,
      });
    }

    await setAutoCheckinConfig(fs, key, author, { enabled: true, targets: [selfTarget()] });
    const { client, prompts } = capturingClient();
    const result = await runAutoCheckins(runInput(fs, author, { client }));
    expect(result.ok).toBe(true);

    // The intimacy generation call is the one carrying the explicit framing.
    const intimacyPrompt = prompts.find((p) => p.includes('GROUND TO OPEN THIS TIME'));
    expect(intimacyPrompt).toBeDefined();
    // Oral is worked through → stated off-limits, and its rated act is NOT offered for deepening.
    expect(intimacyPrompt).toMatch(/ALREADY EXPLORED THOROUGHLY[^\n]*Oral/i);
    const goDeeperLine = (intimacyPrompt ?? '')
      .split('\n')
      .find((l) => l.includes('ALREADY RATED'));
    expect(goDeeperLine ?? '').not.toMatch(/oral/i);
  });

  it('records a gap-finder FAILURE distinctly, never as "no new ground" (§27.6)', async () => {
    // Honesty guard: with no intimacy slot, a failed gap-finder means `generateQuestions` is never called, so
    // nothing else can surface the failure. Reporting it as "nothing worth asking" would be a false statement
    // about the user's data — exactly what §27.6 exists to prevent.
    const fs = memFileSystem();
    const author = await seedPerson(fs, { name: 'Ben' });
    await setAutoCheckinConfig(fs, key, author, {
      enabled: true,
      targets: [selfTarget({ includeIntimacy: false })],
    });
    // A reply with no JSON at all → the gap-finder classifies it as a real failure, not an empty state.
    const client = fakeClient(GEN_JSON, 'I cannot help with that.');
    const result = await runAutoCheckins(runInput(fs, author, { client }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created).toHaveLength(0);
    expect(result.skipped.some((s) => s.reason.startsWith('gapfinder:'))).toBe(true);
    expect(result.skipped.some((s) => s.reason === 'no-new-topic')).toBe(false);
  });

  it('still sends the intimacy check-in when only the topical ground is exhausted', async () => {
    // The owner's #314 decision: intimacy FREQUENCY is unchanged. A run with no topical ground still
    // delivers the intimacy slot — it just no longer pads the rest with filler.
    const fs = memFileSystem();
    const author = await seedPerson(fs, { name: 'Ben', ack: true, thin: true });
    await setAutoCheckinConfig(fs, key, author, { enabled: true, targets: [selfTarget()] });

    const result = await runAutoCheckins(runInput(fs, author));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created).toHaveLength(1);
    expect(result.created[0]?.intent).toBe('intimacy');
    expect(result.skipped.some((s) => s.reason === 'no-new-topic')).toBe(true);
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

  it('a target who has BLOCKED the sender gets nothing — the hard opt-out gate (§3.3a)', async () => {
    const { fs, author, target } = await seedPair('partner');
    // The target turns the sender off.
    await setAutoCheckinBlock(fs, key, target, author, true);
    const blocked = await runAutoCheckins(runInput(fs, author));
    expect(blocked.ok).toBe(true);
    if (!blocked.ok) return;
    expect(blocked.created).toHaveLength(0);
    expect(blocked.skipped.some((s) => s.reason === 'blocked-by-recipient')).toBe(true);
    expect(await listAssignments(fs, key, { recipientPersonId: target })).toHaveLength(0);
    // Un-blocking re-enables the stream — check-ins flow again.
    await setAutoCheckinBlock(fs, key, target, author, false);
    const unblocked = await runAutoCheckins(runInput(fs, author));
    expect(unblocked.ok).toBe(true);
    if (!unblocked.ok) return;
    expect(unblocked.created.length).toBeGreaterThan(0);
  });
});

describe('listIncomingAutoCheckinStreams (§3.3a)', () => {
  it('lists only people who could actually send — a plain contact never appears (66)', async () => {
    const fs = memFileSystem();
    const me = await seedPerson(fs, { name: 'Me' });
    // A contact has no account and configures nothing, so listing them would be noise.
    await upsertPerson(fs, key, { displayName: 'Dentist', isSubject: false, tags: [] });
    const partner = await seedPerson(fs, { name: 'Partner' });

    const list = await listIncomingAutoCheckinStreams(fs, key, me);
    expect(list.map((s) => s.senderPersonId)).toEqual([partner]);
  });

  it('a pre-emptive block sticks before anyone has sent anything (66)', async () => {
    const fs = memFileSystem();
    const me = await seedPerson(fs, { name: 'Me' });
    const other = await seedPerson(fs, { name: 'Other' });

    // Turn them off with no stream configured at all — the case the old UI couldn't reach.
    await setAutoCheckinBlock(fs, key, me, other, true);
    const list = await listIncomingAutoCheckinStreams(fs, key, me);
    expect(list.find((s) => s.senderPersonId === other)).toMatchObject({
      active: false,
      blocked: true,
    });
  });

  it('shows the viewer only the enabled streams that target THEM, with the block state', async () => {
    const fs = memFileSystem();
    const ben = await upsertPerson(fs, key, { displayName: 'Ben', isSubject: true, tags: [] });
    const angel = await seedPerson(fs, { name: 'Angel', ack: true });
    const cara = await seedPerson(fs, { name: 'Cara', ack: true });
    await upsertRelationship(fs, key, {
      fromPersonId: ben.id,
      toPersonId: angel,
      type: 'partner',
    });
    // Ben targets Angel (enabled) AND Cara (disabled stream).
    await setAutoCheckinConfig(fs, key, ben.id, {
      enabled: true,
      targets: [
        { ...personTarget(angel), includeIntimacy: true },
        { ...personTarget(cara), enabled: false },
      ],
    });

    // Angel sees Ben's stream toward her (partner, includes intimacy), not-yet-blocked, and ACTIVE.
    const forAngel = await listIncomingAutoCheckinStreams(fs, key, angel);
    expect(forAngel[0]).toMatchObject({
      senderPersonId: ben.id,
      senderName: 'Ben',
      relationshipLabel: 'partner',
      active: true,
      includeIntimacy: true,
      blocked: false,
    });

    // 66 — everyone who COULD send is listed too, marked inactive, so the off-switch is reachable
    // BEFORE anything arrives. Without this the block was only discoverable once someone had already
    // started sending, which made it useless for one-off automated sends (a dream questionnaire).
    const cARA = forAngel.find((s) => s.senderPersonId === cara);
    expect(cARA).toMatchObject({ active: false, blocked: false });
    expect(cARA?.cadence).toBeUndefined(); // nothing scheduled ⇒ nothing to report

    // Cara's stream from Ben is DISABLED, so he shows as inactive rather than vanishing.
    const forCara = await listIncomingAutoCheckinStreams(fs, key, cara);
    expect(forCara.find((s) => s.senderPersonId === ben.id)?.active).toBe(false);
    // Nobody ever lists themselves.
    expect(
      (await listIncomingAutoCheckinStreams(fs, key, ben.id)).some(
        (s) => s.senderPersonId === ben.id,
      ),
    ).toBe(false);
    // Active senders lead the list.
    expect(forAngel[0]?.active).toBe(true);

    // After Angel blocks Ben, the stream still shows (so she can un-block) but marked blocked.
    await setAutoCheckinBlock(fs, key, angel, ben.id, true);
    const afterBlock = await listIncomingAutoCheckinStreams(fs, key, angel);
    expect(afterBlock[0]?.blocked).toBe(true);
  });
});

// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { memFileSystem } from '@selfos/core/host';
import { loadMasterKey } from '@selfos/core/crypto';
import { toBase64 } from '@selfos/core/encoding';
import type { ClaudeClient, FileSystem, SecretStore } from '@selfos/core/host';
import { ANTHROPIC_API_KEY_ID } from './channels';
import type { DeviceState } from './schemas';
import { createCoreBridge, type BridgeHost } from './coreBridge';

/**
 * Exercises the shared `createCoreBridge` factory the same way the iOS host will — against the real
 * `@selfos/core` services over an in-memory `BridgeHost` (memFileSystem + in-memory secrets/state). This
 * proves the platform-agnostic data path (setup, people, the settings scope split, capability gating +
 * super-admin bypass, chat streaming, invites) works without Electron.
 */
function makeHost(): {
  host: BridgeHost;
  fs: FileSystem;
  chunks: string[];
  device: () => DeviceState;
  deviceSettings: () => Record<string, unknown>;
} {
  const fs = memFileSystem();
  const secretMap = new Map<string, string>();
  const secrets: SecretStore = {
    get: (id) => Promise.resolve(secretMap.get(id) ?? null),
    set: (id, value) => {
      secretMap.set(id, value);
      return Promise.resolve();
    },
    has: (id) => Promise.resolve(secretMap.has(id)),
    clear: (id) => {
      secretMap.delete(id);
      return Promise.resolve();
    },
  };
  let device: DeviceState = { schemaVersion: 1, vaultPath: '/vault' };
  let deviceSettings: Record<string, unknown> = {};
  let superAdmin = false;
  const chunks: string[] = [];
  const claude: ClaudeClient = {
    send: () => Promise.resolve('ok'),
    stream: (_options, onDelta) => {
      onDelta('hi');
      return Promise.resolve({
        text: 'hi',
        usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
      });
    },
  };
  const ready = { phase: 'ready' as const, vaultPath: '/vault', hasSettings: true };
  const host: BridgeHost = {
    vaultAndKey: async () => {
      const key = await loadMasterKey(secrets);
      return key ? { fs, key } : null;
    },
    vaultPath: () => Promise.resolve(device.vaultPath),
    fileSystem: () => fs,
    secrets,
    claude,
    readDeviceState: () => Promise.resolve(device),
    updateDeviceState: (patch) => {
      device = { ...device, ...patch };
      return Promise.resolve(device);
    },
    readDeviceSettings: () => Promise.resolve(deviceSettings),
    writeDeviceSettings: (values) => {
      deviceSettings = values;
      return Promise.resolve();
    },
    activeModel: () => Promise.resolve('claude-sonnet-4-6'),
    isSuperAdminActive: () => superAdmin,
    setSuperAdminActive: (active) => {
      superAdmin = active;
    },
    appVersion: '1.2.3',
    emitChatChunk: (chunk) => chunks.push(chunk),
    getBootState: () => Promise.resolve(ready),
    refreshBootState: () => Promise.resolve(ready),
    selectVaultFolder: () => Promise.resolve(null),
    useVault: () => Promise.resolve(ready),
    getConflicts: () => Promise.resolve([]),
    revealVault: () => Promise.resolve(),
    onVaultChanged: () => () => {},
    onChatChunk: () => () => {},
  };
  return { host, fs, chunks, device: () => device, deviceSettings: () => deviceSettings };
}

async function freshOwner(): Promise<{
  host: ReturnType<typeof makeHost>;
  bridge: ReturnType<typeof createCoreBridge>;
  ownerId: string;
}> {
  const host = makeHost();
  const bridge = createCoreBridge(host.host);
  const { ownerId } = await bridge.householdSetup({
    ownerName: 'Ben',
    passphrase: 'secret-pass',
    pin: '1234',
  });
  return { host, bridge, ownerId };
}

describe('createCoreBridge', () => {
  it('forwards platform ops + the app version to the host', async () => {
    const host = makeHost();
    const bridge = createCoreBridge(host.host);
    expect(await bridge.getAppVersion()).toBe('1.2.3');
    expect((await bridge.getBootState()).phase).toBe('ready');
    expect(await bridge.getConflicts()).toEqual([]);
  });

  it('sets up a fresh household and reflects the owner in status + people', async () => {
    const { bridge, ownerId, host } = await freshOwner();
    const status = await bridge.householdStatus();
    expect(status).toMatchObject({
      vaultInitialized: true,
      hasMasterKey: true,
      hasOwner: true,
      activePersonId: ownerId,
    });
    const people = await bridge.peopleList();
    expect(people).toHaveLength(1);
    expect(people[0]?.displayName).toBe('Ben');
    expect((await bridge.getActivePerson())?.id).toBe(ownerId);
    expect(host.device().activePersonId).toBe(ownerId);
  });

  it('routes settings to the right scope (vault file vs device store)', async () => {
    const { bridge, host } = await freshOwner();
    await bridge.setSetting({ key: 'ai.model', value: 'claude-opus-4-8', scope: 'vault' });
    await bridge.setSetting({ key: 'window.x', value: 42, scope: 'device' });
    const all = await bridge.getSettings();
    expect(all.vault['ai.model']).toBe('claude-opus-4-8');
    expect(all.device['window.x']).toBe(42);
    // Scopes stay separate: a device setting never lands in the synced vault file.
    expect(all.vault['window.x']).toBeUndefined();
    expect(host.deviceSettings()['window.x']).toBe(42);
    await bridge.resetSetting({ key: 'ai.model', scope: 'vault' });
    expect((await bridge.getSettings()).vault['ai.model']).toBeUndefined();
  });

  it('enforces admin-only capabilities, with the super-admin bypass', async () => {
    const { bridge } = await freshOwner();
    // Owner has budgets.manage → setting the app cap sticks.
    await bridge.budgetSetApp({ limitUsd: 50, period: 'week', warnRatio: 0.8 });
    expect((await bridge.budgetGet()).app).toMatchObject({ limitUsd: 50 });

    // Switch to a member (no budgets.manage) → the write is silently denied.
    const member = await bridge.peopleSave({ displayName: 'Mara', isSubject: false, tags: [] });
    await bridge.accessSetAccount({ personId: member.id, roleId: 'member', pin: null });
    expect((await bridge.sessionSetActive({ personId: member.id })).ok).toBe(true);
    await bridge.budgetSetApp({ limitUsd: 999, period: 'week', warnRatio: 0.8 });
    expect((await bridge.budgetGet()).app).toMatchObject({ limitUsd: 50 });

    // Concealed super-admin unlock restores full access in the main/bridge process, not just the UI.
    expect(await bridge.superadminUnlock({ passphrase: 'secret-pass' })).toBe(true);
    await bridge.budgetSetApp({ limitUsd: 999, period: 'week', warnRatio: 0.8 });
    expect((await bridge.budgetGet()).app).toMatchObject({ limitUsd: 999 });
    await bridge.superadminLock();
    expect(await bridge.superadminUnlock({ passphrase: 'wrong' })).toBe(false);
  });

  it('streams a chat turn through emitChatChunk and persists the conversation', async () => {
    const { bridge, host } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    const result = await bridge.chatStream({ conversationId: 'c1', userText: 'hello' });
    expect(result.ok).toBe(true);
    expect(host.chunks).toContain('hi');
    expect(await bridge.conversationsList()).toHaveLength(1);
  });

  it('creates a member invite but refuses to wrap the master key for the owner', async () => {
    const { bridge, ownerId } = await freshOwner();
    const member = await bridge.peopleSave({ displayName: 'Mara', isSubject: false, tags: [] });
    await bridge.accessSetAccount({ personId: member.id, roleId: 'member', pin: null });
    const invite = await bridge.invitesCreate({ personId: member.id });
    expect(invite.code.length).toBeGreaterThan(0);
    expect(await bridge.invitesList({ personId: member.id })).toHaveLength(1);
    await expect(bridge.invitesCreate({ personId: ownerId })).rejects.toThrow();
  });

  it('authors, lists, validates, sends, and deletes a questionnaire (owner has the capability)', async () => {
    const { bridge, ownerId } = await freshOwner();
    const recipient = await bridge.peopleSave({
      displayName: 'Partner',
      isSubject: true,
      tags: [],
    });

    const saved = await bridge.questionnairesSave({
      title: 'Quick check-in',
      type: 'role-feedback',
      sensitivity: 'standard',
      questions: [{ id: 'q1', type: 'shortText', prompt: 'How are we doing?', required: true }],
    });
    expect(saved.version).toBe(1);
    expect((await bridge.questionnairesList()).map((q) => q.id)).toContain(saved.id);
    expect((await bridge.questionnairesGet(saved.id))?.title).toBe('Quick check-in');

    // validate surfaces structural problems (a choice question with no options).
    expect(
      await bridge.questionnairesValidate({
        title: 'bad',
        type: 'x',
        sensitivity: 'standard',
        questions: [{ id: 'q1', type: 'singleChoice', prompt: 'Pick', required: true }],
      }),
    ).not.toEqual([]);

    const assignment = await bridge.assignmentsCreate({
      questionnaireId: saved.id,
      recipientPersonId: recipient.id,
    });
    expect(assignment.status).toBe('sent');
    expect(assignment.senderPersonId).toBe(ownerId);
    expect(assignment.recipient).toEqual({ kind: 'person', personId: recipient.id });

    await bridge.questionnairesDelete(saved.id);
    expect(await bridge.questionnairesGet(saved.id)).toBeNull();
  });

  it('gates AI authoring on questionnaires.create and runs the metered path for the owner', async () => {
    const { bridge } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    const req = {
      type: 'role-feedback',
      sensitivity: 'standard' as const,
      includeAuthor: true,
      includeTarget: false,
      includeRelationship: false,
      existingPrompts: [],
    };
    // Owner with a key: the call runs past the gate + reaches Claude (the fake host returns non-JSON,
    // so it gracefully REFUSEs — proving the gate passed and the metered path executed).
    const gen = await bridge.questionnairesGenerate(req);
    expect(gen.ok).toBe(false);
    expect(gen.reason).toBe('REFUSED');

    // A Guest (no questionnaires.create) is denied before any Claude call.
    const guest = await bridge.peopleSave({ displayName: 'Guest', isSubject: false, tags: [] });
    await bridge.accessSetAccount({ personId: guest.id, roleId: 'guest', pin: null });
    expect((await bridge.sessionSetActive({ personId: guest.id })).ok).toBe(true);
    expect(await bridge.questionnairesGenerate(req)).toMatchObject({ ok: false, reason: 'DENIED' });
    expect(await bridge.gapfinderSuggest({})).toMatchObject({ ok: false, reason: 'DENIED' });
  });

  it('gates insights/analysis on viewResults; analyze with no answers returns NO_RESPONSE', async () => {
    const { bridge } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    const recipient = await bridge.peopleSave({
      displayName: 'Partner',
      isSubject: true,
      tags: [],
    });
    const q = await bridge.questionnairesSave({
      title: 'Q',
      type: 'role-feedback',
      sensitivity: 'standard',
      questions: [{ id: 'q1', type: 'shortText', prompt: 'Hi?', required: true }],
    });
    const a = await bridge.assignmentsCreate({
      questionnaireId: q.id,
      recipientPersonId: recipient.id,
    });

    // Owner has viewResults; with no submitted answers yet, analyze reports NO_RESPONSE (the live
    // trigger needs §13.5's answer flow), and the Memory list is empty.
    expect(await bridge.insightsAnalyze({ assignmentId: a.id })).toMatchObject({
      ok: false,
      reason: 'NO_RESPONSE',
    });
    expect(await bridge.insightsList()).toEqual([]);

    // A Guest (no viewResults) is denied.
    const guest = await bridge.peopleSave({ displayName: 'Guest', isSubject: false, tags: [] });
    await bridge.accessSetAccount({ personId: guest.id, roleId: 'guest', pin: null });
    expect((await bridge.sessionSetActive({ personId: guest.id })).ok).toBe(true);
    expect(await bridge.insightsList()).toEqual([]);
    expect(await bridge.insightsAnalyze({ assignmentId: a.id })).toMatchObject({
      ok: false,
      reason: 'DENIED',
    });
  });

  it('persists custom types for the picker, gated by questionnaires.create', async () => {
    const { bridge } = await freshOwner();
    expect(await bridge.questionnairesListTypes()).toEqual([]);
    expect(await bridge.questionnairesAddType('Affair recovery')).toEqual(['Affair recovery']);
    expect(await bridge.questionnairesListTypes()).toEqual(['Affair recovery']);

    // A Guest (no questionnaires.create) sees none and can't add one.
    const guest = await bridge.peopleSave({ displayName: 'Guest', isSubject: false, tags: [] });
    await bridge.accessSetAccount({ personId: guest.id, roleId: 'guest', pin: null });
    expect((await bridge.sessionSetActive({ personId: guest.id })).ok).toBe(true);
    expect(await bridge.questionnairesListTypes()).toEqual([]);
    await expect(bridge.questionnairesAddType('Sneaky')).rejects.toThrow(/permitted/);
  });

  it('stores, reads back, and deletes an encrypted question image; gated + validated', async () => {
    const { bridge } = await freshOwner();
    const base64 = toBase64(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]));

    const { imagePath, mime } = await bridge.questionnairesStoreImage({
      base64,
      mime: 'image/png',
    });
    expect(imagePath.startsWith('questionnaires/media/')).toBe(true);
    expect(mime).toBe('image/png');
    expect(await bridge.questionnairesGetImage(imagePath)).toBe(base64); // round-trips through encryption

    // Unsupported mime is rejected; an out-of-bounds read is refused.
    await expect(
      bridge.questionnairesStoreImage({ base64, mime: 'image/svg+xml' }),
    ).rejects.toThrow();
    expect(await bridge.questionnairesGetImage('config/recovery.enc')).toBeNull();

    await bridge.questionnairesDeleteImage(imagePath);
    expect(await bridge.questionnairesGetImage(imagePath)).toBeNull();

    // A Guest (no questionnaires.create) can't store and sees nothing.
    const guest = await bridge.peopleSave({ displayName: 'Guest', isSubject: false, tags: [] });
    await bridge.accessSetAccount({ personId: guest.id, roleId: 'guest', pin: null });
    expect((await bridge.sessionSetActive({ personId: guest.id })).ok).toBe(true);
    await expect(bridge.questionnairesStoreImage({ base64, mime: 'image/png' })).rejects.toThrow(
      /permitted/,
    );
  });

  it('denies questionnaire authoring to a person without questionnaires.create (a Guest)', async () => {
    const { bridge } = await freshOwner();
    const guest = await bridge.peopleSave({ displayName: 'Guest', isSubject: false, tags: [] });
    await bridge.accessSetAccount({ personId: guest.id, roleId: 'guest', pin: null });
    expect((await bridge.sessionSetActive({ personId: guest.id })).ok).toBe(true);
    await expect(
      bridge.questionnairesSave({ title: 'x', type: 'x', sensitivity: 'standard', questions: [] }),
    ).rejects.toThrow(/permitted/);
    expect(await bridge.questionnairesList()).toEqual([]);
  });

  it('rejects an in-app send to a non-existent recipient', async () => {
    const { bridge } = await freshOwner();
    const saved = await bridge.questionnairesSave({
      title: 'q',
      type: 'role-feedback',
      sensitivity: 'standard',
      questions: [{ id: 'q1', type: 'shortText', prompt: 'hi', required: true }],
    });
    await expect(
      bridge.assignmentsCreate({ questionnaireId: saved.id, recipientPersonId: 'ghost' }),
    ).rejects.toThrow(/Recipient not found/);
  });

  it('delivers a send to the recipient Inbox, answers + submits, and gates non-recipients', async () => {
    const { bridge } = await freshOwner();
    const recipient = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: recipient.id, roleId: 'member', pin: null });

    const q = await bridge.questionnairesSave({
      title: 'Weekly check-in',
      type: 'role-feedback',
      sensitivity: 'standard',
      questions: [{ id: 'q1', type: 'shortText', prompt: 'How are we doing?', required: true }],
    });
    const assignment = await bridge.assignmentsCreate({
      questionnaireId: q.id,
      recipientPersonId: recipient.id,
      privacy: 'private',
    });

    // As the owner (the SENDER, not the recipient): the Inbox is empty, the detail is gated to null,
    // and an answer mutation is refused — the recipient check lives in the bridge, not the renderer.
    expect(await bridge.assignmentsInbox()).toEqual([]);
    expect(await bridge.assignmentsGet(assignment.id)).toBeNull();
    await expect(
      bridge.assignmentsSubmit({
        assignmentId: assignment.id,
        answers: [{ questionId: 'q1', value: 'x' }],
      }),
    ).rejects.toThrow(/permitted/);

    // Switch to the recipient: it appears in their Inbox with who's asking + the privacy mode.
    await bridge.sessionSetActive({ personId: recipient.id });
    const inbox = await bridge.assignmentsInbox();
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({
      assignmentId: assignment.id,
      title: 'Weekly check-in',
      senderName: 'Ben',
      privacy: 'private',
      answerable: true,
      hasDraft: false,
    });

    // The detail (recipient-scoped) yields the frozen snapshot to answer.
    const detail = await bridge.assignmentsGet(assignment.id);
    expect(detail?.questionnaire.questions[0]?.prompt).toBe('How are we doing?');

    // Save a draft → inProgress + hasDraft; then submit → locked at submitted.
    await bridge.assignmentsSaveProgress({
      assignmentId: assignment.id,
      answers: [{ questionId: 'q1', value: 'partial' }],
    });
    expect((await bridge.assignmentsInbox())[0]).toMatchObject({
      status: 'inProgress',
      hasDraft: true,
    });
    await bridge.assignmentsSubmit({
      assignmentId: assignment.id,
      answers: [{ questionId: 'q1', value: 'Doing well' }],
    });
    expect((await bridge.assignmentsInbox())[0]).toMatchObject({
      status: 'submitted',
      answerable: false,
    });
  });

  it('Results expose Standard answers but never Private ones; Analyze flips the analyzed flag', async () => {
    const { host, bridge, ownerId } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    const recipient = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: recipient.id, roleId: 'member', pin: null });
    const q = await bridge.questionnairesSave({
      title: 'Weekly check-in',
      type: 'role-feedback',
      sensitivity: 'standard',
      questions: [{ id: 'q1', type: 'shortText', prompt: 'How are we doing?', required: true }],
    });
    const standard = await bridge.assignmentsCreate({
      questionnaireId: q.id,
      recipientPersonId: recipient.id,
      privacy: 'standard',
    });
    const priv = await bridge.assignmentsCreate({
      questionnaireId: q.id,
      recipientPersonId: recipient.id,
      privacy: 'private',
    });

    // The recipient submits to both sends.
    await bridge.sessionSetActive({ personId: recipient.id });
    await bridge.assignmentsSubmit({
      assignmentId: standard.id,
      answers: [{ questionId: 'q1', value: 'Doing great' }],
    });
    await bridge.assignmentsSubmit({
      assignmentId: priv.id,
      answers: [{ questionId: 'q1', value: 'A private answer' }],
    });

    // Back to the owner (the sender) — Results carries the Standard answers, never the Private ones.
    await bridge.sessionSetActive({ personId: ownerId, pin: '1234' });
    const before = await bridge.assignmentsResults(q.id);
    const standardResult = before.find((r) => r.assignmentId === standard.id);
    const privateResult = before.find((r) => r.assignmentId === priv.id);
    expect(standardResult?.answers).toEqual([
      { prompt: 'How are we doing?', answer: 'Doing great' },
    ]);
    expect(privateResult?.answers).toBeUndefined(); // the privacy boundary holds in the bridge
    expect(standardResult?.analyzed).toBe(false);

    // Analyze the Standard response (a Claude that returns valid analysis JSON) → an Insight is drafted.
    host.host.claude = {
      send: () => Promise.resolve('{}'),
      stream: (_options, onDelta) => {
        const json = JSON.stringify({
          summary: 'They want more time together.',
          facts: [{ text: 'Wants more date nights', shareable: true }],
          confidence: 'high',
        });
        onDelta(json);
        return Promise.resolve({
          text: json,
          usage: { inputTokens: 5, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    expect((await bridge.insightsAnalyze({ assignmentId: standard.id })).ok).toBe(true);
    const after = await bridge.assignmentsResults(q.id);
    expect(after.find((r) => r.assignmentId === standard.id)?.analyzed).toBe(true);

    // A member (no viewResults) can't read Results at all.
    await bridge.sessionSetActive({ personId: recipient.id });
    // recipient is a Member — Member HAS viewResults, so use a guest to prove the gate.
    const guest = await bridge.peopleSave({ displayName: 'Guest', isSubject: false, tags: [] });
    await bridge.accessSetAccount({ personId: guest.id, roleId: 'guest', pin: null });
    await bridge.sessionSetActive({ personId: guest.id });
    expect(await bridge.assignmentsResults(q.id)).toEqual([]);
  });

  it('deletion: owner purges any stage; a member-creator only deletes their own while unsent', async () => {
    const { bridge, ownerId } = await freshOwner();
    const member = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: member.id, roleId: 'member', pin: null });

    // The member creates a questionnaire (its creatorPersonId is stamped to them).
    await bridge.sessionSetActive({ personId: member.id });
    const q = await bridge.questionnairesSave({
      title: 'Member’s questionnaire',
      type: 'role-feedback',
      sensitivity: 'standard',
      questions: [{ id: 'q1', type: 'shortText', prompt: 'How?', required: true }],
    });
    expect((await bridge.questionnairesGet(q.id))?.creatorPersonId).toBe(member.id);

    // Sent → it now has a send, so the member-creator can no longer delete it.
    const assignment = await bridge.assignmentsCreate({
      questionnaireId: q.id,
      recipientPersonId: ownerId,
      privacy: 'standard',
    });
    await expect(bridge.questionnairesDelete(q.id)).rejects.toThrow(/permitted/);
    expect(await bridge.questionnairesGet(q.id)).not.toBeNull();

    // A different member can't delete someone else's questionnaire either.
    const other = await bridge.peopleSave({ displayName: 'Sam', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: other.id, roleId: 'member', pin: null });
    await bridge.sessionSetActive({ personId: other.id });
    await expect(bridge.questionnairesDelete(q.id)).rejects.toThrow(/permitted/);

    // The owner purges it at any stage — def + the send disappear.
    await bridge.sessionSetActive({ personId: ownerId, pin: '1234' });
    await bridge.questionnairesDelete(q.id);
    expect(await bridge.questionnairesGet(q.id)).toBeNull();
    // The send (its sender was the member) is gone too — verified from the member's Results scope.
    await bridge.sessionSetActive({ personId: member.id });
    expect(await bridge.assignmentsResults(q.id)).toEqual([]);

    // A member-creator CAN delete their own questionnaire while it's still unsent.
    const draft = await bridge.questionnairesSave({
      title: 'Unsent draft',
      type: 'role-feedback',
      sensitivity: 'standard',
      questions: [],
    });
    await bridge.questionnairesDelete(draft.id);
    expect(await bridge.questionnairesGet(draft.id)).toBeNull();
    void assignment;
  });

  it('trends include Private sends’ numeric values; per-send delete is sender/admin-only', async () => {
    const { bridge, ownerId } = await freshOwner();
    const mara = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: mara.id, roleId: 'member', pin: null });
    const q = await bridge.questionnairesSave({
      title: 'Connection check',
      type: 'role-feedback',
      sensitivity: 'standard',
      questions: [
        {
          id: 'c1',
          type: 'rating',
          prompt: 'How connected?',
          required: true,
          scale: { min: 1, max: 5 },
        },
      ],
    });
    // The owner sends a PRIVATE questionnaire to Mara twice (a re-ask).
    const sends: string[] = [];
    for (const value of [2, 4]) {
      const a = await bridge.assignmentsCreate({
        questionnaireId: q.id,
        recipientPersonId: mara.id,
        privacy: 'private',
      });
      sends.push(a.id);
      await bridge.sessionSetActive({ personId: mara.id });
      await bridge.assignmentsSubmit({
        assignmentId: a.id,
        answers: [{ questionId: 'c1', value }],
      });
      await bridge.sessionSetActive({ personId: ownerId, pin: '1234' });
    }

    // Per-send Results never expose the Private raw answers, but the TREND carries the numbers (the
    // Private disclosure is worded to allow this) — the central §13.5c privacy decision.
    expect((await bridge.assignmentsResults(q.id)).every((r) => r.answers === undefined)).toBe(
      true,
    );
    const trends = await bridge.assignmentsTrends(q.id);
    expect(trends[0]?.series[0]?.points.map((p) => p.value)).toEqual([2, 4]);

    // A non-sender member (with viewResults) cannot delete the owner's send.
    const sam = await bridge.peopleSave({ displayName: 'Sam', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: sam.id, roleId: 'member', pin: null });
    await bridge.sessionSetActive({ personId: sam.id });
    const target = sends[0] ?? '';
    await expect(bridge.assignmentsDelete(target)).rejects.toThrow(/permitted/);

    // The sender (owner) can.
    await bridge.sessionSetActive({ personId: ownerId, pin: '1234' });
    await bridge.assignmentsDelete(target);
    expect((await bridge.assignmentsTrends(q.id)).length).toBe(0); // one point left → no trend
  });
});

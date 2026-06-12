// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { memFileSystem } from '@selfos/core/host';
import { loadMasterKey } from '@selfos/core/crypto';
import { toBase64 } from '@selfos/core/encoding';
import type { ClaudeClient, FileSystem, SecretStore } from '@selfos/core/host';
import {
  contentKeyFromFragment,
  drain as kvDrain,
  openContent,
  purge as kvPurge,
  putMailbox as kvPut,
  respond as kvRespond,
  revoke as kvRevoke,
  sealResponse,
  unlock as kvUnlock,
  type RelayEnv,
} from '@selfos/core/relay';
import { ANTHROPIC_API_KEY_ID } from './channels';
import type { DeviceState } from './schemas';
import { createCoreBridge, type BridgeHost } from './coreBridge';

/** A fake `fetch` that simulates BOTH the Cloudflare REST API and the deployed relay Worker, over an
 *  in-memory KV — so the bridge's relay path round-trips end-to-end with no network/account. */
function makeRelayFetch(): typeof fetch {
  const store = new Map<string, string>();
  const env: RelayEnv = {
    kv: {
      get: (k) => Promise.resolve(store.get(k) ?? null),
      put: (k, v) => {
        store.set(k, v);
        return Promise.resolve();
      },
      delete: (k) => {
        store.delete(k);
        return Promise.resolve();
      },
    },
    nowMs: () => 1_000_000,
    nowIso: () => '2026-06-11T00:00:00.000Z',
  };
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status });
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = String(input);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    if (url.startsWith('https://api.cloudflare.com')) {
      if (url.endsWith('/user/tokens/verify'))
        return json({ success: true, result: { status: 'active' } });
      if (url.endsWith('/workers/subdomain'))
        return json({ success: true, result: { subdomain: 'acme' } });
      if (url.endsWith('/storage/kv/namespaces'))
        return json({ success: true, result: { id: 'kv1' } });
      return json({ success: true, result: {} });
    }
    const path = new URL(url).pathname;
    const ops: Record<string, () => Promise<{ status: number; json: unknown }>> = {
      '/api/admin/mailbox': () => kvPut(env, body),
      '/api/admin/drain': () => kvDrain(env, body),
      '/api/admin/purge': () => kvPurge(env, body),
      '/api/admin/revoke': () => kvRevoke(env, body),
      '/api/unlock': () => kvUnlock(env, body),
      '/api/respond': () => kvRespond(env, body),
    };
    const op = ops[path];
    if (!op) return json({ error: 'not found' }, 404);
    const result = await op();
    return json(result.json, result.status);
  }) as typeof fetch;
}

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
  dreamChunks: string[];
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
  const dreamChunks: string[] = [];
  const claude: ClaudeClient = {
    send: () => Promise.resolve('ok'),
    stream: (options, onDelta) => {
      const userText = options.messages.map((m) => m.content).join('\n');
      // Compatibility variant personalization → a JSON array of rewritten prompts (one per question).
      if (userText.includes('rewritten prompts')) {
        const prompts = [...userText.matchAll(/^\d+\.\s(.+)$/gm)].map((m) => `For you: ${m[1]}`);
        return Promise.resolve({
          text: JSON.stringify(prompts),
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      }
      // Compatibility alignment → a report object (items merge by canonicalId in the service).
      if (userText.includes('compatibility report JSON')) {
        return Promise.resolve({
          text: JSON.stringify({
            summary: 'Largely aligned, with one difference.',
            items: [],
            crisisFlag: false,
            facts: [{ text: 'They differ on pace.', shareable: true }],
          }),
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      }
      // Dream synthesis asks for a single JSON object — return a valid DreamAnalysis draft so the
      // synthesize path can parse it; every other turn just streams a short reply.
      const wantsJson = options.messages.some((m) => m.content.includes('JSON object'));
      const text = wantsJson
        ? JSON.stringify({
            summary: 'A dream of shifting rooms.',
            emotionalLandscape: 'Unsettled but curious.',
            wakingLifeConnections: 'Perhaps a sense of change at home.',
            notableImages: 'The rearranging house, framed as imaginative reflection.',
            reflectiveQuestions: ['What feels in flux right now?'],
            coachingPrompt: 'Notice one steady thing today.',
            tags: {
              emotions: ['unsettled'],
              symbols: ['house'],
              settings: ['childhood home'],
              themes: ['change'],
              people: [],
            },
            metrics: { emotionalIntensity: 0.4, valence: -0.1 },
            crisisFlag: false,
            distressSignal: false,
          })
        : 'hi';
      onDelta('hi');
      return Promise.resolve({
        text,
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
    relay: {
      fetch: makeRelayFetch(),
      loadBundle: () => Promise.resolve({ script: 'export default {}', version: '1' }),
      currentVersion: '1',
    },
    emitChatChunk: (chunk) => chunks.push(chunk),
    emitDreamChunk: (chunk) => dreamChunks.push(chunk),
    getBootState: () => Promise.resolve(ready),
    refreshBootState: () => Promise.resolve(ready),
    selectVaultFolder: () => Promise.resolve(null),
    useVault: () => Promise.resolve(ready),
    getConflicts: () => Promise.resolve([]),
    revealVault: () => Promise.resolve(),
    onVaultChanged: () => () => {},
    onChatChunk: () => () => {},
    onDreamChunk: () => () => {},
  };
  return {
    host,
    fs,
    chunks,
    dreamChunks,
    device: () => device,
    deviceSettings: () => deviceSettings,
  };
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

  it('compatibility: dual-send → align → report + Insight; senderSeesAll reveal is gated + audited', async () => {
    const { bridge, ownerId } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    const alex = await bridge.peopleSave({ displayName: 'Alex', isSubject: true, tags: [] });
    const bri = await bridge.peopleSave({ displayName: 'Bri', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: alex.id, roleId: 'member', pin: null });
    await bridge.accessSetAccount({ personId: bri.id, roleId: 'member', pin: null });

    const q = await bridge.questionnairesSave({
      title: 'Compatibility check',
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
      compatibility: { enabled: true, visibility: 'senderSeesAll' },
    });

    // Dual-send: AI personalizes a variant each, freezing two paired snapshots.
    const sent = await bridge.assignmentsCreateCompatibility({
      questionnaireId: q.id,
      recipientPersonIdA: alex.id,
      recipientPersonIdB: bri.id,
    });
    expect(sent.ok).toBe(true);

    const groups = await bridge.assignmentsCompatibility(q.id);
    expect(groups).toHaveLength(1);
    const group = groups[0]!;
    expect(group.members).toHaveLength(2);
    expect(group.visibility).toBe('senderSeesAll');
    expect(group.canReveal).toBe(false); // owner lacks readRaw → no reveal yet

    // Each recipient answers their own variant (the prompt is personalized but the id/canonicalId align).
    const answerAs = async (
      personId: string,
      assignmentId: string,
      value: number,
    ): Promise<void> => {
      await bridge.sessionSetActive({ personId });
      const detail = await bridge.assignmentsGet(assignmentId);
      const qid = detail!.questionnaire.questions[0]!.id;
      await bridge.assignmentsSubmit({ assignmentId, answers: [{ questionId: qid, value }] });
      await bridge.sessionSetActive({ personId: ownerId, pin: '1234' });
    };
    for (const m of group.members) {
      const personId = m.recipientName === 'Alex' ? alex.id : bri.id;
      await answerAs(personId, m.assignmentId, m.recipientName === 'Alex' ? 4 : 2);
    }

    // Both answered → align into a report + a draft Insight (subject = the sender, reviewed in Memory).
    const aligned = await bridge.assignmentsAlign(group.compatibilityGroupId);
    expect(aligned.ok).toBe(true);
    const after = (await bridge.assignmentsCompatibility(q.id))[0]!;
    expect(after.bothSubmitted).toBe(true);
    expect(after.report?.summary).toContain('aligned');
    expect(after.analyzed).toBe(true);
    expect((await bridge.insightsList()).some((i) => i.subjectPersonId === ownerId)).toBe(true);

    // Reveal is denied without readRaw (even for the sender) and writes nothing.
    const memberId = after.members[0]!.assignmentId;
    expect(await bridge.assignmentsRevealRaw(memberId)).toBeNull();
    expect(await bridge.auditList()).toEqual([]); // not super-admin → empty

    // Grant the Owner the explicit break-glass readRaw → the senderSeesAll reveal works + is audited.
    const access = await bridge.accessGet();
    const ownerRole = access.roles.find((r) => r.id === 'owner')!;
    await bridge.accessSaveRole({
      ...ownerRole,
      capabilities: { ...ownerRole.capabilities, 'questionnaires.readRaw': true },
    });
    const revealed = await bridge.assignmentsRevealRaw(memberId);
    expect(revealed).not.toBeNull();
    expect(revealed!.length).toBeGreaterThan(0);

    // The audit trail is visible only in super-admin mode; the entry records a non-super-admin reveal.
    expect(await bridge.auditList()).toEqual([]);
    await bridge.superadminUnlock({ passphrase: 'secret-pass' });
    const log = await bridge.auditList();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      assignmentId: memberId,
      viaSuperAdmin: false,
      action: 'revealRaw',
    });
    await bridge.superadminLock();

    // readRaw does NOT unlock reveal for a non-senderSeesAll group — even for the sender who holds it.
    const sharedQ = await bridge.questionnairesSave({
      title: 'Shared-report check',
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
      compatibility: { enabled: true, visibility: 'sharedReport' },
    });
    expect(
      (
        await bridge.assignmentsCreateCompatibility({
          questionnaireId: sharedQ.id,
          recipientPersonIdA: alex.id,
          recipientPersonIdB: bri.id,
        })
      ).ok,
    ).toBe(true);
    const sharedGroup = (await bridge.assignmentsCompatibility(sharedQ.id))[0]!;
    for (const m of sharedGroup.members) {
      await answerAs(m.recipientName === 'Alex' ? alex.id : bri.id, m.assignmentId, 3);
    }
    // The owner still holds readRaw, but the group is sharedReport → the reveal is refused.
    expect(await bridge.assignmentsRevealRaw(sharedGroup.members[0]!.assignmentId)).toBeNull();
  });

  it('super-admin can break-glass reveal ANY private send, writing an audit entry', async () => {
    const { bridge, ownerId } = await freshOwner();
    const mara = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: mara.id, roleId: 'member', pin: null });
    const q = await bridge.questionnairesSave({
      title: 'Private check-in',
      type: 'role-feedback',
      sensitivity: 'standard',
      questions: [{ id: 'c1', type: 'shortText', prompt: 'How are you?', required: true }],
    });
    const a = await bridge.assignmentsCreate({
      questionnaireId: q.id,
      recipientPersonId: mara.id,
      privacy: 'private',
    });
    await bridge.sessionSetActive({ personId: mara.id });
    await bridge.assignmentsSubmit({
      assignmentId: a.id,
      answers: [{ questionId: 'c1', value: 'Doing okay.' }],
    });
    await bridge.sessionSetActive({ personId: ownerId, pin: '1234' });

    // The owner (no readRaw, not super-admin) cannot reveal a plain private send.
    expect(await bridge.assignmentsRevealRaw(a.id)).toBeNull();

    // The concealed super-admin can — any send — and it's audited (viaSuperAdmin true).
    await bridge.superadminUnlock({ passphrase: 'secret-pass' });
    const revealed = await bridge.assignmentsRevealRaw(a.id);
    expect(revealed?.[0]?.answer).toBe('Doing okay.');
    const log = await bridge.auditList();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ assignmentId: a.id, viaSuperAdmin: true });
  });

  it('connects a relay, mints an external link, drains a response, and revoke-on-delete', async () => {
    const { host, bridge, ownerId } = await freshOwner();

    // Admin connect → deploys against the fake Cloudflare + persists config/relay.enc.
    const status = await bridge.relayConnect({ apiToken: 'cf-token', accountId: 'acct' });
    expect(status.configured).toBe(true);
    expect(status.endpointUrl).toContain('.workers.dev');
    // A non-admin (member) cannot connect.
    const member = await bridge.peopleSave({ displayName: 'Mo', isSubject: false, tags: [] });
    await bridge.accessSetAccount({ personId: member.id, roleId: 'member', pin: null });
    await bridge.sessionSetActive({ personId: member.id });
    await expect(bridge.relayConnect({ apiToken: 't', accountId: 'a' })).rejects.toThrow();
    await bridge.sessionSetActive({ personId: ownerId, pin: '1234' });

    const q = await bridge.questionnairesSave({
      title: 'Outside view',
      type: 'blind-spots',
      sensitivity: 'standard',
      questions: [{ id: 'a', type: 'shortText', prompt: 'How do I come across?', required: true }],
    });
    const { assignmentId, link, pin } = await bridge.assignmentsCreateRelayLink({
      questionnaireId: q.id,
      recipient: { kind: 'external', displayName: 'Alex' },
      senderVisibleToRecipient: true,
    });
    expect(pin).toMatch(/^\d{6}$/);

    // Simulate the recipient's browser hitting the relay Worker (same fake fetch / KV).
    const relayFetch = host.host.relay.fetch;
    const token = link.split('/q/')[1]?.split('#')[0] ?? '';
    const contentKey = contentKeyFromFragment(link.slice(link.indexOf('#')))!;
    const unlockRes = await relayFetch('https://relay/api/unlock', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, pin }),
    });
    const unlocked = (await unlockRes.json()) as {
      sealedContent: Parameters<typeof openContent>[0];
    };
    const content = await openContent(unlocked.sealedContent, contentKey);
    expect(content.questionnaire.title).toBe('Outside view');
    const sealed = await sealResponse(
      {
        kind: 'submit',
        answers: [{ questionId: 'a', value: 'Warmly' }],
        submittedAt: '2026-06-11T01:00:00.000Z',
      },
      content.publicKey,
    );
    const respondRes = await relayFetch('https://relay/api/respond', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, pin, sealed }),
    });
    expect(respondRes.status).toBe(200);

    // Drain into the vault; the external send becomes submitted, but a Private send hides raw answers.
    expect(await bridge.assignmentsDrain()).toEqual({ drained: 1, declined: 0 });
    const results = await bridge.assignmentsResults(q.id);
    expect(results.find((r) => r.assignmentId === assignmentId)?.status).toBe('submitted');
    expect(results.find((r) => r.assignmentId === assignmentId)?.answers).toBeUndefined();

    // Deleting the questionnaire revokes the relay link: the recipient can no longer unlock.
    await bridge.questionnairesDelete(q.id);
    const after = await relayFetch('https://relay/api/unlock', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, pin }),
    });
    expect(after.status).toBe(404);
  });

  it('saves/edits a dream, scoped to the active dreamer and gated by dreams.own', async () => {
    const { bridge, ownerId } = await freshOwner();

    const saved = await bridge.dreamSave({
      narrative: 'I was back in my childhood house, rooms rearranging.',
      title: 'The rearranging house',
      lucid: true,
      nightmare: false,
      tags: ['childhood home'],
      people: [{ name: 'Brother' }],
      sensitivity: 'standard',
      mood: 0.5,
      vividness: 5,
    });
    expect(saved.personId).toBe(ownerId);
    expect(saved.status).toBe('captured');
    expect((await bridge.dreamsList()).map((d) => d.id)).toEqual([saved.id]);
    expect((await bridge.dreamGet(saved.id))?.title).toBe('The rearranging house');

    // Editing preserves id + createdAt (main owns those).
    const edited = await bridge.dreamSave({
      id: saved.id,
      narrative: 'A clearer retelling.',
      lucid: false,
      nightmare: false,
      tags: [],
      people: [],
      sensitivity: 'standard',
    });
    expect(edited.id).toBe(saved.id);
    expect(edited.createdAt).toBe(saved.createdAt);
    expect((await bridge.dreamGet(saved.id))?.narrative).toBe('A clearer retelling.');

    // A member with dreams.own sees their OWN (empty) journal, never the owner's — per-person scoping.
    const member = await bridge.peopleSave({ displayName: 'Member', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: member.id, roleId: 'member', pin: null });
    expect((await bridge.sessionSetActive({ personId: member.id })).ok).toBe(true);
    expect(await bridge.dreamsList()).toEqual([]);
    expect(await bridge.dreamGet(saved.id)).toBeNull();

    // A Guest (no dreams.own) is denied entirely.
    const guest = await bridge.peopleSave({ displayName: 'Guest', isSubject: false, tags: [] });
    await bridge.accessSetAccount({ personId: guest.id, roleId: 'guest', pin: null });
    expect((await bridge.sessionSetActive({ personId: guest.id })).ok).toBe(true);
    expect(await bridge.dreamsList()).toEqual([]);
    await expect(
      bridge.dreamSave({
        narrative: 'x',
        lucid: false,
        nightmare: false,
        tags: [],
        people: [],
        sensitivity: 'standard',
      }),
    ).rejects.toThrow(/permitted/);
  });

  it('runs a guided dream turn, synthesizes, edits, approves, and removes from context', async () => {
    const { bridge, host } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    const dream = await bridge.dreamSave({
      narrative: 'I was back in my childhood house, rooms rearranging.',
      lucid: false,
      nightmare: false,
      tags: [],
      people: [],
      sensitivity: 'standard',
    });

    // A guided turn streams on the dream sink (not the chat sink) and persists the transcript UNDER the
    // dream — never in the Sessions list (12 §3.2).
    const turn = await bridge.dreamAnalyzeTurn({
      dreamId: dream.id,
      userText: 'It felt unsettling but oddly familiar.',
    });
    expect(turn.ok).toBe(true);
    expect(host.dreamChunks).toContain('hi');
    expect(host.chunks).toEqual([]); // the chat stream sink is untouched
    expect(await bridge.conversationsList()).toEqual([]); // not a Session
    expect((await bridge.dreamGetConversation(dream.id))?.messages.length).toBe(2);
    expect((await bridge.dreamGet(dream.id))?.status).toBe('analyzing');

    // Synthesize → a structured analysis; the dream flips to analyzed and the call is metered.
    const synth = await bridge.dreamSynthesize({ dreamId: dream.id });
    expect(synth.ok).toBe(true);
    if (!synth.ok) throw new Error('expected a synthesis');
    expect(synth.analysis.summary).toContain('shifting rooms');
    expect(synth.usage.type).toBe('dream.analyze');
    expect((await bridge.dreamGet(dream.id))?.status).toBe('analyzed');

    // Edits overwrite only the supplied section and mark the analysis edited.
    const edited = await bridge.dreamUpdateAnalysis({
      dreamId: dream.id,
      edits: { summary: 'My own retelling.' },
    });
    expect(edited?.summary).toBe('My own retelling.');
    expect(edited?.edited).toBe(true);

    // Approve → the analysis links an Insight (source 'dream') feeding the dreamer's coach.
    const approved = await bridge.dreamApprove({ dreamId: dream.id });
    expect(approved.ok).toBe(true);
    expect((await bridge.dreamGetAnalysis(dream.id))?.insightId).toBeTruthy();

    // Remove from context → the analysis stays but no longer feeds the coach.
    await bridge.dreamRemoveFromContext({ dreamId: dream.id });
    expect((await bridge.dreamGetAnalysis(dream.id))?.insightId).toBeUndefined();
  });

  it('refuses to approve a dream into context when dream memory is off', async () => {
    const { bridge } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    await bridge.setSetting({ key: 'dreams.memoryEnabled', value: false, scope: 'vault' });
    const dream = await bridge.dreamSave({
      narrative: 'A short dream.',
      lucid: false,
      nightmare: false,
      tags: [],
      people: [],
      sensitivity: 'standard',
    });
    // Synthesis still works (memory-off only blocks approval into context).
    expect((await bridge.dreamSynthesize({ dreamId: dream.id })).ok).toBe(true);
    expect(await bridge.dreamApprove({ dreamId: dream.id })).toMatchObject({
      ok: false,
      reason: 'MEMORY_DISABLED',
    });
    expect((await bridge.dreamGetAnalysis(dream.id))?.insightId).toBeUndefined();
  });

  it('denies dream analysis ops to a person without dreams.own', async () => {
    const { bridge } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    const guest = await bridge.peopleSave({ displayName: 'Guest', isSubject: false, tags: [] });
    await bridge.accessSetAccount({ personId: guest.id, roleId: 'guest', pin: null });
    expect((await bridge.sessionSetActive({ personId: guest.id })).ok).toBe(true);

    expect(await bridge.dreamAnalyzeTurn({ dreamId: 'd1', userText: 'hi' })).toMatchObject({
      ok: false,
      reason: 'ERROR',
    });
    expect(await bridge.dreamGetAnalysis('d1')).toBeNull();
    expect(await bridge.dreamGetConversation('d1')).toBeNull();
    expect(await bridge.dreamSynthesize({ dreamId: 'd1' })).toMatchObject({ ok: false });
    expect(await bridge.dreamUpdateAnalysis({ dreamId: 'd1', edits: { summary: 'x' } })).toBeNull();
  });

  it('computes pattern stats + generates/approves the cross-dream narrative, gated by dreams.own', async () => {
    const { bridge } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });

    const d1 = await bridge.dreamSave({
      narrative: 'I was back in my childhood house, rooms rearranging.',
      lucid: true,
      nightmare: false,
      tags: [],
      people: [{ name: 'Mara' }],
      sensitivity: 'standard',
    });
    await bridge.dreamSave({
      narrative: 'A storm at sea.',
      lucid: false,
      nightmare: true,
      tags: [],
      people: [],
      sensitivity: 'standard',
    });
    // Synthesize d1 → an analysis with structured tags (the fake claude returns a valid draft).
    expect((await bridge.dreamSynthesize({ dreamId: d1.id })).ok).toBe(true);

    const stats = await bridge.dreamPatternStats({ window: 'all' });
    expect(stats.dreamCount).toBe(2);
    expect(stats.analyzedCount).toBe(1);
    expect(stats.lucidCount).toBe(1);
    expect(stats.nightmareCount).toBe(1);
    expect(stats.symbols[0]).toEqual({ label: 'house', count: 1 });
    expect(stats.people.some((person) => person.label === 'Mara')).toBe(true);

    // Narrative: generate → cache → approve (links an Insight) → remove (unlinks it).
    expect((await bridge.dreamPatternNarrative()).ok).toBe(true);
    expect((await bridge.dreamGetPatternSummary())?.narrative).toBeTruthy();
    expect((await bridge.dreamApprovePatternNarrative()).ok).toBe(true);
    expect((await bridge.dreamGetPatternSummary())?.insightId).toBeTruthy();
    await bridge.dreamRemovePatternNarrative();
    expect((await bridge.dreamGetPatternSummary())?.insightId).toBeUndefined();

    // A Guest (no dreams.own) gets zeroed stats + a refused narrative.
    const guest = await bridge.peopleSave({ displayName: 'Guest', isSubject: false, tags: [] });
    await bridge.accessSetAccount({ personId: guest.id, roleId: 'guest', pin: null });
    expect((await bridge.sessionSetActive({ personId: guest.id })).ok).toBe(true);
    expect((await bridge.dreamPatternStats({ window: 'all' })).dreamCount).toBe(0);
    expect(await bridge.dreamPatternNarrative()).toMatchObject({ ok: false, reason: 'ERROR' });
  });

  it('shares an approved dream insight fact with a related person, gated by dreams.shareContext', async () => {
    const { bridge, ownerId } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });

    // A related person to share with.
    const partner = await bridge.peopleSave({ displayName: 'Partner', isSubject: true, tags: [] });
    await bridge.relationshipsSave({
      fromPersonId: ownerId,
      toPersonId: partner.id,
      type: 'partner',
    });

    // Create + approve a dream analysis so an Insight (with facts) exists.
    const dream = await bridge.dreamSave({
      narrative: 'A dream about my partner.',
      lucid: false,
      nightmare: false,
      tags: [],
      people: [],
      sensitivity: 'standard',
    });
    expect((await bridge.dreamSynthesize({ dreamId: dream.id })).ok).toBe(true);
    expect((await bridge.dreamApprove({ dreamId: dream.id })).ok).toBe(true);

    expect(await bridge.dreamShareTargets()).toEqual([{ id: partner.id, displayName: 'Partner' }]);
    const insight = await bridge.dreamGetInsight(dream.id);
    if (!insight) throw new Error('expected an approved insight');
    const factId = insight.facts[0]?.id;
    if (!factId) throw new Error('expected at least one fact');

    expect(
      await bridge.dreamSetFactShare({
        dreamId: dream.id,
        factId,
        withPersonId: partner.id,
        share: true,
      }),
    ).toEqual({ ok: true });
    const shared = await bridge.dreamGetInsight(dream.id);
    expect(shared?.facts.find((fact) => fact.id === factId)?.shareableWith).toEqual([partner.id]);

    // A Guest (no dreams.shareContext) is refused the share action.
    const guest = await bridge.peopleSave({ displayName: 'Guest', isSubject: false, tags: [] });
    await bridge.accessSetAccount({ personId: guest.id, roleId: 'guest', pin: null });
    expect((await bridge.sessionSetActive({ personId: guest.id })).ok).toBe(true);
    expect(
      await bridge.dreamSetFactShare({
        dreamId: dream.id,
        factId,
        withPersonId: partner.id,
        share: true,
      }),
    ).toMatchObject({ ok: false });
  });
});

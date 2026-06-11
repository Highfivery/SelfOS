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
});

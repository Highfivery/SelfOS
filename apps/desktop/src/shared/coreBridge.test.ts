// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { memFileSystem } from '@selfos/core/host';
import { loadMasterKey, MASTER_KEY_ID } from '@selfos/core/crypto';
import { toBase64 } from '@selfos/core/encoding';
import type { ClaudeClient, FileSystem, ImageClient, SecretStore } from '@selfos/core/host';
import {
  contentKeyFromFragment,
  drain as kvDrain,
  openContent,
  openResult,
  purge as kvPurge,
  putMailbox as kvPut,
  putResult as kvPutResult,
  respond as kvRespond,
  revoke as kvRevoke,
  sealResponse,
  unlock as kvUnlock,
  type RelayEnv,
} from '@selfos/core/relay';
import { saveInsight } from '@selfos/core/insights';
import { buildContext } from '@selfos/core/people';
import { ANTHROPIC_API_KEY_ID, OPENAI_API_KEY_ID } from './channels';
import { DeviceStateSchema } from './schemas';
import type { BootState, DeviceState, Insight } from './schemas';
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
      '/api/admin/result': () => kvPutResult(env, body),
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
  intakeChunks: string[];
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
  const chunks: string[] = [];
  const dreamChunks: string[] = [];
  const intakeChunks: string[] = [];
  const claude: ClaudeClient = {
    send: () => Promise.resolve('ok'),
    stream: (options, onDelta) => {
      const userText = options.messages.map((m) => m.content).join('\n');
      // Compatibility variant personalization → a JSON array of objects { prompt, options } (one per
      // question), each prompt tagged with the OTHER participant the user message names ("experience with
      // Y"), so a test can verify each person is asked ABOUT the other, not themselves (08 §17.12/§17.14e).
      if (userText.includes('answer about THEIR experience with')) {
        const about = /experience with (.+?):/.exec(userText)?.[1] ?? 'them';
        const prompts = [...userText.matchAll(/^\d+\.\s*PROMPT:\s*(.+)$/gm)].map((m) => m[1]);
        const optionLines = [...userText.matchAll(/^\s*OPTIONS:\s*(.+)$/gm)].map((m) => m[1]);
        const objs = prompts.map((p, i) => {
          let opts: string[] | null = null;
          const ol = optionLines[i];
          if (ol && ol.trim() !== 'none') {
            try {
              opts = JSON.parse(ol) as string[];
            } catch {
              opts = null;
            }
          }
          return { prompt: `${p} — about ${about}`, options: opts };
        });
        return Promise.resolve({
          text: JSON.stringify(objs),
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
      // Guided "Suggested for you" → return a JSON array of catalog ids (16 §3.4).
      if (userText.includes('exercises fit them') || userText.includes('starter exercises')) {
        return Promise.resolve({
          text: JSON.stringify([
            { guideId: 'values-clarification', reason: 'A grounding start.' },
            { guideId: 'grow-goal-setting', reason: 'You named a goal.' },
          ]),
          usage: { inputTokens: 5, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      }
      // Session analysis asks to "summarize this session" → return a valid SessionAnalysisDraft.
      if (userText.includes('summarize this session')) {
        return Promise.resolve({
          text: JSON.stringify({
            summary: 'Worked through a stressful deadline at work.',
            themes: ['work stress'],
            goals: ['Ask for an extension'],
            followUps: ['See how the ask went'],
            people: [],
            moodValence: -0.3,
            moodEnergy: 0.1,
            crisisFlag: false,
          }),
          usage: { inputTokens: 5, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 },
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
  const image: ImageClient = {
    generate: () =>
      Promise.resolve({ ok: true, image: { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' } }),
  };
  const ready = { phase: 'ready' as const, vaultPath: '/vault', hasSettings: true };
  // Derive boot state from the device pointer (like the real `computeBootState`) so unlink — which
  // clears `vaultPath` — recomputes to onboarding here, not a frozen `ready`.
  const bootFromDevice = (): BootState =>
    device.vaultPath
      ? { phase: 'ready', vaultPath: device.vaultPath, hasSettings: true }
      : { phase: 'onboarding', vaultPath: null, hasSettings: false };
  const host: BridgeHost = {
    vaultAndKey: async () => {
      const key = await loadMasterKey(secrets);
      return key ? { fs, key } : null;
    },
    vaultPath: () => Promise.resolve(device.vaultPath),
    fileSystem: () => fs,
    secrets,
    claude,
    image,
    readDeviceState: () => Promise.resolve(device),
    updateDeviceState: (patch) => {
      // Mirror the real stores: re-validate the merge so a cleared optional (vaultBookmark: undefined)
      // is dropped, keeping `device` a clean DeviceState.
      device = DeviceStateSchema.parse({ ...device, ...patch });
      return Promise.resolve(device);
    },
    readDeviceSettings: () => Promise.resolve(deviceSettings),
    writeDeviceSettings: (values) => {
      deviceSettings = values;
      return Promise.resolve();
    },
    activeModel: () => Promise.resolve('claude-sonnet-4-6'),
    appVersion: '1.2.3',
    platform: 'web',
    relay: {
      fetch: makeRelayFetch(),
      loadBundle: () => Promise.resolve({ script: 'export default {}', version: '1' }),
      currentVersion: '1',
    },
    emitChatChunk: (chunk) => chunks.push(chunk),
    emitDreamChunk: (chunk) => dreamChunks.push(chunk),
    emitIntakeChunk: (chunk) => intakeChunks.push(chunk),
    getBootState: () => Promise.resolve(bootFromDevice()),
    refreshBootState: () => Promise.resolve(bootFromDevice()),
    selectVaultFolder: () => Promise.resolve(null),
    useVault: () => Promise.resolve(ready),
    getConflicts: () => Promise.resolve([]),
    revealVault: () => Promise.resolve(),
    saveImageFile: (name) => Promise.resolve(`/tmp/${name}`),
    onVaultChanged: () => () => {},
    onChatChunk: () => () => {},
    onDreamChunk: () => () => {},
    onIntakeChunk: () => () => {},
  };
  return {
    host,
    fs,
    chunks,
    dreamChunks,
    intakeChunks,
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
  const { ownerId } = await bridge.householdSetup({ ownerName: 'Ben', pin: '1234' });
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

  it('household AI key: owner shares → member inherits; member cannot write the shared key (25)', async () => {
    const { bridge, ownerId, host } = await freshOwner();
    // Owner adds a device key and promotes it into the shared vault credentials.
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-owner-shared' });
    expect(await bridge.aiKeyStatus({ provider: 'anthropic' })).toMatchObject({
      hasDeviceOverride: true,
      source: 'device',
    });
    await bridge.aiShareDeviceKey({ provider: 'anthropic' });

    // On disk the shared key is ciphertext, never the raw key (decrypt-the-vault).
    const bytes = await host.fs.read('config/ai-credentials.enc');
    const raw = bytes && new TextDecoder().decode(bytes);
    expect(raw).toContain('aes-256-gcm');
    expect(raw).not.toContain('sk-owner-shared');

    // Simulate the member's own device: no device key, but the shared vault key is present.
    await bridge.secretClear({ id: ANTHROPIC_API_KEY_ID });
    const member = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: member.id, roleId: 'member', pin: null });
    await bridge.sessionSetActive({ personId: member.id });

    // The member inherits the shared key with zero setup (the headline guarantee).
    expect(await bridge.aiKeyStatus({ provider: 'anthropic' })).toEqual({
      hasSharedKey: true,
      hasDeviceOverride: false,
      resolvedReady: true,
      source: 'shared',
    });

    // The member cannot write or clear the shared household key (owner-gated in the bridge).
    await expect(
      bridge.aiSetSharedKey({ provider: 'anthropic', value: 'sk-evil' }),
    ).rejects.toThrow('Not permitted');
    await expect(bridge.aiClearSharedKey({ provider: 'anthropic' })).rejects.toThrow(
      'Not permitted',
    );

    // The owner can un-share; the file is deleted (no orphan ciphertext).
    await bridge.sessionSetActive({ personId: ownerId, pin: '1234' });
    await bridge.aiClearSharedKey({ provider: 'anthropic' });
    expect(await host.fs.read('config/ai-credentials.enc')).toBeNull();
  });

  it('settings trust boundary (26): a member cannot write vault/admin-only settings; the owner can', async () => {
    const { bridge, ownerId } = await freshOwner();
    // Owner may write a vault setting + an admin-only one.
    await bridge.setSetting({ key: 'ai.enabled', value: true, scope: 'vault' });
    await bridge.setSetting({ key: 'dreams.imageModel', value: 'gpt-image-2', scope: 'device' });

    // A member is rejected for ANY vault-scoped write and any admin-only write…
    const member = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: member.id, roleId: 'member', pin: null });
    await bridge.sessionSetActive({ personId: member.id });
    await expect(
      bridge.setSetting({ key: 'ai.enabled', value: false, scope: 'vault' }),
    ).rejects.toThrow('Not permitted');
    await expect(
      bridge.setSetting({ key: 'dreams.imageModel', value: 'gpt-image-1', scope: 'device' }),
    ).rejects.toThrow('Not permitted');
    await expect(bridge.resetSetting({ key: 'ai.enabled', scope: 'vault' })).rejects.toThrow(
      'Not permitted',
    );
    // …but a cosmetic, device-scoped write stays open to the member.
    await bridge.setSetting({ key: 'appearance.theme', value: 'dark', scope: 'device' });
    // The owner's vault setting is untouched by the rejected member writes.
    await bridge.sessionSetActive({ personId: ownerId, pin: '1234' });
    expect((await bridge.getSettings()).vault['ai.enabled']).toBe(true);
  });

  it('unlinkVault detaches the device — clears the master key + every vault pointer', async () => {
    const { bridge, host } = await freshOwner();
    // Precondition: a fully set-up, key-holding device with an active owner + a pending join.
    // Set a vaultBookmark too — the web/iOS vault pointer — to prove unlink clears it cross-platform.
    await host.host.updateDeviceState({
      pendingJoinPersonId: 'pending-x',
      vaultBookmark: 'bookmark-1',
    });
    expect(await host.host.secrets.has(MASTER_KEY_ID)).toBe(true);
    expect(host.device().vaultPath).toBe('/vault');
    expect(host.device().vaultBookmark).toBe('bookmark-1');
    expect(host.device().activePersonId).toBeTruthy();

    const boot = await bridge.unlinkVault();

    // The master key is gone (the critical step, §7.1) and every device pointer is cleared — both the
    // Electron `vaultPath` and the web/iOS `vaultBookmark`.
    expect(await host.host.secrets.has(MASTER_KEY_ID)).toBe(false);
    expect(host.device().vaultPath).toBeNull();
    expect(host.device().vaultBookmark).toBeUndefined();
    expect(host.device().activePersonId).toBeNull();
    expect(host.device().pendingJoinPersonId).toBeNull();
    // Boot recomputes to onboarding ("Choose a folder").
    expect(boot).toEqual({ phase: 'onboarding', vaultPath: null, hasSettings: false });
  });

  it('unlinkVault leaves the vault on disk byte-untouched (no data loss)', async () => {
    const { bridge, host } = await freshOwner();
    const recoveryBefore = await host.fs.read('config/recovery.enc');
    const peopleBefore = await host.fs.list('people');
    expect(recoveryBefore).not.toBeNull();
    expect(peopleBefore.length).toBeGreaterThan(0);

    await bridge.unlinkVault();

    // The vault folder is identical — recovery bundle byte-for-byte, people dir intact — so the old
    // vault stays re-linkable via its recovery phrase.
    expect(await host.fs.read('config/recovery.enc')).toEqual(recoveryBefore);
    expect(await host.fs.list('people')).toEqual(peopleBefore);
  });

  it('unlinkVault is idempotent when already detached', async () => {
    const host = makeHost();
    const bridge = createCoreBridge(host.host);
    await host.host.updateDeviceState({ vaultPath: null });
    // No key, no vault — unlink must not throw and still yields onboarding.
    const boot = await bridge.unlinkVault();
    expect(boot.phase).toBe('onboarding');
    expect(await host.host.secrets.has(MASTER_KEY_ID)).toBe(false);
  });

  it('unlinkVault clears the master key BEFORE the device write — a write failure stays recoverable', async () => {
    // §6.1: the key is cleared first, so even if the device-state write fails afterward, the worst
    // outcome is "no key, old path still recorded" — which the gate routes to Setup/Unlock, never a
    // stale key against the wrong vault.
    const base = await freshOwner();
    expect(await base.host.host.secrets.has(MASTER_KEY_ID)).toBe(true);
    const failingHost: BridgeHost = {
      ...base.host.host,
      updateDeviceState: () => Promise.reject(new Error('disk full')),
    };
    const bridge = createCoreBridge(failingHost);
    await expect(bridge.unlinkVault()).rejects.toThrow('disk full');
    // The shared `secrets` store is the same instance — the key is already gone despite the write fault.
    expect(await base.host.host.secrets.has(MASTER_KEY_ID)).toBe(false);
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

  it('enforces admin-only capabilities; the Owner is the full-access role', async () => {
    const { bridge, ownerId } = await freshOwner();
    // Owner has budgets.manage → setting the app cap sticks.
    await bridge.budgetSetApp({ limitUsd: 50, period: 'week', warnRatio: 0.8 });
    expect((await bridge.budgetGet()).app).toMatchObject({ limitUsd: 50 });

    // The Owner switches to a member with no PIN (god-mode switching). The member lacks budgets.manage →
    // the write is silently denied (the bridge is the trust boundary).
    const member = await bridge.peopleSave({ displayName: 'Mara', isSubject: false, tags: [] });
    await bridge.accessSetAccount({ personId: member.id, roleId: 'member', pin: null });
    expect((await bridge.sessionSetActive({ personId: member.id })).ok).toBe(true);
    await bridge.budgetSetApp({ limitUsd: 999, period: 'week', warnRatio: 0.8 });
    expect((await bridge.budgetGet()).app).toMatchObject({ limitUsd: 50 });

    // Back to the Owner (returning to the owner DOES need the owner PIN) → full access restored.
    expect((await bridge.sessionSetActive({ personId: ownerId, pin: '1234' })).ok).toBe(true);
    await bridge.budgetSetApp({ limitUsd: 999, period: 'week', warnRatio: 0.8 });
    expect((await bridge.budgetGet()).app).toMatchObject({ limitUsd: 999 });
  });

  it('lets the Owner switch to any person with no PIN, but requires the PIN to return to the Owner', async () => {
    const { bridge, ownerId } = await freshOwner();
    // A created subject auto-gets a Member login; the Owner switches in with no PIN.
    const member = await bridge.peopleSave({ displayName: 'Quinn', isSubject: true, tags: [] });
    expect((await bridge.sessionSetActive({ personId: member.id })).ok).toBe(true);
    // The member (not the owner) cannot return to the owner without the owner's PIN.
    expect(await bridge.sessionSetActive({ personId: ownerId })).toMatchObject({
      ok: false,
      reason: 'WRONG_PIN',
    });
    expect((await bridge.sessionSetActive({ personId: ownerId, pin: '1234' })).ok).toBe(true);
  });

  it('streams a chat turn through emitChatChunk and persists the conversation', async () => {
    const { bridge, host } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    const result = await bridge.chatStream({ conversationId: 'c1', userText: 'hello' });
    expect(result.ok).toBe(true);
    expect(host.chunks).toContain('hi');
    expect(await bridge.conversationsList()).toHaveLength(1);
    // A fresh session lists as in-progress.
    expect((await bridge.conversationsList())[0]?.status).toBe('inProgress');
  });

  it('sets session status, summarizes on complete, and feeds a later session', async () => {
    const { bridge } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    await bridge.chatStream({ conversationId: 'c1', userText: 'I had a hard day' });

    // Put it on hold, then complete it.
    const onHold = await bridge.sessionsSetStatus({ conversationId: 'c1', status: 'onHold' });
    expect(onHold?.status).toBe('onHold');

    const summary = await bridge.sessionsEndAndSummarize({ conversationId: 'c1' });
    expect(summary.ok).toBe(true);
    if (!summary.ok) return;
    expect(summary.insight.source).toBe('session');
    expect(summary.insight.approved).toBe(true);
    expect(summary.insight.metrics?.moodValence).toBeCloseTo(-0.3);

    // The conversation is now complete with the linked insight.
    const list = await bridge.conversationsList();
    expect(list.find((c) => c.id === 'c1')?.status).toBe('complete');

    // The auto-approved Session Insight surfaces in the Memory list + grounds a later session.
    const insights = await bridge.insightsList();
    expect(insights.some((i) => i.source === 'session')).toBe(true);
    const turn = await bridge.chatStream({ conversationId: 'c2', userText: 'continuing' });
    expect(turn.ok).toBe(true);
  });

  it('session analysis emits a profile-update suggestion; accept writes the field, dismiss is own-scoped', async () => {
    const { bridge, host, ownerId } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    // A claude that streams a chat reply, then returns a session analysis proposing an occupation change.
    host.host.claude = {
      send: () => Promise.resolve(''),
      stream: (options, onDelta) => {
        const last = options.messages.at(-1)?.content ?? '';
        if (last.includes('summarize this session')) {
          const text = JSON.stringify({
            summary: 'A check-in about a new job.',
            themes: ['work'],
            goals: [],
            followUps: [],
            people: [],
            moodValence: 0.2,
            moodEnergy: 0.1,
            profileSuggestions: [
              {
                field: 'occupation',
                observed: 'teacher',
                current: 'nurse',
                rationale: 'started teaching',
              },
            ],
          });
          return Promise.resolve({
            text,
            usage: { inputTokens: 5, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 },
          });
        }
        onDelta('ok');
        return Promise.resolve({
          text: 'ok',
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    await bridge.peopleSave({
      id: ownerId,
      displayName: 'Alex',
      isSubject: true,
      tags: [],
      occupation: 'nurse',
    });
    await bridge.chatStream({ conversationId: 'c1', userText: 'I started a teaching job' });
    expect((await bridge.sessionsEndAndSummarize({ conversationId: 'c1' })).ok).toBe(true);

    // The suggestion surfaces (own-scoped); accepting writes the profile field.
    const pending = await bridge.profileSuggestions();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ field: 'occupation', observed: 'teacher' });
    const after = await bridge.profileAcceptSuggestion(pending[0]!.id);
    expect(after).toHaveLength(0);
    expect((await bridge.peopleList()).find((p) => p.id === ownerId)?.occupation).toBe('teacher');

    // A different person sees only their OWN suggestions (none) — own-scoped in the bridge.
    const mara = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });
    await bridge.sessionSetActive({ personId: mara.id });
    expect(await bridge.profileSuggestions()).toHaveLength(0);
  });

  it('refuses to summarize when session memory is disabled', async () => {
    const { bridge } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    await bridge.chatStream({ conversationId: 'c1', userText: 'hello' });
    await bridge.setSetting({ key: 'sessions.memoryEnabled', value: false, scope: 'vault' });
    const result = await bridge.sessionsEndAndSummarize({ conversationId: 'c1' });
    expect(result).toMatchObject({ ok: false, reason: 'MEMORY_DISABLED' });
  });

  it('returns per-session $ to an admin but only a budget bar to a member', async () => {
    const { bridge } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });

    // The owner (admin) sees the dollar figure + a budget ratio.
    await bridge.chatStream({ conversationId: 'c1', userText: 'hello' });
    const adminCosts = await bridge.usageSessionCosts();
    expect(adminCosts['c1']?.costUsd).toBeGreaterThanOrEqual(0);
    expect(typeof adminCosts['c1']?.costUsd).toBe('number');
    expect(adminCosts['c1']?.tokens).toBeGreaterThan(0);
    expect(adminCosts['c1']?.budgetRatio).toBeGreaterThanOrEqual(0);

    // A member with their own session sees tokens + a budget ratio, but NEVER a $ figure (bridge-redacted).
    const member = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: member.id, roleId: 'member', pin: null });
    expect((await bridge.sessionSetActive({ personId: member.id })).ok).toBe(true);
    await bridge.chatStream({ conversationId: 'm1', userText: 'hi from member' });
    const memberCosts = await bridge.usageSessionCosts();
    expect(memberCosts['m1']?.tokens).toBeGreaterThan(0);
    expect(memberCosts['m1']?.costUsd).toBeUndefined();
    expect(memberCosts['m1']?.budgetRatio).toBeGreaterThanOrEqual(0);
    // A member can't see another person's sessions in their own rollup.
    expect(memberCosts['c1']).toBeUndefined();
  });

  it('returns budget $ to an admin but only a ratio to a member (budgetStatus redaction)', async () => {
    const { bridge } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    await bridge.chatStream({ conversationId: 'c1', userText: 'hello' });

    // The owner (admin) sees the dollar figures + the ratio for their own budget.
    const adminStatus = await bridge.budgetStatus();
    expect(typeof adminStatus.person.spentUsd).toBe('number');
    expect(adminStatus.person.limitUsd).toBe(10); // the $10/week default
    expect(adminStatus.person.budgetRatio).toBeGreaterThanOrEqual(0);
    expect(adminStatus.person.budgetRatio).toBeLessThanOrEqual(1);

    // A member sees their own ratio + state, but NEVER the dollars (bridge-redacted), and nothing
    // about the household app budget (the Everyone scope is admin-only).
    const member = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: member.id, roleId: 'member', pin: null });
    expect((await bridge.sessionSetActive({ personId: member.id })).ok).toBe(true);
    await bridge.chatStream({ conversationId: 'm1', userText: 'hi from member' });
    const memberStatus = await bridge.budgetStatus();
    expect(memberStatus.person.spentUsd).toBeUndefined();
    expect(memberStatus.person.limitUsd).toBeUndefined();
    expect(memberStatus.person.budgetRatio).toBeGreaterThanOrEqual(0);
    expect(memberStatus.person.state).not.toBe('none'); // they have the default budget
    // The app (household) budget carries no spend for a member.
    expect(memberStatus.app.spentUsd ?? 0).toBe(0);
    expect(memberStatus.app.state).toBe('none');
  });

  it('denies session status + summarize to a person without sessions.own', async () => {
    const { bridge } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    await bridge.chatStream({ conversationId: 'c1', userText: 'hello' });
    const guest = await bridge.peopleSave({ displayName: 'Guest', isSubject: false, tags: [] });
    await bridge.accessSetAccount({ personId: guest.id, roleId: 'guest', pin: null });
    expect((await bridge.sessionSetActive({ personId: guest.id })).ok).toBe(true);
    expect(await bridge.sessionsSetStatus({ conversationId: 'c1', status: 'complete' })).toBeNull();
    expect(await bridge.sessionsEndAndSummarize({ conversationId: 'c1' })).toMatchObject({
      ok: false,
      reason: 'ERROR',
    });
  });

  it('starts a guided session (stamps guideId + opener), suggests (cached), and gates by sessions.own', async () => {
    const { bridge } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });

    // Start a guided chat: a conversation is created with the guideId + a seeded opener.
    const started = await bridge.sessionsStartGuided({ guideId: 'cbt-thought-record' });
    expect(started).not.toBeNull();
    const conversation = await bridge.conversationsGet(started!.conversationId);
    expect(conversation?.guideId).toBe('cbt-thought-record');
    expect(conversation?.guideStep).toBe(0);
    expect(conversation?.messages).toHaveLength(1);
    const list = await bridge.conversationsList();
    expect(list.find((c) => c.id === started!.conversationId)?.guideId).toBe('cbt-thought-record');

    // An unknown id is rejected.
    expect(await bridge.sessionsStartGuided({ guideId: 'nope' })).toBeNull();

    // Suggestions: generate (spends), then the launcher's no-spend read returns the cache.
    const suggest = await bridge.guidedSuggest();
    expect(suggest.ok).toBe(true);
    if (suggest.ok) expect(suggest.suggestions.length).toBeGreaterThan(0);
    const state = await bridge.guidedGetState();
    expect(state.cache?.suggestions.length).toBeGreaterThan(0);
    expect(state.adultAcknowledged).toBe(false);

    // 18+ ack flips the per-person flag.
    const acked = await bridge.guidedAcknowledgeAdult();
    expect(acked.adultAcknowledged).toBe(true);

    // A guest (no sessions.own) is denied all guided ops.
    const guest = await bridge.peopleSave({ displayName: 'Guest', isSubject: false, tags: [] });
    await bridge.accessSetAccount({ personId: guest.id, roleId: 'guest', pin: null });
    await bridge.sessionSetActive({ personId: guest.id });
    expect(await bridge.sessionsStartGuided({ guideId: 'reflective-session' })).toBeNull();
    expect(await bridge.guidedGetState()).toEqual({ cache: null, adultAcknowledged: false });
    expect(await bridge.guidedSuggest()).toMatchObject({ ok: false, reason: 'DENIED' });
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
      recipient: { kind: 'person', personId: recipient.id },
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

    const { assignment } = await bridge.assignmentsCreate({ questionnaireId: saved.id });
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

  it('feeds the bound recipient’s history into generation but never returns it to the renderer (§17.4)', async () => {
    const { host, bridge } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    const mara = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });

    // A questionnaire ALREADY asked of Mara — a distinctive prompt the de-dup grounding must surface.
    const prior = await bridge.questionnairesSave({
      title: 'Earlier',
      type: 'role-feedback',
      sensitivity: 'standard',
      recipient: { kind: 'person', personId: mara.id },
      questions: [
        { id: 'p1', type: 'shortText', prompt: 'What is your secret codeword?', required: true },
      ],
    });
    await bridge.assignmentsCreate({ questionnaireId: prior.id });

    // Capture exactly what reaches the model.
    let sentUserText = '';
    host.host.claude = {
      send: () => Promise.resolve(''),
      stream: (options, onDelta) => {
        sentUserText = options.messages.map((m) => m.content).join('\n');
        const json = JSON.stringify({
          title: 'X',
          questions: [{ type: 'yesNo', prompt: 'A fresh question?', required: true }],
        });
        onDelta(json);
        return Promise.resolve({
          text: json,
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };

    const result = await bridge.questionnairesGenerate({
      type: 'role-feedback',
      sensitivity: 'standard',
      existingPrompts: [],
      recipientPersonId: mara.id,
    });

    // The recipient's prior prompt reached the MODEL as avoid-only grounding, with the safety clause…
    expect(sentUserText).toContain('What is your secret codeword?');
    expect(sentUserText).toMatch(/never quote, restate, reference/i);
    // …but it is NEVER returned to the renderer — the author only gets the generated questions.
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result.questions)).not.toContain('secret codeword');
    expect(JSON.stringify(result)).not.toContain('secret codeword');
  });

  it('gates analyze on viewResults + memory list on memory.own; analyze with no answers returns NO_RESPONSE', async () => {
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
      recipient: { kind: 'person', personId: recipient.id },
      questions: [{ id: 'q1', type: 'shortText', prompt: 'Hi?', required: true }],
    });
    const { assignment: a } = await bridge.assignmentsCreate({ questionnaireId: q.id });

    // Owner has viewResults + memory.own; with no submitted answers yet, analyze reports NO_RESPONSE (the
    // live trigger needs §13.5's answer flow), and the Memory list is empty.
    expect(await bridge.insightsAnalyze({ assignmentId: a.id })).toMatchObject({
      ok: false,
      reason: 'NO_RESPONSE',
    });
    expect(await bridge.insightsList()).toEqual([]);

    // A Guest (no memory.own, no viewResults) is denied both.
    const guest = await bridge.peopleSave({ displayName: 'Guest', isSubject: false, tags: [] });
    await bridge.accessSetAccount({ personId: guest.id, roleId: 'guest', pin: null });
    expect((await bridge.sessionSetActive({ personId: guest.id })).ok).toBe(true);
    expect(await bridge.insightsList()).toEqual([]);
    expect(await bridge.insightsAnalyze({ assignmentId: a.id })).toMatchObject({
      ok: false,
      reason: 'DENIED',
    });
  });

  it('Memory is per-person scoped: member A never sees member B insights; own + relationships only (spec 20 §1.1/§5.1)', async () => {
    const { bridge, host, ownerId } = await freshOwner();
    const ctx = (await host.host.vaultAndKey())!;

    // Two members, A and B, each with their own onboarding-portrait Insight written directly to the vault.
    const a = await bridge.peopleSave({ displayName: 'Ana', isSubject: true, tags: [] });
    const b = await bridge.peopleSave({ displayName: 'Bo', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: a.id, roleId: 'member', pin: null });
    await bridge.accessSetAccount({ personId: b.id, roleId: 'member', pin: null });

    const portrait = (subject: string, name: string): Insight => ({
      id: `intake-${subject}`,
      schemaVersion: 1,
      source: 'intake',
      subjectPersonId: subject,
      summary: `${name}'s onboarding portrait`,
      facts: [{ id: 'f1', text: `${name} secret fact`, shareable: false }],
      confidence: 'medium',
      categories: [],
      approved: true,
      provenance: { intakeSection: 'your-story', at: new Date().toISOString() },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await saveInsight(ctx.fs, ctx.key, portrait(a.id, 'Ana'));
    await saveInsight(ctx.fs, ctx.key, portrait(b.id, 'Bo'));

    // Signed in as A: Memory shows ONLY A's own portrait — B's is absent (the closed leak). Decrypt-level
    // assertion: B's insight file exists on disk, but never reaches A's list.
    expect((await bridge.sessionSetActive({ personId: a.id })).ok).toBe(true);
    const seenByA = await bridge.insightsList();
    expect(seenByA.map((i) => i.subjectPersonId)).toEqual([a.id]);
    expect(seenByA.some((i) => i.subjectPersonId === b.id)).toBe(false);
    expect(seenByA.some((i) => i.facts.some((f) => f.text.includes('Bo secret')))).toBe(false);
    // The owner's own insights (if any) are also not A's — A only ever sees A's.
    expect(seenByA.some((i) => i.subjectPersonId === ownerId)).toBe(false);

    // Switching to B flips the view entirely — A's portrait is gone, B's appears.
    expect((await bridge.sessionSetActive({ personId: b.id })).ok).toBe(true);
    const seenByB = await bridge.insightsList();
    expect(seenByB.map((i) => i.subjectPersonId)).toEqual([b.id]);
    expect(seenByB.some((i) => i.subjectPersonId === a.id)).toBe(false);
  });

  it('flags a fact (excluded from context, kept in Memory) and refreshes memory via reconciliation (spec 20 §3.5/§3.6)', async () => {
    const { bridge, host, ownerId } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    const ctx = (await host.host.vaultAndKey())!;
    const at = new Date().toISOString();
    await saveInsight(ctx.fs, ctx.key, {
      id: 'ins1',
      schemaVersion: 1,
      source: 'session',
      subjectPersonId: ownerId,
      summary: 'They value rest',
      facts: [
        { id: 'f1', text: 'Wants more sleep', shareable: false },
        { id: 'f2', text: 'WRONG FACT', shareable: false },
      ],
      confidence: 'low',
      categories: ['Other'],
      approved: true,
      provenance: { conversationId: 'cX', at },
      createdAt: at,
      updatedAt: at,
    });

    // Flag f2 → it's marked in Memory but EXCLUDED from the coach's context at once.
    const flagged = await bridge.insightsFlag({ insightId: 'ins1', factId: 'f2', flagged: true });
    expect(flagged?.facts.find((f) => f.id === 'f2')?.flaggedInaccurate).toBe(true);
    // It still appears in the owner's Memory list (visible-but-marked, §3.6) ...
    const shown = (await bridge.insightsList()).find((i) => i.id === 'ins1');
    expect(shown?.facts.some((f) => f.id === 'f2')).toBe(true);
    // ... but is gone from the assembled coaching context.
    const context = await buildContext(ctx.fs, ctx.key, ownerId);
    expect(context).toContain('Wants more sleep');
    expect(context).not.toContain('WRONG FACT');

    // Refresh memory: a reconcile-ops Claude bumps the confidence + writes a rationale.
    host.host.claude = {
      send: () => Promise.resolve(''),
      stream: (_options, onDelta) => {
        const text = JSON.stringify({
          insights: [{ id: 'ins1', confidence: 'high', rationale: 'clear and consistent' }],
          merges: [],
        });
        onDelta(text);
        return Promise.resolve({
          text,
          usage: { inputTokens: 5, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    expect(await bridge.memoryRefresh()).toMatchObject({ ok: true, reconciledCount: 1 });
    const after = (await bridge.insightsList()).find((i) => i.id === 'ins1');
    expect(after?.confidence).toBe('high');
    expect(after?.confidenceRationale).toBe('clear and consistent');

    // A non-memory.own person (guest) is denied both flag + refresh.
    const guest = await bridge.peopleSave({ displayName: 'Guest', isSubject: false, tags: [] });
    await bridge.accessSetAccount({ personId: guest.id, roleId: 'guest', pin: null });
    expect((await bridge.sessionSetActive({ personId: guest.id })).ok).toBe(true);
    expect(
      await bridge.insightsFlag({ insightId: 'ins1', factId: 'f1', flagged: true }),
    ).toBeNull();
    expect(await bridge.memoryRefresh()).toMatchObject({ ok: false, reason: 'DENIED' });
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

  it('intimacy topics (§16.5a): owner adds/removes; a member reads but cannot add/remove', async () => {
    const { bridge, ownerId } = await freshOwner();
    const member = await bridge.peopleSave({ displayName: 'Mem', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: member.id, roleId: 'member', pin: null });

    // The Owner sees the built-in inventory + no custom yet, then adds one of each.
    const initial = await bridge.questionnairesIntimacyTopics();
    expect(initial.builtIn.activities.length).toBeGreaterThan(10);
    expect(initial.custom).toEqual({ activities: [], fantasies: [] });
    const afterAdd = await bridge.questionnairesAddIntimacyTopic({
      kind: 'activities',
      name: 'Wax play',
    });
    expect(afterAdd.custom.activities).toEqual(['Wax play']);
    await bridge.questionnairesAddIntimacyTopic({ kind: 'fantasies', name: 'Pirate roleplay' });

    // A Member can READ the merged inventory (for the builder) but CANNOT add or remove (owner-only).
    await bridge.sessionSetActive({ personId: member.id });
    const memberView = await bridge.questionnairesIntimacyTopics();
    expect(memberView.custom.activities).toEqual(['Wax play']);
    await expect(
      bridge.questionnairesAddIntimacyTopic({ kind: 'activities', name: 'Sneaky' }),
    ).rejects.toThrow(/permitted/);
    await expect(
      bridge.questionnairesRemoveIntimacyTopic({ kind: 'activities', name: 'Wax play' }),
    ).rejects.toThrow(/permitted/);

    // The Owner removes a custom topic.
    await bridge.sessionSetActive({ personId: ownerId, pin: '1234' });
    const afterRemove = await bridge.questionnairesRemoveIntimacyTopic({
      kind: 'activities',
      name: 'wax PLAY', // case-insensitive
    });
    expect(afterRemove.custom.activities).toEqual([]);
    expect(afterRemove.custom.fantasies).toEqual(['Pirate roleplay']);
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

  it('reaps an orphaned image when an edit removes it from the questionnaire (§13.2 GC)', async () => {
    const { bridge } = await freshOwner();
    const base64 = toBase64(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9, 9]));
    const { imagePath } = await bridge.questionnairesStoreImage({ base64, mime: 'image/png' });

    const def = await bridge.questionnairesSave({
      title: 'Has an image',
      type: 'role-feedback',
      sensitivity: 'standard',
      questions: [
        {
          id: 'q1',
          type: 'shortText',
          prompt: 'Look',
          required: false,
          media: { imagePath, alt: 'x', mime: 'image/png' },
        },
      ],
    });
    expect(await bridge.questionnairesGetImage(imagePath)).toBe(base64); // referenced → kept

    // Editing the def to drop the image reaps the now-orphaned encrypted file.
    await bridge.questionnairesSave({
      id: def.id,
      title: 'Has an image',
      type: 'role-feedback',
      sensitivity: 'standard',
      questions: [{ id: 'q1', type: 'shortText', prompt: 'Look', required: false }],
    });
    expect(await bridge.questionnairesGetImage(imagePath)).toBeNull(); // reaped
  });

  it('lets a recipient read images only for questionnaires sent to THEM (answer, not create)', async () => {
    const { bridge, ownerId } = await freshOwner();
    const base64 = toBase64(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 7, 7]));
    const mine = (await bridge.questionnairesStoreImage({ base64, mime: 'image/png' })).imagePath;
    const other = (await bridge.questionnairesStoreImage({ base64, mime: 'image/png' })).imagePath;

    const mara = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: mara.id, roleId: 'member', pin: null });
    const def = await bridge.questionnairesSave({
      title: 'Has an image',
      type: 'role-feedback',
      sensitivity: 'standard',
      recipient: { kind: 'person', personId: mara.id },
      questions: [
        {
          id: 'q1',
          type: 'shortText',
          prompt: 'Look',
          required: false,
          media: { imagePath: mine, alt: 'x', mime: 'image/png' },
        },
      ],
    });
    await bridge.assignmentsCreate({ questionnaireId: def.id });

    // Make the member role answer-only (no create) so the recipient branch is what's exercised.
    const member = (await bridge.accessGet()).roles.find((r) => r.id === 'member')!;
    await bridge.accessSaveRole({
      ...member,
      capabilities: { ...member.capabilities, 'questionnaires.create': false },
    });

    await bridge.sessionSetActive({ personId: mara.id });
    // Her own assignment references `mine` → she can read it; `other` is not sent to her → null.
    expect(await bridge.questionnairesGetImage(mine)).toBe(base64);
    expect(await bridge.questionnairesGetImage(other)).toBeNull();

    // Back to the owner (has create) → reads any media for authoring.
    await bridge.sessionSetActive({ personId: ownerId, pin: '1234' });
    expect(await bridge.questionnairesGetImage(other)).toBe(base64);
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

  it('rejects an in-app send when the bound recipient no longer exists', async () => {
    const { bridge } = await freshOwner();
    const saved = await bridge.questionnairesSave({
      title: 'q',
      type: 'role-feedback',
      sensitivity: 'standard',
      recipient: { kind: 'person', personId: 'ghost' },
      questions: [{ id: 'q1', type: 'shortText', prompt: 'hi', required: true }],
    });
    await expect(bridge.assignmentsCreate({ questionnaireId: saved.id })).rejects.toThrow(
      /Recipient not found/,
    );
  });

  it('delivers a send to the recipient Inbox, answers + submits, and gates non-recipients', async () => {
    const { bridge } = await freshOwner();
    const recipient = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: recipient.id, roleId: 'member', pin: null });

    const q = await bridge.questionnairesSave({
      title: 'Weekly check-in',
      type: 'role-feedback',
      sensitivity: 'standard',
      recipient: { kind: 'person', personId: recipient.id },
      questions: [{ id: 'q1', type: 'shortText', prompt: 'How are we doing?', required: true }],
    });
    const { assignment } = await bridge.assignmentsCreate({
      questionnaireId: q.id,
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
      recipient: { kind: 'person', personId: recipient.id },
      questions: [{ id: 'q1', type: 'shortText', prompt: 'How are we doing?', required: true }],
    });
    const { assignment: standard } = await bridge.assignmentsCreate({
      questionnaireId: q.id,
      privacy: 'standard',
    });
    const { assignment: priv } = await bridge.assignmentsCreate({
      questionnaireId: q.id,
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
      recipient: { kind: 'person', personId: ownerId },
      questions: [{ id: 'q1', type: 'shortText', prompt: 'How?', required: true }],
    });
    expect((await bridge.questionnairesGet(q.id))?.creatorPersonId).toBe(member.id);

    // Sent → it now has a send, so the member-creator can no longer delete it.
    const { assignment } = await bridge.assignmentsCreate({
      questionnaireId: q.id,
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
      recipient: { kind: 'person', personId: mara.id },
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
      const { assignment: a } = await bridge.assignmentsCreate({
        questionnaireId: q.id,
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

  it('compatibility (§17.12-B): compares you + the bound recipient; recipient = yourself is rejected', async () => {
    const { bridge, ownerId } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    const partner = await bridge.peopleSave({ displayName: 'Angel', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: partner.id, roleId: 'member', pin: null });
    const compatQ = (visibility: 'sharedReport', recipientId: string) =>
      bridge.questionnairesSave({
        title: 'Sexy time',
        type: 'role-feedback',
        sensitivity: 'standard',
        recipient: { kind: 'person', personId: recipientId },
        questions: [
          {
            id: 'c1',
            type: 'rating',
            prompt: 'Connected?',
            required: true,
            scale: { min: 1, max: 5 },
          },
        ],
        compatibility: { enabled: true, visibility },
      });

    // Binding YOURSELF as the recipient is the only invalid pairing now (you can't compare you with you).
    const qSelf = await compatQ('sharedReport', ownerId);
    expect(
      await bridge.assignmentsCreateCompatibility({ questionnaireId: qSelf.id }),
    ).toMatchObject({
      ok: false,
      reason: 'INVALID',
    });

    // You + the bound recipient: no participant ids passed — derived from the questionnaire.
    const q = await compatQ('sharedReport', partner.id);
    const sent = await bridge.assignmentsCreateCompatibility({ questionnaireId: q.id });
    expect(sent.ok).toBe(true);

    const group = (await bridge.assignmentsCompatibility(q.id))[0]!;
    expect(group.members).toHaveLength(2);
    const ownMember = group.members.find((m) => m.recipientName !== 'Angel')!;
    // The sender answers their OWN variant in their Inbox; the disclosure reads as "you" (viewerIsSender)
    // and names the OTHER participant, never the sender as a third party (§16.1).
    const detail = await bridge.assignmentsGet(ownMember.assignmentId);
    expect(detail!.compatibility!.viewerIsSender).toBe(true);
    expect(detail!.compatibility!.otherParticipantName).toBe('Angel');

    // The partner's view names the sender as the other participant, not as a neutral asker.
    await bridge.sessionSetActive({ personId: partner.id });
    const partnerMember = group.members.find((m) => m.recipientName === 'Angel')!;
    const partnerDetail = await bridge.assignmentsGet(partnerMember.assignmentId);
    expect(partnerDetail!.compatibility!.viewerIsSender).toBe(false);
    await bridge.sessionSetActive({ personId: ownerId, pin: '1234' });
  });

  it('compatibility: you + recipient → align → report + Insight; the Owner can reveal a senderSeesAll send', async () => {
    const { bridge, ownerId } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    const alex = await bridge.peopleSave({ displayName: 'Alex', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: alex.id, roleId: 'member', pin: null });

    const q = await bridge.questionnairesSave({
      title: 'Compatibility check',
      type: 'role-feedback',
      sensitivity: 'standard',
      recipient: { kind: 'person', personId: alex.id },
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

    // You + the recipient: AI personalizes a variant each (sender + Alex), freezing two paired snapshots.
    const sent = await bridge.assignmentsCreateCompatibility({ questionnaireId: q.id });
    expect(sent.ok).toBe(true);

    const groups = await bridge.assignmentsCompatibility(q.id);
    expect(groups).toHaveLength(1);
    const group = groups[0]!;
    expect(group.members).toHaveLength(2);
    expect(group.visibility).toBe('senderSeesAll');
    expect(group.canReveal).toBe(true); // the Owner is the full-access role → can reveal

    // Each participant answers their own variant — the sender (owner) answers theirs, Alex answers theirs.
    const answerAs = async (
      personId: string,
      assignmentId: string,
      value: number,
    ): Promise<void> => {
      const isOwner = personId === ownerId; // the owner is already active — no PIN switch needed
      if (!isOwner) await bridge.sessionSetActive({ personId });
      const detail = await bridge.assignmentsGet(assignmentId);
      // CONTENT CORRECTNESS (§17.12): each participant's variant must ask about the OTHER participant, not
      // themselves. Alex (the recipient) must be asked about Ben (the sender) — NOT "about Alex" — and the
      // sender's variant about Alex. This is the real bug a "did the screen render" check missed.
      const prompt = detail!.questionnaire.questions[0]!.prompt;
      if (isOwner) {
        expect(prompt).toContain('about Alex');
      } else {
        expect(prompt).toContain('about Ben');
        expect(prompt).not.toContain('about Alex');
      }
      const qid = detail!.questionnaire.questions[0]!.id;
      await bridge.assignmentsSubmit({ assignmentId, answers: [{ questionId: qid, value }] });
      if (!isOwner) await bridge.sessionSetActive({ personId: ownerId, pin: '1234' });
    };
    for (const m of group.members) {
      const personId = m.recipientName === 'Alex' ? alex.id : ownerId;
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

    // The Owner is the full-access role (super-admin removed 2026-06-15) → can read any send's raw answers
    // directly, no break-glass ceremony, no audit.
    const memberId = after.members[0]!.assignmentId;
    const revealed = await bridge.assignmentsRevealRaw(memberId);
    expect(revealed).not.toBeNull();
    expect(revealed!.length).toBeGreaterThan(0);

    // A non-owner member who is NOT the sender, and lacks readRaw, can't reveal it.
    await bridge.sessionSetActive({ personId: alex.id });
    expect(await bridge.assignmentsRevealRaw(memberId)).toBeNull();
    await bridge.sessionSetActive({ personId: ownerId, pin: '1234' });
  });

  it('compatibility contextOnly (§16.2): distils per-participant, auto-approves into each context, no report, align denied', async () => {
    const { host, bridge, ownerId } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    const alex = await bridge.peopleSave({ displayName: 'Alex', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: alex.id, roleId: 'member', pin: null });

    const q = await bridge.questionnairesSave({
      title: 'Closeness',
      type: 'role-feedback',
      sensitivity: 'standard',
      recipient: { kind: 'person', personId: alex.id },
      questions: [
        {
          id: 'c1',
          type: 'rating',
          prompt: 'Connected?',
          required: true,
          scale: { min: 1, max: 5 },
        },
      ],
      compatibility: { enabled: true, visibility: 'contextOnly' },
    });
    const sent = await bridge.assignmentsCreateCompatibility({ questionnaireId: q.id });
    expect(sent.ok).toBe(true);

    // Both participants (the sender + Alex) answer their own variant.
    const group = (await bridge.assignmentsCompatibility(q.id))[0]!;
    for (const m of group.members) {
      const isOwner = m.recipientName !== 'Alex';
      if (!isOwner) await bridge.sessionSetActive({ personId: alex.id });
      const detail = await bridge.assignmentsGet(m.assignmentId);
      const qid = detail!.questionnaire.questions[0]!.id;
      await bridge.assignmentsSubmit({
        assignmentId: m.assignmentId,
        answers: [{ questionId: qid, value: 4 }],
      });
      if (!isOwner) await bridge.sessionSetActive({ personId: ownerId, pin: '1234' });
    }

    // A Claude that returns valid analysis JSON — note shareable:true; the service forces own-context-only.
    host.host.claude = {
      send: () => Promise.resolve('{}'),
      stream: (_options, onDelta) => {
        const json = JSON.stringify({
          summary: 'Values steady connection.',
          facts: [{ text: 'Feels close through shared time.', shareable: true }],
          confidence: 'medium',
        });
        onDelta(json);
        return Promise.resolve({
          text: json,
          usage: { inputTokens: 5, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };

    // The sender distils → each participant's own context is enriched; align is denied (no report).
    const distilled = await bridge.assignmentsDistillContextOnly(group.compatibilityGroupId);
    expect(distilled).toMatchObject({ ok: true, updated: 2 });
    expect(await bridge.assignmentsAlign(group.compatibilityGroupId)).toMatchObject({
      ok: false,
      reason: 'DENIED',
    });
    const after = (await bridge.assignmentsCompatibility(q.id))[0]!;
    expect(after.report).toBeNull();
    expect(after.analyzed).toBe(true); // both contexts processed

    // The group's Insights are subject = each PARTICIPANT (the sender + Alex now, §17.12-B), auto-approved,
    // own-context-only. Memory is now per-person scoped (spec 20 §5.1), so the sender sees ONLY their OWN
    // contextOnly insight here — Alex's is absent (Alex is a compat participant, not a relationship).
    const ownerGroupInsights = (await bridge.insightsList()).filter(
      (i) => i.provenance.compatibilityGroupId === group.compatibilityGroupId,
    );
    expect(ownerGroupInsights.map((i) => i.subjectPersonId)).toEqual([ownerId]);
    expect(ownerGroupInsights.every((i) => i.approved)).toBe(true); // auto-approved → feeds own context
    expect(ownerGroupInsights.every((i) => i.facts.every((f) => f.shareable === false))).toBe(true);

    // Alex's own contextOnly insight (subject = Alex) appears in ALEX's scoped Memory, and was NOT visible
    // to the owner above — the per-person scoping holds both ways (spec 20 §1.1).
    await bridge.sessionSetActive({ personId: alex.id });
    const alexGroupInsights = (await bridge.insightsList()).filter(
      (i) => i.provenance.compatibilityGroupId === group.compatibilityGroupId,
    );
    expect(alexGroupInsights.map((i) => i.subjectPersonId)).toEqual([alex.id]);
    expect(alexGroupInsights.every((i) => i.facts.every((f) => f.shareable === false))).toBe(true);
    await bridge.sessionSetActive({ personId: ownerId, pin: '1234' });
  });

  it('the Owner can read ANY private send’s raw answers directly (no break-glass ceremony)', async () => {
    const { bridge, ownerId } = await freshOwner();
    const mara = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: mara.id, roleId: 'member', pin: null });
    const q = await bridge.questionnairesSave({
      title: 'Private check-in',
      type: 'role-feedback',
      sensitivity: 'standard',
      recipient: { kind: 'person', personId: mara.id },
      questions: [{ id: 'c1', type: 'shortText', prompt: 'How are you?', required: true }],
    });
    const { assignment: a } = await bridge.assignmentsCreate({
      questionnaireId: q.id,
      privacy: 'private',
    });
    await bridge.sessionSetActive({ personId: mara.id });
    await bridge.assignmentsSubmit({
      assignmentId: a.id,
      answers: [{ questionId: 'c1', value: 'Doing okay.' }],
    });
    await bridge.sessionSetActive({ personId: ownerId, pin: '1234' });

    // The Owner (full-access role) reads a plain private send's raw answers directly — no ceremony, no audit.
    const revealed = await bridge.assignmentsRevealRaw(a.id);
    expect(revealed?.[0]?.answer).toBe('Doing okay.');

    // A member who isn't the sender can't (no readRaw).
    await bridge.sessionSetActive({ personId: mara.id });
    expect(await bridge.assignmentsRevealRaw(a.id)).toBeNull();
  });

  it('a non-owner sender of a senderSeesAll send can reveal ONLY with granted readRaw', async () => {
    const { bridge, ownerId } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });

    // The sender is a Member (not the Owner), plus two recipients.
    const sam = await bridge.peopleSave({ displayName: 'Sam', isSubject: true, tags: [] });
    const alex = await bridge.peopleSave({ displayName: 'Alex', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: sam.id, roleId: 'member', pin: null });
    await bridge.accessSetAccount({ personId: alex.id, roleId: 'member', pin: null });

    // Grant the Member role readRaw (the explicit-grant-only Roles toggle).
    const member = (await bridge.accessGet()).roles.find((r) => r.id === 'member')!;
    await bridge.accessSaveRole({
      ...member,
      capabilities: { ...member.capabilities, 'questionnaires.readRaw': true },
    });

    // Sam (a Member) authors a senderSeesAll compatibility questionnaire bound to Alex → compares Sam + Alex.
    await bridge.sessionSetActive({ personId: sam.id });
    const q = await bridge.questionnairesSave({
      title: 'Compat',
      type: 'role-feedback',
      sensitivity: 'standard',
      recipient: { kind: 'person', personId: alex.id },
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
    const sent = await bridge.assignmentsCreateCompatibility({ questionnaireId: q.id });
    expect(sent.ok).toBe(true);

    const group = (await bridge.assignmentsCompatibility(q.id))[0]!;
    expect(group.canReveal).toBe(true); // Sam is the sender AND has readRaw

    // Both participants (Sam + Alex) answer their variants.
    for (const m of group.members) {
      const personId = m.recipientName === 'Alex' ? alex.id : sam.id;
      await bridge.sessionSetActive({ personId });
      const detail = await bridge.assignmentsGet(m.assignmentId);
      const qid = detail!.questionnaire.questions[0]!.id;
      await bridge.assignmentsSubmit({
        assignmentId: m.assignmentId,
        answers: [{ questionId: qid, value: 3 }],
      });
    }

    // Sam (sender + readRaw) can reveal a member's raw answers.
    await bridge.sessionSetActive({ personId: sam.id });
    const revealed = await bridge.assignmentsRevealRaw(group.members[0]!.assignmentId);
    expect(revealed).not.toBeNull();
    expect(revealed!.length).toBeGreaterThan(0);

    // Revoke readRaw → the same sender can no longer reveal (the grant is the gate).
    await bridge.sessionSetActive({ personId: ownerId, pin: '1234' });
    const member2 = (await bridge.accessGet()).roles.find((r) => r.id === 'member')!;
    await bridge.accessSaveRole({
      ...member2,
      capabilities: { ...member2.capabilities, 'questionnaires.readRaw': false },
    });
    await bridge.sessionSetActive({ personId: sam.id });
    expect(await bridge.assignmentsRevealRaw(group.members[0]!.assignmentId)).toBeNull();
  });

  it('external compatibility (§17.12-B): you in-app + the external recipient via the relay, one group', async () => {
    const { host, bridge } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    // Connect a relay so external sends can be minted (the fake Cloudflare host).
    expect((await bridge.relayConnect({ apiToken: 'cf', accountId: 'acct' })).configured).toBe(
      true,
    );

    // A compatibility questionnaire bound to an EXTERNAL recipient → compares you + them.
    const q = await bridge.questionnairesSave({
      title: 'How aligned are we?',
      type: 'role-feedback',
      sensitivity: 'standard',
      recipient: { kind: 'external', displayName: 'Jordan' },
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

    const sent = await bridge.assignmentsCreateCompatibility({ questionnaireId: q.id });
    expect(sent.ok).toBe(true);
    if (!sent.ok) throw new Error('expected ok');
    // The external recipient gets a relay link + PIN; the sender answers their own version in-app.
    expect(sent.link).toMatch(/\.workers\.dev\/q\/[0-9a-f]+#k=/);
    expect(sent.pin).toMatch(/^\d{6}$/);

    // The group has two members — one in-app (the sender) + one relay (the external recipient) — same group.
    const group = (await bridge.assignmentsCompatibility(q.id))[0]!;
    expect(group.members).toHaveLength(2);
    expect(group.compatibilityGroupId).toBe(sent.compatibilityGroupId);

    // --- The full §17.12-D loop: both answer → align → publish the report back to the relay ---
    // The sender answers their own in-app variant.
    const inApp = group.members.find((m) => m.channel === 'inApp')!;
    const myDetail = await bridge.assignmentsGet(inApp.assignmentId);
    await bridge.assignmentsSubmit({
      assignmentId: inApp.assignmentId,
      answers: [{ questionId: myDetail!.questionnaire.questions[0]!.id, value: 3 }],
    });

    // The external recipient answers via the relay (their browser unlocks + seals to the send key).
    const relayFetch = host.host.relay.fetch;
    const token = sent.link!.split('/q/')[1]?.split('#')[0] ?? '';
    const contentKey = contentKeyFromFragment(sent.link!.slice(sent.link!.indexOf('#')))!;
    const unlocked = (await (
      await relayFetch('https://relay/api/unlock', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, pin: sent.pin }),
      })
    ).json()) as { sealedContent: Parameters<typeof openContent>[0] };
    const content = await openContent(unlocked.sealedContent, contentKey);
    // CONTENT CORRECTNESS (§17.12): the external recipient (Jordan) is asked about the SENDER (Ben), not
    // about themselves — the same variant-perspective fix, verified end-to-end through the relay.
    expect(content.questionnaire.questions[0]!.prompt).toContain('about Ben');
    expect(content.questionnaire.questions[0]!.prompt).not.toContain('about Jordan');
    const sealed = await sealResponse(
      {
        kind: 'submit',
        answers: [{ questionId: content.questionnaire.questions[0]!.id, value: 5 }],
        submittedAt: '2026-06-11T01:00:00.000Z',
      },
      content.publicKey,
    );
    await relayFetch('https://relay/api/respond', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, pin: sent.pin, sealed }),
    });

    // Drain the external answer in, then align both into a report.
    expect((await bridge.assignmentsDrain()).drained).toBe(1);
    expect((await bridge.assignmentsAlign(group.compatibilityGroupId)).ok).toBe(true);

    // Push the report back to the external recipient's relay link.
    expect(await bridge.assignmentsPublishCompatResult(group.compatibilityGroupId)).toEqual({
      ok: true,
      published: 1,
    });

    // The recipient revisits → unlock now carries the sealed outcome, decryptable with their fragment key.
    const reUnlock = (await (
      await relayFetch('https://relay/api/unlock', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, pin: sent.pin }),
      })
    ).json()) as { sealedResult?: Parameters<typeof openResult>[0] };
    expect(reUnlock.sealedResult).toBeTruthy();
    const outcome = await openResult(reUnlock.sealedResult!, contentKey);
    expect(outcome.kind).toBe('report');
    expect(outcome.headline).toMatch(/compare/i);
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
      recipient: { kind: 'external', displayName: 'Alex' },
      questions: [{ id: 'a', type: 'shortText', prompt: 'How do I come across?', required: true }],
    });
    const { assignmentId, link, pin } = await bridge.assignmentsCreateRelayLink({
      questionnaireId: q.id,
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

  it('unified delivery (§17.13): a household send ALSO mints a link; answerable via the link, drained in', async () => {
    const { host, bridge, ownerId } = await freshOwner();
    await bridge.relayConnect({ apiToken: 'cf', accountId: 'acct' });
    const mara = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: mara.id, roleId: 'member', pin: null });
    const q = await bridge.questionnairesSave({
      title: 'Weekly check-in',
      type: 'role-feedback',
      sensitivity: 'standard',
      recipient: { kind: 'person', personId: mara.id },
      questions: [{ id: 'a', type: 'shortText', prompt: 'How are we doing?', required: true }],
    });

    // The in-app send to Mara ALSO mints a relay link + PIN, but stays an in-app send.
    const sent = await bridge.assignmentsCreate({ questionnaireId: q.id, privacy: 'standard' });
    expect(sent.assignment.channel).toBe('inApp');
    expect(sent.link).toMatch(/\.workers\.dev\/q\/[0-9a-f]+#k=/);
    expect(sent.pin).toMatch(/^\d{6}$/);

    // It's in Mara's Inbox (the in-app surface)…
    await bridge.sessionSetActive({ personId: mara.id });
    expect(
      (await bridge.assignmentsInbox()).some((i) => i.assignmentId === sent.assignment.id),
    ).toBe(true);
    await bridge.sessionSetActive({ personId: ownerId, pin: '1234' });

    // …AND answerable via the link: the recipient's browser unlocks + seals; the sender drains it in.
    const relayFetch = host.host.relay.fetch;
    const token = sent.link!.split('/q/')[1]?.split('#')[0] ?? '';
    const contentKey = contentKeyFromFragment(sent.link!.slice(sent.link!.indexOf('#')))!;
    const unlocked = (await (
      await relayFetch('https://relay/api/unlock', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, pin: sent.pin }),
      })
    ).json()) as { sealedContent: Parameters<typeof openContent>[0] };
    const content = await openContent(unlocked.sealedContent, contentKey);
    const sealed = await sealResponse(
      {
        kind: 'submit',
        answers: [{ questionId: 'a', value: 'Answered via the link.' }],
        submittedAt: '2026-06-11T01:00:00.000Z',
      },
      content.publicKey,
    );
    await relayFetch('https://relay/api/respond', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, pin: sent.pin, sealed }),
    });
    // Before draining, Results flags the household send as relay-linked so the UI shows drain/revoke
    // (the #3 fix: the affordance keys off relay material, not `channel === 'relay'`).
    const before = await bridge.assignmentsResults(q.id);
    const beforeRow = before.find((r) => r.assignmentId === sent.assignment.id);
    expect(beforeRow?.channel).toBe('inApp');
    expect(beforeRow?.relayLinked).toBe(true);

    expect((await bridge.assignmentsDrain()).drained).toBe(1);
    const results = await bridge.assignmentsResults(q.id);
    expect(results.find((r) => r.assignmentId === sent.assignment.id)?.status).toBe('submitted');
    expect(results.find((r) => r.assignmentId === sent.assignment.id)?.answers?.[0]?.answer).toBe(
      'Answered via the link.',
    );
  });

  it('unified delivery (§17.13): an in-app submit closes the relay link (first-submission wins)', async () => {
    const { host, bridge, ownerId } = await freshOwner();
    await bridge.relayConnect({ apiToken: 'cf', accountId: 'acct' });
    const mara = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: mara.id, roleId: 'member', pin: null });
    const q = await bridge.questionnairesSave({
      title: 'Quick one',
      type: 'role-feedback',
      sensitivity: 'standard',
      recipient: { kind: 'person', personId: mara.id },
      questions: [{ id: 'a', type: 'shortText', prompt: 'One word?', required: true }],
    });
    const sent = await bridge.assignmentsCreate({ questionnaireId: q.id, privacy: 'standard' });
    const token = sent.link!.split('/q/')[1]?.split('#')[0] ?? '';

    // Mara answers in the Inbox first.
    await bridge.sessionSetActive({ personId: mara.id });
    await bridge.assignmentsSubmit({
      assignmentId: sent.assignment.id,
      answers: [{ questionId: 'a', value: 'Done' }],
    });
    await bridge.sessionSetActive({ personId: ownerId, pin: '1234' });

    // The link is now closed — a recipient can no longer unlock it (the in-app answer wins).
    const res = await host.host.relay.fetch('https://relay/api/unlock', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, pin: sent.pin }),
    });
    expect(res.status).toBe(404);
  });

  it('questionnairesSendStates: latest send time + count per questionnaire; absent until sent (§17.14)', async () => {
    const { bridge } = await freshOwner();
    const mara = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: mara.id, roleId: 'member', pin: null });
    const q = await bridge.questionnairesSave({
      title: 'Weekly check-in',
      type: 'general',
      sensitivity: 'standard',
      recipient: { kind: 'person', personId: mara.id },
      questions: [{ id: 'a', type: 'shortText', prompt: 'How?', required: true }],
    });

    // A never-sent questionnaire has no send state (the list shows it as a draft).
    expect(await bridge.questionnairesSendStates()).toEqual({});

    // Send it twice → the state records the count + the latest send time.
    await bridge.assignmentsCreate({ questionnaireId: q.id, privacy: 'standard' });
    await bridge.assignmentsCreate({ questionnaireId: q.id, privacy: 'standard' });
    const states = await bridge.questionnairesSendStates();
    expect(states[q.id]?.total).toBe(2);
    expect(typeof states[q.id]?.lastSentAt).toBe('string');

    // Sender-scoped: the recipient (Mara) sent nothing herself, so her own send-states are empty —
    // the owner's send of `q` does not leak into another person's list.
    await bridge.sessionSetActive({ personId: mara.id });
    expect(await bridge.questionnairesSendStates()).toEqual({});
  });

  it('compatibility household (§17.14): mints a relay link for the recipient (not self) + reshare mints fresh', async () => {
    const { bridge } = await freshOwner();
    await bridge.relayConnect({ apiToken: 'cf', accountId: 'acct' });
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    const angel = await bridge.peopleSave({ displayName: 'Angel', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: angel.id, roleId: 'member', pin: null });
    const q = await bridge.questionnairesSave({
      title: 'Closeness',
      type: 'role-feedback',
      sensitivity: 'standard',
      recipient: { kind: 'person', personId: angel.id },
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

    // A HOUSEHOLD compatibility send now ALSO mints a relay link for the RECIPIENT's variant (§17.14) —
    // the sender answers their own variant in-app, so no link is minted for the sender's member.
    const sent = await bridge.assignmentsCreateCompatibility({ questionnaireId: q.id });
    expect(sent.ok).toBe(true);
    if (!sent.ok) throw new Error('expected ok');
    expect(sent.link).toMatch(/\.workers\.dev\/q\/[0-9a-f]+#k=/);
    expect(sent.pin).toMatch(/^\d{6}$/);

    const members = (await bridge.assignmentsCompatibility(q.id))[0]!.members;
    const angelMember = members.find((m) => m.recipientName === 'Angel')!;
    const selfMember = members.find((m) => m.isSelf)!;
    expect(angelMember.relayLinked).toBe(true); // the recipient gets a shareable link
    expect(selfMember.relayLinked).toBe(false); // the sender answers in-app — no link

    // Re-share the recipient's link → a FRESH link + PIN (the old link is revoked; PIN is never re-shown).
    const reshared = await bridge.assignmentsReshare(angelMember.assignmentId);
    expect(reshared?.link).toMatch(/\.workers\.dev\/q\//);
    expect(reshared?.pin).toMatch(/^\d{6}$/);
    expect(reshared?.link).not.toBe(sent.link); // a new token → a different link

    // Re-sharing the sender's OWN member is refused (they answer in-app, never a link) — the guard keys off
    // the send's OWN sender (`recipient.personId === senderPersonId`), NOT the active person, so an admin
    // resharing someone else's group can't mint a link to the sender's full-context self-variant either.
    expect(await bridge.assignmentsReshare(selfMember.assignmentId)).toBeNull();
  });

  it('compatibility household (§17.14a): a relay-mint failure surfaces linkError — never a silent Inbox-only', async () => {
    const ctx = await freshOwner();
    const { bridge } = ctx;
    await bridge.relayConnect({ apiToken: 'cf', accountId: 'acct' });
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    const angel = await bridge.peopleSave({ displayName: 'Angel', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: angel.id, roleId: 'member', pin: null });
    const q = await bridge.questionnairesSave({
      title: 'Closeness',
      type: 'role-feedback',
      sensitivity: 'standard',
      recipient: { kind: 'person', personId: angel.id },
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

    // A relay IS connected, but make it unreachable for the mailbox upload (a stale/down deploy). The mint
    // must NOT be silently swallowed — the send still stands (Inbox) but reports a linkError the UI surfaces.
    ctx.host.host.relay.fetch = () => Promise.reject(new Error('relay unreachable'));
    const sent = await bridge.assignmentsCreateCompatibility({ questionnaireId: q.id });
    expect(sent.ok).toBe(true);
    if (!sent.ok) throw new Error('expected ok');
    expect(sent.link).toBeUndefined();
    expect(sent.pin).toBeUndefined();
    expect(sent.linkError).toBeTruthy(); // surfaced, not swallowed — the user learns the link didn't go out
  });

  it('one-person household (§17.14a): a relay-mint failure surfaces linkError too', async () => {
    const ctx = await freshOwner();
    const { bridge } = ctx;
    await bridge.relayConnect({ apiToken: 'cf', accountId: 'acct' });
    const mara = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: mara.id, roleId: 'member', pin: null });
    const q = await bridge.questionnairesSave({
      title: 'Check-in',
      type: 'general',
      sensitivity: 'standard',
      recipient: { kind: 'person', personId: mara.id },
      questions: [{ id: 'a', type: 'shortText', prompt: 'How?', required: true }],
    });
    // Relay connected but unreachable for the upload → the in-app send stands, but linkError is surfaced.
    ctx.host.host.relay.fetch = () => Promise.reject(new Error('relay unreachable'));
    const sent = await bridge.assignmentsCreate({ questionnaireId: q.id, privacy: 'standard' });
    expect(sent.assignment.id).toBeTruthy();
    expect(sent.link).toBeUndefined();
    expect(sent.linkError).toBeTruthy();
  });

  it('questionnairesShareLink (§17.14d): re-shows the SAME link/PIN; regenerate mints a fresh one', async () => {
    const { bridge } = await freshOwner();
    await bridge.relayConnect({ apiToken: 'cf', accountId: 'acct' });
    const mara = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: mara.id, roleId: 'member', pin: null });
    const q = await bridge.questionnairesSave({
      title: 'Check-in',
      type: 'general',
      sensitivity: 'standard',
      recipient: { kind: 'person', personId: mara.id },
      questions: [{ id: 'a', type: 'shortText', prompt: 'How?', required: true }],
    });
    // Before any send there's nothing to share.
    expect(await bridge.questionnairesShareLink(q.id)).toBeNull();

    // After sending, the link is reachable again WITHOUT going through Results — and stable.
    await bridge.assignmentsCreate({ questionnaireId: q.id, privacy: 'standard' });
    const first = await bridge.questionnairesShareLink(q.id);
    expect(first?.link).toMatch(/\.workers\.dev\/q\//);
    expect(first?.pin).toMatch(/^\d{6}$/);
    // Clicking Share link AGAIN returns the IDENTICAL link + PIN (no regeneration — the user's ask).
    const again = await bridge.questionnairesShareLink(q.id);
    expect(again).toEqual(first);
    // Only an explicit Refresh (regenerate) mints a fresh, DIFFERENT link + PIN.
    const refreshed = await bridge.questionnairesShareLink(q.id, true);
    expect(refreshed?.link).not.toBe(first?.link);
    // …and the refreshed one is now what "Share link" shows from then on (stable again).
    expect(await bridge.questionnairesShareLink(q.id)).toEqual(refreshed);
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

  it('generates → reads → deletes a dream image, gated by consent + key + dreams.generateImage', async () => {
    const { bridge } = await freshOwner();
    const dream = await bridge.dreamSave({
      narrative: 'rooms that rearrange',
      lucid: false,
      nightmare: false,
      tags: [],
      people: [],
      sensitivity: 'standard',
    });

    // No consent yet → refused before any provider call.
    expect(await bridge.dreamGenerateImage({ dreamId: dream.id })).toMatchObject({
      ok: false,
      reason: 'NO_CONSENT',
    });
    await bridge.setSetting({ key: 'dreams.imageGenerationEnabled', value: true, scope: 'vault' });

    // Consent on but no OpenAI key → refused.
    expect(await bridge.dreamGenerateImage({ dreamId: dream.id })).toMatchObject({
      ok: false,
      reason: 'NO_KEY',
    });

    await bridge.secretSet({ id: OPENAI_API_KEY_ID, value: 'sk-openai' });
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-ant' });
    expect(await bridge.dreamGenerateImage({ dreamId: dream.id })).toMatchObject({
      ok: true,
      mime: 'image/png',
    });

    // The encrypted bytes round-trip back as base64 + the descriptor is stamped (model from settings).
    const img = await bridge.dreamGetImage({ dreamId: dream.id });
    expect(img?.mime).toBe('image/png');
    expect((img?.dataBase64.length ?? 0) > 0).toBe(true);
    expect((await bridge.dreamGet(dream.id))?.image?.model).toBe('gpt-image-2');

    await bridge.dreamDeleteImage({ dreamId: dream.id });
    expect(await bridge.dreamGetImage({ dreamId: dream.id })).toBeNull();
    expect((await bridge.dreamGet(dream.id))?.image).toBeUndefined();
  });

  it('exports an image, shares it with a related person, and the recipient reads it in "Shared with you"', async () => {
    const { bridge, ownerId } = await freshOwner();
    await bridge.setSetting({ key: 'dreams.imageGenerationEnabled', value: true, scope: 'vault' });
    await bridge.secretSet({ id: OPENAI_API_KEY_ID, value: 'sk-openai' });
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-ant' });

    // A related household person who can sign in.
    const partner = await bridge.peopleSave({ displayName: 'Partner', isSubject: true, tags: [] });
    await bridge.relationshipsSave({
      fromPersonId: ownerId,
      toPersonId: partner.id,
      type: 'partner',
    });
    await bridge.accessSetAccount({ personId: partner.id, roleId: 'member', pin: null });

    const dream = await bridge.dreamSave({
      narrative: 'a bright place of open doors',
      lucid: false,
      nightmare: false,
      tags: [],
      people: [],
      sensitivity: 'standard',
    });
    expect((await bridge.dreamGenerateImage({ dreamId: dream.id })).ok).toBe(true);

    // Export returns the (fake) saved path outside the vault.
    expect(await bridge.dreamExportImage({ dreamId: dream.id })).toContain('dream-image');

    // Share it with the partner.
    expect(
      await bridge.dreamSetImageShare({
        dreamId: dream.id,
        targetPersonId: partner.id,
        shared: true,
      }),
    ).toEqual({ ok: true });

    // The partner signs in → the image appears in their "Shared with you" + the bytes read back.
    expect((await bridge.sessionSetActive({ personId: partner.id })).ok).toBe(true);
    expect((await bridge.dreamListSharedImages()).map((s) => s.dreamId)).toEqual([dream.id]);
    expect(
      await bridge.dreamGetSharedImage({ dreamerId: ownerId, dreamId: dream.id }),
    ).not.toBeNull();
    // A partner without dreams.shareContext over someone else's dream still can't re-share it as theirs:
    // setImageShare is dreamer-scoped to the active person, so it targets the partner's OWN (absent) dream.
    expect(
      await bridge.dreamSetImageShare({ dreamId: dream.id, targetPersonId: ownerId, shared: true }),
    ).toEqual({ ok: false, reason: 'NOT_FOUND' });

    // Back to the owner → un-share → the partner no longer sees it (read-time re-gate).
    expect((await bridge.sessionSetActive({ personId: ownerId, pin: '1234' })).ok).toBe(true);
    await bridge.dreamSetImageShare({
      dreamId: dream.id,
      targetPersonId: partner.id,
      shared: false,
    });
    expect((await bridge.sessionSetActive({ personId: partner.id })).ok).toBe(true);
    expect(await bridge.dreamListSharedImages()).toEqual([]);
    expect(await bridge.dreamGetSharedImage({ dreamerId: ownerId, dreamId: dream.id })).toBeNull();
  });

  it('denies dream-image ops to a person without dreams.generateImage (a Guest)', async () => {
    const { bridge } = await freshOwner();
    const guest = await bridge.peopleSave({ displayName: 'Guest', isSubject: false, tags: [] });
    await bridge.accessSetAccount({ personId: guest.id, roleId: 'guest', pin: null });
    expect((await bridge.sessionSetActive({ personId: guest.id })).ok).toBe(true);
    expect(await bridge.dreamGenerateImage({ dreamId: 'd1' })).toMatchObject({
      ok: false,
      reason: 'ERROR',
    });
    expect(await bridge.dreamGetImage({ dreamId: 'd1' })).toBeNull();
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

  it('intake: a form submit fills the profile, the intimacy block is 18+-gated, and another member never sees the owner intake insight (scoped Memory)', async () => {
    const { bridge, host, ownerId } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    // A claude that returns a portrait with one restricted ('intimacy') fact + one normal ('basics') fact.
    host.host.claude = {
      send: () => Promise.resolve(''),
      stream: (_options, onDelta) => {
        const text = JSON.stringify({
          portrait: 'You care deeply and carry a lot.',
          facts: [
            { text: 'Works as a nurse', section: 'basics' },
            { text: 'Enjoys being dominant in bed', section: 'intimacy' },
          ],
          crisisFlag: false,
        });
        onDelta(text);
        return Promise.resolve({
          text,
          usage: { inputTokens: 5, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };

    // A structured form submit fills the owner-only profile fields — no AI spend.
    await bridge.intakeSubmitForm({ sectionId: 'basics', answers: { occupation: 'nurse' } });
    expect((await bridge.peopleList()).find((p) => p.id === ownerId)?.occupation).toBe('nurse');

    // The intimacy block is adult-gated IN THE BRIDGE: without the 18+ ack, the submit is a no-op.
    await bridge.intakeSubmitForm({
      sectionId: 'intimacy',
      answers: { sexualOrientation: ['Bisexual'], relationshipStyle: 'Open' },
    });
    expect(
      (await bridge.peopleList()).find((p) => p.id === ownerId)?.sexualOrientation,
    ).toBeUndefined();

    // After acknowledging 18+, the same submit fills the (private-by-default) orientation/style fields.
    await bridge.intakeAcknowledgeAdult();
    await bridge.intakeSubmitForm({
      sectionId: 'intimacy',
      answers: { sexualOrientation: ['Bisexual'], relationshipStyle: 'Open' },
    });
    const owner = (await bridge.peopleList()).find((p) => p.id === ownerId);
    expect(owner?.sexualOrientation).toBe('Bisexual');
    expect(owner?.relationshipStyle).toBe('Open');
    expect(owner?.privateFields).toEqual(
      expect.arrayContaining(['sexualOrientation', 'relationshipStyle']),
    );

    // Synthesize the portrait → an intake Insight with a restricted ('intimacy') fact.
    expect((await bridge.intakeSynthesize({})).ok).toBe(true);

    // In their OWN Memory, the person sees their own intake insight IN FULL — including their own
    // `restricted` facts (their own data; spec 20 §5.1 — no break-glass needed for one's own memory).
    const intakeInsight = (await bridge.insightsList()).find((i) => i.source === 'intake');
    expect(intakeInsight?.facts.some((f) => f.text.includes('nurse'))).toBe(true);
    expect(intakeInsight?.facts.some((f) => f.text.includes('dominant'))).toBe(true);

    // A DIFFERENT member sees ONLY their own memory — the owner's intake insight is absent entirely (not
    // merely redacted). Memory is per-person scoped now (spec 20 §1.1/§5.1): the cross-user leak is closed.
    const mara = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });
    expect((await bridge.sessionSetActive({ personId: mara.id })).ok).toBe(true);
    expect((await bridge.insightsList()).some((i) => i.source === 'intake')).toBe(false);
    expect(await bridge.insightsList()).toEqual([]); // brand-new member: nothing in their own memory yet
  });
});

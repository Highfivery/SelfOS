// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { memFileSystem } from '@selfos/core/host';
import { loadMasterKey, MASTER_KEY_ID } from '@selfos/core/crypto';
import { toBase64 } from '@selfos/core/encoding';
import type { ClaudeClient, FileSystem, ImageClient, SecretStore } from '@selfos/core/host';
import { flattenContent } from '@selfos/core/host';
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
import { getQuestionnaire } from '@selfos/core/questionnaires';
import { writeEncryptedJson } from '@selfos/core/vault';
import { listInsightsForPerson, saveInsight, summarizeForContext } from '@selfos/core/insights';
import { submitSectionForm } from '@selfos/core/intake';
import { getTest } from '@selfos/core/tests';
import { matrixRowKey } from '@selfos/core/schemas';
import { saveGoal } from '@selfos/core/goals';
import { listChallenges, recordCheckIn } from '@selfos/core/challenges';
import { buildContext } from '@selfos/core/people';
import { saveProposals } from '@selfos/core/story';
import {
  captureJointChallengeFromMarker,
  captureSuggestionFromMarker,
  pairKeyFor,
} from '@selfos/core/together';
import { queryUsage, recordUsage, setPersonBudget } from '@selfos/core/usage';
import { ANTHROPIC_API_KEY_ID, OPENAI_API_KEY_ID } from './channels';
import { DeviceStateSchema } from './schemas';
import type {
  BootState,
  DeviceState,
  ImageGenProgress,
  Insight,
  StoryDraftProgress,
} from './schemas';
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
  togetherChunks: string[];
  storyProgress: StoryDraftProgress[];
  imageProgress: ImageGenProgress[];
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
  const togetherChunks: string[] = [];
  const storyProgress: StoryDraftProgress[] = [];
  const imageProgress: ImageGenProgress[] = [];
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
      // The owner intimacy-topic suggester (08 §16.5a) — the brief lists existing topics. Return a set
      // including one EXISTING built-in ('Sensual massage') so the bridge test exercises the dedupe.
      if (userText.includes('Topics the Owner ALREADY has')) {
        return Promise.resolve({
          text: JSON.stringify({
            activities: ['Sensual massage', 'Mutual edging'],
            fantasies: ['Rivals-to-lovers roleplay'],
          }),
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      }
      // Goal suggestions (60 §3.1.3): "Propose the goals JSON." → a JSON array of goal objects, one carrying
      // an off-taxonomy life-area so the bridge test can assert the clamp drops it.
      if (userText.includes('Propose the goals JSON')) {
        return Promise.resolve({
          text: JSON.stringify([
            {
              text: 'Call your sister this week',
              lifeArea: 'Relationships',
              rationale: 'You miss her',
            },
            { text: 'Take a short walk most days', lifeArea: 'not-a-real-area' },
          ]),
          usage: { inputTokens: 3, outputTokens: 3, cacheWriteTokens: 0, cacheReadTokens: 0 },
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
      // Together wrap-up (58 §3.8): "write the wrap-up for this session between A and B" → a per-partner
      // report. crisisFlag is set for a partner whose attributed lines contain "CRISIS" so a test can assert
      // crisis routes to that twin only; the SHARED summary never carries the word.
      const wrapMatch = /write the wrap-up for this session between (.+?) and (.+?)\./.exec(
        userText,
      );
      if (wrapMatch) {
        const [, nameA, nameB] = wrapMatch;
        const crisisFor = (name: string): boolean =>
          new RegExp(`^${name}: .*CRISIS`, 'm').test(userText);
        return Promise.resolve({
          text: JSON.stringify({
            summary: 'You both showed up honestly.',
            themes: ['connection'],
            workedThrough: ['naming the pattern'],
            connectionValence: 0.4,
            frictionLevel: 0.2,
            partners: [
              {
                name: nameA,
                reflection: `A reflection for ${nameA}.`,
                facts: ['wants more time'],
                sensitiveFacts: [],
                crisisFlag: crisisFor(nameA ?? ''),
              },
              {
                name: nameB,
                reflection: `A reflection for ${nameB}.`,
                facts: ['values reassurance'],
                sensitiveFacts: ['a desire preference'],
                crisisFlag: crisisFor(nameB ?? ''),
              },
            ],
            // Concrete next steps → deduped standing pair agreements (§3.9). Same on every run, so a
            // reflect-then-wrap-up sequence exercises the de-dup (never doubles).
            actionItems: [
              { text: 'Set a weekly check-in time', timeframe: 'this week' },
              { text: 'Trade one appreciation each evening' },
            ],
          }),
          usage: { inputTokens: 5, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      }
      // A Together coach-initiated PRIVATE note (58 §3.14 Part B): when the turn text carries the trigger, the
      // coach emits a public reply PLUS a `[[SELFOS:PRIVATE]]` marker for Angel — the service mints a private
      // note scoped to her. Stripped from the shared reply by the service.
      if (userText.includes('PRIVATENOTE')) {
        onDelta('I hear you both.');
        return Promise.resolve({
          text: 'I hear you both. [[SELFOS:PRIVATE:{"to":"Angel","text":"PRIVATECOACHTEXT just for Angel."}]]',
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      }
      // Your Story foundations (64 §5.3): "plan a biography of" → a valid foundations JSON (essence +
      // timeline + outline). Must precede the generic `JSON object` branch (the message contains that phrase).
      if (userText.includes('plan a biography of')) {
        return Promise.resolve({
          text: JSON.stringify({
            title: 'The Weight of Quiet',
            essence: 'A quiet man learning to speak up.',
            timeline: [{ label: 'Born in Ohio', date: '1985' }],
            outline: {
              parts: [
                {
                  title: 'Roots',
                  chapters: [
                    {
                      title: 'The Garage',
                      brief: 'He learns a machine obeys.',
                      lifeAreas: ['Family'],
                    },
                  ],
                },
              ],
            },
          }),
          usage: { inputTokens: 5, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      }
      // Your Story chapter (64 §5.3): "WRITE THIS CHAPTER" → chapter prose with a source marker.
      if (userText.includes('WRITE THIS CHAPTER')) {
        return Promise.resolve({
          text: 'The garage smelled of cut pine and warm oil. [[SRC:s0]]\n\nHe watched, and said nothing.',
          usage: { inputTokens: 5, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      }
      // Your Story batch revision (64 §3.3.1): "REVISING one chapter" → the revised prose (a different line,
      // so the test can tell the revision from the original).
      if (userText.includes('REVISING one chapter')) {
        return Promise.resolve({
          text: 'The garage was quiet the day he finally spoke. [[SRC:s0]]',
          usage: { inputTokens: 5, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      }
      // Your Story gap pass (64 §3.7): the interview-engine scoring prompt → coverage + one prioritized gap.
      if (userText.includes('EIGHT KEY SCENES')) {
        return Promise.resolve({
          text: JSON.stringify({
            coverage: {
              chapters: true,
              scenes: { highPoint: true, lowPoint: false },
              challenges: false,
              ideology: false,
              futureScript: false,
            },
            gaps: [
              {
                dimension: 'lowPoint',
                label: 'A hard season',
                focus: 'Ask about a low point that stayed with them.',
                priority: 9,
              },
            ],
          }),
          usage: { inputTokens: 5, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      }
      // The story to-do→questions mint (64 §5.5) — matched by its distinctive brief so it doesn't intercept
      // the generic questionnaire-generation tests (which expect a non-JSON reply). Returns valid questions.
      if (userText.includes('Your biographer wants to go deeper on this for the book')) {
        return Promise.resolve({
          text: JSON.stringify({
            title: 'A few questions for your story',
            questions: [
              {
                type: 'shortText',
                prompt: 'What was that winter like, day to day?',
                required: false,
              },
              { type: 'shortText', prompt: 'Who was in the house with you then?', required: false },
            ],
          }),
          usage: { inputTokens: 5, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      }
      // Dream synthesis asks for a single JSON object — return a valid DreamAnalysis draft so the
      // synthesize path can parse it; every other turn just streams a short reply.
      const wantsJson = options.messages.some((m) =>
        flattenContent(m.content).includes('JSON object'),
      );
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
        : // A guided couples turn: append a step marker when the user asks to move to "step two" (§3.10),
          // so the derived-step test bites. Stripped from the saved text by the service.
          /step two/i.test(userText)
          ? 'On to the next step. [[SELFOS:STEP:1]]'
          : 'hi';
      onDelta('hi');
      return Promise.resolve({
        text,
        usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
      });
    },
  };
  const image: ImageClient = {
    verify: () => Promise.resolve(),
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
    emitTogetherChunk: (chunk) => togetherChunks.push(chunk),
    getBootState: () => Promise.resolve(bootFromDevice()),
    refreshBootState: () => Promise.resolve(bootFromDevice()),
    selectVaultFolder: () => Promise.resolve(null),
    useVault: () => Promise.resolve(ready),
    getConflicts: () => Promise.resolve([]),
    revealVault: () => Promise.resolve(),
    openExternal: () => Promise.resolve(),
    checkForUpdate: () => Promise.resolve(null),
    saveImageFile: (name) => Promise.resolve(`/tmp/${name}`),
    printToPdf: (html) => Promise.resolve(new TextEncoder().encode(`%PDF-fake\n${html.length}`)),
    onVaultChanged: () => () => {},
    emitStoryProgress: (p) => storyProgress.push(p),
    emitImageProgress: (p) => imageProgress.push(p),
    onChatChunk: () => () => {},
    onDreamChunk: () => () => {},
    onIntakeChunk: () => () => {},
    onTogetherChunk: () => () => {},
    onStoryProgress: () => () => {},
    onImageProgress: () => () => {},
  };
  return {
    host,
    fs,
    chunks,
    dreamChunks,
    intakeChunks,
    togetherChunks,
    storyProgress,
    imageProgress,
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

  it('vault sync-safety (33 §5.D): a still-syncing fresh folder is not ready; an initialized one is', async () => {
    const host = makeHost();
    const bridge = createCoreBridge(host.host);
    // Fresh folder (no recovery.enc) + pending iCloud downloads → warn, don't offer Setup.
    host.host.hasPendingDownloads = () => Promise.resolve(true);
    expect(await bridge.vaultSyncReadiness()).toEqual({ ready: false, reason: 'icloud-pending' });
    // Once initialized (recovery.enc present), it's ready regardless of pending downloads.
    await bridge.householdSetup({ ownerName: 'Ben', pin: '1234' });
    expect(await bridge.vaultSyncReadiness()).toEqual({ ready: true });
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

  it('auto-share (25 §5.6): an owner saving a key shares it automatically → a member inherits, no manual step', async () => {
    const { bridge, host } = await freshOwner();
    // The owner just SAVES a key — no explicit share call. The recurring-bug fix.
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-auto' });
    expect(await host.fs.read('config/ai-credentials.enc')).not.toBeNull();
    expect(await bridge.aiKeyStatus({ provider: 'anthropic' })).toMatchObject({
      hasSharedKey: true,
    });

    // A member on their own device (no device key) inherits it with zero setup.
    await bridge.secretClear({ id: ANTHROPIC_API_KEY_ID });
    const member = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: member.id, roleId: 'member', pin: null });
    await bridge.sessionSetActive({ personId: member.id });
    expect(await bridge.aiKeyStatus({ provider: 'anthropic' })).toMatchObject({
      source: 'shared',
      resolvedReady: true,
    });
  });

  it('auto-share (25 §5.6): a member overriding with their OWN key does not auto-share it', async () => {
    const { bridge, host } = await freshOwner();
    const member = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: member.id, roleId: 'member', pin: null });
    await bridge.sessionSetActive({ personId: member.id });
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-member-own' });
    // The member's key stays device-local — never written to the household-shared vault file.
    expect(await host.fs.read('config/ai-credentials.enc')).toBeNull();
    expect(await bridge.aiKeyStatus({ provider: 'anthropic' })).toMatchObject({
      hasSharedKey: false,
      source: 'device',
    });
  });

  it('auto-share opt-out (25 §5.6): with ai.shareCredentials off, an owner key stays device-local; toggling re-shares', async () => {
    const { bridge } = await freshOwner();
    await bridge.setSetting({ key: 'ai.shareCredentials', value: false, scope: 'vault' });
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-private' });
    expect(await bridge.aiKeyStatus({ provider: 'anthropic' })).toMatchObject({
      hasSharedKey: false,
      source: 'device',
    });
    // Turning sharing back ON shares the current device key immediately…
    await bridge.setSetting({ key: 'ai.shareCredentials', value: true, scope: 'vault' });
    expect((await bridge.aiKeyStatus({ provider: 'anthropic' })).hasSharedKey).toBe(true);
    // …and turning it OFF withdraws it from the vault.
    await bridge.setSetting({ key: 'ai.shareCredentials', value: false, scope: 'vault' });
    expect((await bridge.aiKeyStatus({ provider: 'anthropic' })).hasSharedKey).toBe(false);
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

  it('device registry (28): setup registers this device; a member cannot list/rename (owner-only)', async () => {
    const { bridge, host } = await freshOwner();
    // Setup registered this device into the vault; the owner can list it + sees "this device".
    const devices = await bridge.devicesList();
    expect(devices).toHaveLength(1);
    expect(devices[0]?.isThisDevice).toBe(true);
    const myId = devices[0]!.deviceId;
    expect(host.device().deviceId).toBe(myId); // the key-free anchor is cached device-local

    // Owner renames it.
    await bridge.devicesRename({ deviceId: myId, label: 'Studio Mac' });
    expect((await bridge.devicesList())[0]?.label).toBe('Studio Mac');

    // A member is denied: list returns empty, rename rejects (the bridge is the boundary).
    const member = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: member.id, roleId: 'member', pin: null });
    await bridge.sessionSetActive({ personId: member.id });
    expect(await bridge.devicesList()).toEqual([]);
    await expect(bridge.devicesRename({ deviceId: myId, label: 'hax' })).rejects.toThrow(
      'Not permitted',
    );
  });

  it('key rotation (28): owner rotates → new phrase; an old-key device is signed out (§5.5)', async () => {
    const { bridge, host } = await freshOwner();
    const oldKey = await host.host.secrets.get(MASTER_KEY_ID);
    expect(oldKey).not.toBeNull();

    const result = await bridge.keysRotate({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.recoveryPhrase.length).toBeGreaterThan(0);
      expect(result.reencryptedFileCount).toBeGreaterThan(0);
    }
    // The owner keeps working on the new key.
    expect((await bridge.householdStatus()).hasMasterKey).toBe(true);

    // Simulate a device that still holds the OLD key → re-key detection signs it out + clears the stale key.
    await host.host.secrets.set(MASTER_KEY_ID, oldKey!);
    const status = await bridge.householdStatus();
    expect(status.hasMasterKey).toBe(false);
    expect(await host.host.secrets.get(MASTER_KEY_ID)).toBeNull();
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
        const last = flattenContent(options.messages.at(-1)?.content ?? '');
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

  it('session analysis emits a DEPTH invitation (restricted from the catalog), own-scoped (29)', async () => {
    const { bridge, host } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    host.host.claude = {
      send: () => Promise.resolve(''),
      stream: (options, onDelta) => {
        const last = flattenContent(options.messages.at(-1)?.content ?? '');
        if (last.includes('summarize this session')) {
          // The same paid pass was handed the unexplored-areas context (29 §5.2).
          expect(options.system ?? '').toContain('Profile areas they have not explored yet');
          const text = JSON.stringify({
            summary: 'A reflective check-in about a hard time.',
            themes: ['the past'],
            goals: [],
            followUps: [],
            people: [],
            moodValence: -0.1,
            moodEnergy: 0,
            // weighs is a RESTRICTED catalog section — the invitation must inherit that.
            depthInvitations: [
              {
                sectionId: 'weighs',
                theme: 'a hard time growing up',
                rationale: 'it keeps coming up',
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
    await bridge.chatStream({ conversationId: 'c1', userText: 'thinking about my childhood' });
    expect((await bridge.sessionsEndAndSummarize({ conversationId: 'c1' })).ok).toBe(true);

    const depth = (await bridge.profileSuggestions()).filter((s) => s.kind === 'depth');
    expect(depth).toHaveLength(1);
    expect(depth[0]).toMatchObject({ kind: 'depth', sectionId: 'weighs', restricted: true });

    // Own-scoped: a different person never sees it.
    const mara = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });
    await bridge.sessionSetActive({ personId: mara.id });
    expect((await bridge.profileSuggestions()).filter((s) => s.kind === 'depth')).toHaveLength(0);
  });

  it('weaves the in-session depth ask into the chat prompt (default on), and not when off (29 §3.5)', async () => {
    const { bridge, host } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    let captured = '';
    host.host.claude = {
      send: () => Promise.resolve(''),
      stream: (options, onDelta) => {
        captured = options.system ?? '';
        onDelta('ok');
        return Promise.resolve({
          text: 'ok',
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    // Default ON → the coach is handed the unexplored invited sections to (relevantly) invite.
    await bridge.chatStream({ conversationId: 'c1', userText: 'hello' });
    expect(captured).toContain("haven't filled in yet");
    // Turn it off → cards-only; no in-session ask in the prompt.
    await bridge.setSetting({ key: 'intake.inSessionDepthAsk', value: false, scope: 'vault' });
    captured = '';
    await bridge.chatStream({ conversationId: 'c2', userText: 'hello again' });
    expect(captured).not.toContain("haven't filled in yet");
  });

  it('weaves the in-session goal-raise into the chat prompt when a goal exists, and not when off (40 §3.1)', async () => {
    const { bridge, host, ownerId } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    const ctx = (await host.host.vaultAndKey())!;
    await saveGoal(ctx.fs, ctx.key, {
      id: 'g1',
      schemaVersion: 1,
      subjectPersonId: ownerId,
      text: 'finish the side project',
      status: 'open',
      provenance: { at: '2026-01-01T00:00:00.000Z' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    let captured = '';
    host.host.claude = {
      send: () => Promise.resolve(''),
      stream: (options, onDelta) => {
        captured = options.system ?? '';
        onDelta('ok');
        return Promise.resolve({
          text: 'ok',
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    // Default 'gentle' → the coach is told it may proactively follow up on the open commitment.
    await bridge.chatStream({ conversationId: 'c1', userText: 'hello' });
    expect(captured).toContain('finish the side project');
    expect(captured).toContain('never turn the session into a progress review'); // the §3.1 instruction

    // Off → the proactive instruction is gone (the passive spec-39 grounding line may still mention the
    // goal, but the behavioural raise is suppressed).
    expect((await bridge.coachingSetPrefs({ proactivity: 'off' }))?.proactivity).toBe('off');
    captured = '';
    await bridge.chatStream({ conversationId: 'c2', userText: 'hello again' });
    expect(captured).not.toContain('never turn the session into a progress review');
  });

  it('coaching prefs round-trip and are per-person (40 §4.1a)', async () => {
    const { bridge } = await freshOwner();
    // Default when unset.
    expect(await bridge.coachingGetPrefs()).toEqual({ schemaVersion: 1 });
    // The owner sets 'active'.
    await bridge.coachingSetPrefs({ proactivity: 'active' });
    expect((await bridge.coachingGetPrefs())?.proactivity).toBe('active');

    // A member tunes their OWN coach independently — the owner's choice is untouched (per-person isolation).
    const member = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: member.id, roleId: 'member', pin: null });
    await bridge.sessionSetActive({ personId: member.id });
    expect(await bridge.coachingGetPrefs()).toEqual({ schemaVersion: 1 }); // member's own default
    await bridge.coachingSetPrefs({ proactivity: 'off' });
    expect((await bridge.coachingGetPrefs())?.proactivity).toBe('off');
  });

  it('runs + caches the cross-feature synthesis; throttles auto; off + thin disable it (40 §3.3/§3.4)', async () => {
    const { bridge, host, ownerId } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    const ctx = (await host.host.vaultAndKey())!;
    const seedInsight = (id: string): Promise<void> =>
      saveInsight(ctx.fs, ctx.key, {
        id,
        schemaVersion: 1,
        source: 'session',
        subjectPersonId: ownerId,
        summary: `reflected on ${id}`,
        facts: [{ id: `${id}f`, text: `a fact ${id}`, shareable: false }],
        confidence: 'medium',
        categories: ['Relationships'],
        approved: true,
        provenance: { conversationId: id, at: new Date().toISOString() },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

    // A thin profile (no insights) → EMPTY, no spend.
    expect((await bridge.coachingSynthesize({})).ok).toBe(false);

    await seedInsight('s1');
    await seedInsight('s2');
    await seedInsight('s3');

    // The synthesis turn gets a JSON observation; everything else streams 'ok'.
    host.host.claude = {
      send: () => Promise.resolve(''),
      stream: (options, onDelta) => {
        const last = flattenContent(options.messages.at(-1)?.content ?? '');
        if (last.includes('Recent reflections across this person')) {
          return Promise.resolve({
            text: JSON.stringify({
              observation: 'Connection keeps surfacing across your recent reflections.',
              sources: ['sessions'],
              lifeArea: 'Relationships',
            }),
            usage: { inputTokens: 8, outputTokens: 8, cacheWriteTokens: 0, cacheReadTokens: 0 },
          });
        }
        onDelta('ok');
        return Promise.resolve({
          text: 'ok',
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };

    // A manual run produces + caches the observation, metered.
    const manual = await bridge.coachingSynthesize({});
    expect(manual.ok).toBe(true);
    if (manual.ok) expect(manual.synthesis.observation).toContain('Connection');
    expect((await bridge.coachingGetSynthesis())?.observation).toContain('Connection');
    const usage = await bridge.usageSummary({ scope: 'person', period: 'month' });
    expect(usage.byType['coaching.synthesize']?.count).toBe(1);

    // An AUTOMATIC run right after is throttled (just synthesized) → EMPTY, no second spend.
    const auto = await bridge.coachingSynthesize({ auto: true });
    expect(auto).toMatchObject({ ok: false, reason: 'EMPTY' });
    expect(
      (await bridge.usageSummary({ scope: 'person', period: 'month' })).byType[
        'coaching.synthesize'
      ]?.count,
    ).toBe(1);

    // Proactivity off disables it entirely (the cached one stays readable, but a run is a calm no-op).
    await bridge.coachingSetPrefs({ proactivity: 'off' });
    expect((await bridge.coachingSynthesize({})).ok).toBe(false);
    expect((await bridge.coachingGetSynthesis())?.observation).toContain('Connection');
  });

  it('the daily-reflection toggle + crisis suppress the AUTO reflection without spending (60 §6.3/§8)', async () => {
    const { bridge, host, ownerId } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    const ctx = (await host.host.vaultAndKey())!;
    let synthesisCalls = 0;
    host.host.claude = {
      send: () => Promise.resolve(''),
      stream: () => {
        synthesisCalls += 1;
        return Promise.resolve({
          text: JSON.stringify({ observation: 'x', sources: [] }),
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    const seed = (id: string, crisisFlag = false): Promise<void> =>
      saveInsight(ctx.fs, ctx.key, {
        id,
        schemaVersion: 1,
        source: 'session',
        subjectPersonId: ownerId,
        summary: `reflected on ${id}`,
        facts: [],
        confidence: 'medium',
        categories: ['Relationships'],
        approved: true,
        ...(crisisFlag ? { crisisFlag: true } : {}),
        provenance: { conversationId: id, at: new Date().toISOString() },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    await seed('a');
    await seed('b');
    await seed('c');

    // Daily reflection OFF → the auto pass is a calm no-op (proactivity stays gentle); zero spend.
    await bridge.coachingSetPrefs({ dailyReflection: false });
    expect(await bridge.coachingSynthesize({ auto: true })).toMatchObject({
      ok: false,
      reason: 'EMPTY',
    });
    expect(synthesisCalls).toBe(0);
    // The toggle merged — proactivity is untouched.
    expect((await bridge.coachingGetPrefs())?.proactivity ?? 'gentle').toBe('gentle');

    // Re-enable, but a recurring-crisis signal (≥2 flags in 14 days) suppresses the auto reflection.
    await bridge.coachingSetPrefs({ dailyReflection: true });
    await seed('x1', true);
    await seed('x2', true);
    expect(await bridge.coachingSynthesize({ auto: true })).toMatchObject({
      ok: false,
      reason: 'EMPTY',
    });
    expect(synthesisCalls).toBe(0);
  });

  describe('auto check-ins (63)', () => {
    it('config get/set round-trips and defaults to off', async () => {
      const { bridge } = await freshOwner();
      expect(await bridge.autoCheckinsGetConfig()).toMatchObject({ enabled: false, targets: [] });
      await bridge.autoCheckinsSetConfig({
        enabled: true,
        targets: [
          {
            id: 't-self',
            target: { kind: 'self' },
            enabled: true,
            includeIntimacy: true,
            explorationFocus: '',
            cadence: 'daily',
          },
        ],
      });
      const config = await bridge.autoCheckinsGetConfig();
      expect(config?.enabled).toBe(true);
      expect(config?.targets).toHaveLength(1);
    });

    it('owner-gate (§3.6): only an owner may target ANOTHER person', async () => {
      const { bridge, ownerId } = await freshOwner();
      const partner = await bridge.peopleSave({ displayName: 'Angel', isSubject: true, tags: [] });
      // The OWNER may add a person-target.
      await bridge.autoCheckinsSetConfig({
        enabled: true,
        targets: [
          {
            id: 't-other',
            target: { kind: 'person', personId: partner.id },
            enabled: true,
            includeIntimacy: false,
            explorationFocus: '',
            cadence: 'daily',
          },
        ],
      });
      expect((await bridge.autoCheckinsGetConfig())?.targets).toHaveLength(1);

      // A non-owner MEMBER may NOT — the write is rejected (their own config never gains the person-target).
      await bridge.accessSetAccount({ personId: partner.id, roleId: 'member', pin: null });
      await bridge.sessionSetActive({ personId: partner.id });
      await bridge.autoCheckinsSetConfig({
        enabled: true,
        targets: [
          {
            id: 't-x',
            target: { kind: 'person', personId: ownerId },
            enabled: true,
            includeIntimacy: false,
            explorationFocus: '',
            cadence: 'daily',
          },
        ],
      });
      const memberConfig = await bridge.autoCheckinsGetConfig();
      expect(memberConfig?.targets.some((t) => t.target.kind === 'person')).toBe(false);
    });

    it('run is gated (off → SKIPPED; enabled + no key → AI_OFF) and ensureSeed skips a pre-onboarding person', async () => {
      const { bridge } = await freshOwner();
      expect(await bridge.autoCheckinsRun()).toMatchObject({ ok: false, reason: 'SKIPPED' });
      await bridge.autoCheckinsSetConfig({
        enabled: true,
        targets: [
          {
            id: 't-self',
            target: { kind: 'self' },
            enabled: true,
            includeIntimacy: true,
            explorationFocus: '',
            cadence: 'daily',
          },
        ],
      });
      expect(await bridge.autoCheckinsRun()).toMatchObject({ ok: false, reason: 'AI_OFF' });
      // The owner hasn't completed onboarding → no seed (write-once, onboarding-gated).
      expect((await bridge.autoCheckinsEnsureSeed())?.seeded).toBe(false);
    });
  });

  it('challenges (52): start → capture a marker → list → check in → decrypt the Insight', async () => {
    const { bridge, host, ownerId } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    // The challenge-coach turn emits a real marker on an agreement message; everything else streams 'ok'.
    host.host.claude = {
      send: () => Promise.resolve(''),
      stream: (options, onDelta) => {
        if ((options.system ?? '').includes('helping them take on a small CHALLENGE')) {
          const marker =
            '[[SELFOS:CHALLENGE:{"action":"Call one friend","comfort":2,"lifeArea":"Relationships","checkInDays":7}]]';
          onDelta('Set.');
          return Promise.resolve({
            text: `Set. ${marker}`,
            usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
          });
        }
        onDelta('ok');
        return Promise.resolve({
          text: 'ok',
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    const started = await bridge.challengesStart({});
    expect(started?.conversationId).toBeTruthy();
    const turn = await bridge.chatStream({
      conversationId: started!.conversationId,
      userText: "yes let's do it",
    });
    expect(turn.ok).toBe(true);
    if (turn.ok) expect(turn.challengeCreated?.action).toBe('Call one friend');

    const list = await bridge.challengesList();
    expect(list).toHaveLength(1);
    expect(list[0]!.status).toBe('active');

    // Decrypt the vault to assert the persisted record is real + own-scoped.
    const ctx = (await host.host.vaultAndKey())!;
    const persisted = await listChallenges(ctx.fs, ctx.key, ownerId);
    expect(persisted[0]!.action).toBe('Call one friend');
    expect(persisted[0]!.conversationId).toBe(started!.conversationId);

    // Inline check-in → done + a reflection Insight that feeds the person's OWN context (provenance.challengeId).
    const checkIn = await bridge.challengesCheckIn({
      challengeId: list[0]!.id,
      outcome: 'did',
      reflection: 'went better than I feared',
    });
    expect(checkIn.ok).toBe(true);
    expect((await bridge.challengesGet({ challengeId: list[0]!.id }))?.status).toBe('done');
    const insights = await listInsightsForPerson(ctx.fs, ctx.key, ownerId);
    expect(insights.some((i) => i.provenance.challengeId === list[0]!.id)).toBe(true);
  });

  it('challenges (52 §8.3): an intimacy-domain start is withheld until the 18+ ack', async () => {
    const { bridge } = await freshOwner();
    // Un-acked → refused (enforced in the bridge, not just the UI).
    expect(await bridge.challengesStart({ domain: 'intimacy' })).toBeNull();
    // A non-intimacy domain works regardless.
    expect(await bridge.challengesStart({ domain: 'habit' })).not.toBeNull();
    // Acknowledging unlocks the intimacy domain.
    await bridge.guidedAcknowledgeAdult();
    expect(await bridge.challengesStart({ domain: 'intimacy' })).not.toBeNull();
  });

  it('challenges (52 §8.3): the EXPLICIT sexual register is withheld from a challenge turn until the ack', async () => {
    const { bridge, host } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    const systems: string[] = [];
    host.host.claude = {
      send: () => Promise.resolve(''),
      stream: (options, onDelta) => {
        systems.push(options.system ?? '');
        onDelta('ok');
        return Promise.resolve({
          text: 'ok',
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    // Un-acked: a (non-intimacy) challenge session's turn must NOT carry the explicit register, even though the
    // person could steer toward sex — the addendum's gated stance redirects to the 18+ option instead.
    const started = (await bridge.challengesStart({}))!;
    await bridge.chatStream({
      conversationId: started.conversationId,
      userText: 'tell me about sex',
    });
    expect(systems.at(-1)).not.toContain('consensual adults only');
    expect(systems.at(-1)).toContain('keep THIS challenge non-sexual');
    // After the ack, a fresh challenge turn DOES carry the explicit register.
    await bridge.guidedAcknowledgeAdult();
    const acked = (await bridge.challengesStart({}))!;
    await bridge.chatStream({ conversationId: acked.conversationId, userText: 'hi' });
    expect(systems.at(-1)).toContain('consensual adults only');
  });

  it('challenges (52 §5.3): the suggester is metered challenge.suggest + caches the candidate', async () => {
    const { bridge, host, ownerId } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    const ctx = (await host.host.vaultAndKey())!;
    await saveInsight(ctx.fs, ctx.key, {
      id: 'i1',
      schemaVersion: 1,
      source: 'session',
      subjectPersonId: ownerId,
      summary: 'wants steadier evenings',
      facts: [{ id: 'f1', text: 'mentioned wanting more movement', shareable: false }],
      confidence: 'medium',
      categories: ['Health & body'],
      approved: true,
      provenance: { conversationId: 'i1', at: new Date().toISOString() },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    host.host.claude = {
      send: () => Promise.resolve(''),
      stream: (options) => {
        if ((options.system ?? '').includes('proposing ONE small')) {
          return Promise.resolve({
            text: JSON.stringify({
              action: 'Take a 10-minute walk after dinner three times this week',
              why: 'You mentioned wanting more movement.',
              comfort: 2,
              lifeArea: 'Health & body',
              domain: 'habit',
            }),
            usage: { inputTokens: 5, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 },
          });
        }
        return Promise.resolve({
          text: 'ok',
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    const result = await bridge.challengesSuggest({});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.suggestion.action).toContain('10-minute walk');
    expect(
      (await bridge.usageSummary({ scope: 'person', period: 'month' })).byType['challenge.suggest']
        ?.count,
    ).toBe(1);
    expect((await bridge.challengesGetSuggestion())?.action).toContain('10-minute walk');
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

  describe('session attachments (45 §6)', () => {
    const base64 = toBase64(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]));

    it('store → get round-trips (mime sniffed), exports outside the vault, and is denied without sessions.own', async () => {
      const { bridge } = await freshOwner();
      const ref = await bridge.conversationStoreAttachment({
        conversationId: 'conv1',
        base64,
        mime: 'image/png',
      });
      if ('ok' in ref) throw new Error('expected a ref');
      expect(ref.path).toMatch(/^people\/.+\/conversations\/conv1\/attachments\/.+\.enc$/);

      const got = await bridge.conversationGetAttachment({
        conversationId: 'conv1',
        path: ref.path,
      });
      expect(got).toEqual({ mime: 'image/png', dataBase64: base64 });
      expect(
        await bridge.conversationExportAttachment({ conversationId: 'conv1', path: ref.path }),
      ).toContain('/tmp/session-image.');

      // A guest (no sessions.own) is denied store / get / export — the bridge is the trust boundary.
      const guest = await bridge.peopleSave({ displayName: 'Guest', isSubject: false, tags: [] });
      await bridge.accessSetAccount({ personId: guest.id, roleId: 'guest', pin: null });
      await bridge.sessionSetActive({ personId: guest.id });
      expect(
        await bridge.conversationStoreAttachment({
          conversationId: 'conv1',
          base64,
          mime: 'image/png',
        }),
      ).toMatchObject({ ok: false, reason: 'NOT_FOUND' });
      expect(
        await bridge.conversationGetAttachment({ conversationId: 'conv1', path: ref.path }),
      ).toBeNull();
      expect(
        await bridge.conversationExportAttachment({ conversationId: 'conv1', path: ref.path }),
      ).toBeNull();
    });

    it('rejects reading/exporting an attachment addressed via a DIFFERENT conversation (prefix re-check)', async () => {
      const { bridge } = await freshOwner();
      const ref = await bridge.conversationStoreAttachment({
        conversationId: 'conv1',
        base64,
        mime: 'image/png',
      });
      if ('ok' in ref) throw new Error('expected a ref');
      // Same file, but a path that doesn't sit under conv2's attachments dir → null.
      expect(
        await bridge.conversationGetAttachment({ conversationId: 'conv2', path: ref.path }),
      ).toBeNull();
      expect(
        await bridge.conversationExportAttachment({ conversationId: 'conv2', path: ref.path }),
      ).toBeNull();
    });

    it('rejects a traversal conversationId on store (no path escape) and re-validates mime', async () => {
      const { bridge } = await freshOwner();
      await expect(
        bridge.conversationStoreAttachment({
          conversationId: '../../config',
          base64,
          mime: 'image/png',
        }),
      ).rejects.toThrow();
      expect(
        await bridge.conversationStoreAttachment({
          conversationId: 'conv1',
          base64,
          mime: 'image/heic',
        }),
      ).toMatchObject({ ok: false, reason: 'UNSUPPORTED' });
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

  it('insightsList enriches a sent-questionnaire insight with WHO it is about (#129), incl. a pre-#129 one', async () => {
    const { bridge, ownerId, host } = await freshOwner();
    const partner = await bridge.peopleSave({ displayName: 'Angel', isSubject: true, tags: [] });
    const ctx = (await host.host.vaultAndKey())!;

    // A questionnaire the owner sent to the partner.
    const saved = await bridge.questionnairesSave({
      title: 'How are we doing?',
      type: 'role-feedback',
      sensitivity: 'standard',
      recipient: { kind: 'person', personId: partner.id },
      questions: [{ id: 'q1', type: 'shortText', prompt: 'How are we?', required: true }],
    });
    const { assignment } = await bridge.assignmentsCreate({ questionnaireId: saved.id });

    // A PRE-#129 insight from that send: subject = the owner (sender), NO about* stamped in provenance.
    const at = new Date().toISOString();
    await saveInsight(ctx.fs, ctx.key, {
      id: 'i-legacy',
      schemaVersion: 1,
      source: 'questionnaire',
      subjectPersonId: ownerId,
      summary: 'Angel wants more protected time together.',
      facts: [{ id: 'f1', text: 'Wants more date nights', shareable: true }],
      confidence: 'medium',
      categories: ['Relationships'],
      approved: true,
      provenance: { assignmentId: assignment.id, at }, // legacy: no aboutPersonId
      createdAt: at,
      updatedAt: at,
    });

    const listed = await bridge.insightsList();
    const enriched = listed.find((i) => i.id === 'i-legacy');
    expect(enriched?.provenance.aboutPersonId).toBe(partner.id); // resolved read-time from the assignment
    expect(enriched?.subjectPersonId).toBe(ownerId); // unchanged — it still informs the sender's coaching
  });

  it('gates AI authoring on questionnaires.create and runs the metered path for the owner', async () => {
    const { bridge } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    const req = {
      type: 'role-feedback',
      sensitivity: 'standard' as const,
      existingPrompts: [],
    };
    // Owner with a key: the call runs past the gate + reaches Claude (the fake host returns non-JSON, so it
    // gracefully fails with an honest MALFORMED — proving the gate passed and the metered path executed; 37
    // §3.2 reclassified a no-JSON reply from the old catch-all REFUSED to MALFORMED).
    const gen = await bridge.questionnairesGenerate(req);
    expect(gen.ok).toBe(false);
    expect(gen.reason).toBe('MALFORMED');

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

    // The recipient's prior prompt reached the MODEL as known-data grounding, with the "don't recite" clause…
    expect(sentUserText).toContain('What is your secret codeword?');
    expect(sentUserText).toMatch(/Weave this knowledge in NATURALLY/i);
    // …but it is NEVER returned to the renderer — the author only gets the generated questions.
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result.questions)).not.toContain('secret codeword');
    expect(JSON.stringify(result)).not.toContain('secret codeword');
  });

  it('passes the chosen count to the model and hard-drops a re-ask of a prior question (§23.4/§23.5)', async () => {
    const { host, bridge } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    const mara = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });
    const prior = await bridge.questionnairesSave({
      title: 'Earlier',
      type: 'general',
      sensitivity: 'standard',
      recipient: { kind: 'person', personId: mara.id },
      questions: [
        { id: 'p1', type: 'shortText', prompt: 'What is your secret codeword?', required: true },
      ],
    });
    await bridge.assignmentsCreate({ questionnaireId: prior.id });

    let sentUserText = '';
    host.host.claude = {
      send: () => Promise.resolve(''),
      stream: (options, onDelta) => {
        sentUserText = options.messages.map((m) => m.content).join('\n');
        // The model returns a near-repeat of the prior prompt AND a genuinely new one — the deterministic
        // filter must drop the repeat and keep the fresh one (so only 1 remains, the semantic pass is skipped).
        const json = JSON.stringify({
          title: 'X',
          questions: [
            { type: 'shortText', prompt: "What's your secret codeword lately?", required: false },
            {
              type: 'shortText',
              prompt: 'What are you most proud of this month?',
              required: false,
            },
          ],
        });
        onDelta(json);
        return Promise.resolve({
          text: json,
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };

    const result = await bridge.questionnairesGenerate({
      type: 'general',
      sensitivity: 'standard',
      existingPrompts: [],
      recipientPersonId: mara.id,
      count: 8,
    });
    // The requested count (over-asked by the §23.5 buffer for a recipient with history) reached the prompt…
    expect(sentUserText).toMatch(/Draft 11 questions/);
    // …and the re-ask of the prior prompt was hard-dropped, keeping only the genuinely-new question.
    expect(result.ok).toBe(true);
    expect(result.questions?.map((q) => q.prompt)).toEqual([
      'What are you most proud of this month?',
    ]);
  });

  it('intimacy generation feeds the recipient’s RAW onboarding ratings as "go deeper", never returns them (§19)', async () => {
    const { host, bridge, ownerId } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    const mara = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });
    // Seed Mara's onboarding intimacy answers directly (the raw matrix ratings) — the data generation used to
    // ignore, so it re-asked them. Owner stays active (the author); we write Mara's intake host-side.
    const ctx = (await host.host.vaultAndKey())!;
    await submitSectionForm(
      ctx.fs,
      ctx.key,
      mara.id,
      'intimacy',
      {
        getSpecific: true,
        ownAnatomy: 'Cock (penis)',
        partnerAnatomy: ['Pussy (vulva)'],
        activities: { 'oral-receiving': 5 },
      },
      new Date(),
    );

    let sentUserText = '';
    host.host.claude = {
      send: () => Promise.resolve(''),
      stream: (options, onDelta) => {
        sentUserText = options.messages.map((m) => m.content).join('\n');
        const json = JSON.stringify({
          title: 'X',
          questions: [{ type: 'shortText', prompt: 'A fresh, deeper question?', required: true }],
        });
        onDelta(json);
        return Promise.resolve({
          text: json,
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };

    const result = await bridge.questionnairesGenerate({
      type: 'intimacy',
      sensitivity: 'unfiltered',
      existingPrompts: [],
      recipientPersonId: mara.id,
    });
    expect(result.ok).toBe(true);
    // The rated act reached the MODEL as "already rated — go deeper", anatomy-resolved…
    expect(sentUserText).toContain('Receiving oral (blowjob)');
    expect(sentUserText).toMatch(/ALREADY RATED/);
    expect(sentUserText).toMatch(/go DEEPER/i);
    // …but the raw rating text is NEVER returned to the author (author-blind §17.4/§19.1).
    expect(JSON.stringify(result)).not.toContain('Receiving oral (blowjob)');
    expect(ownerId).toBeTruthy();
  });

  it('the SEMANTIC de-dup pass receives the recipient’s onboarding answers, led + untruncated (§23.5b)', async () => {
    const { host, bridge } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    const mara = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });
    const ctx = (await host.host.vaultAndKey())!;
    // Mara answered an onboarding intimacy question — the authoritative "already have data for this" material.
    await submitSectionForm(
      ctx.fs,
      ctx.key,
      mara.id,
      'intimacy',
      {
        getSpecific: true,
        ownAnatomy: 'Cock (penis)',
        partnerAnatomy: ['Pussy (vulva)'],
        activities: { 'oral-receiving': 5 },
      },
      new Date(),
    );

    // Capture EACH call: [0] = generation (returns 2 candidates so the pass runs), [1] = the semantic pass.
    const seen: string[] = [];
    let call = 0;
    host.host.claude = {
      send: () => Promise.resolve(''),
      stream: (options, onDelta) => {
        seen.push(options.messages.map((m) => m.content).join('\n'));
        const text =
          call === 0
            ? JSON.stringify({
                title: 'X',
                questions: [
                  { type: 'shortText', prompt: 'One fresh question?' },
                  { type: 'shortText', prompt: 'Two fresh question?' },
                ],
              })
            : '[1,2]';
        call += 1;
        onDelta(text);
        return Promise.resolve({
          text,
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };

    const result = await bridge.questionnairesGenerate({
      type: 'intimacy',
      sensitivity: 'unfiltered',
      existingPrompts: [],
      recipientPersonId: mara.id,
    });
    expect(result.ok).toBe(true);
    // The semantic pass ran (a 2nd call) and its reference LEADS with the onboarding answers — the exact
    // material that was previously truncated away, letting onboarding re-asks through.
    expect(seen).toHaveLength(2);
    const reference = seen[1] ?? '';
    expect(reference).toMatch(/ALREADY ANSWERED in their onboarding/);
    expect(reference).toContain('Receiving oral (blowjob)'); // the onboarding answer reaches the pass
    // …still author-blind: none of it comes back to the renderer.
    expect(JSON.stringify(result)).not.toContain('Receiving oral (blowjob)');
  });

  it('the semantic pass sees the recipient’s SESSION/reflection facts too (§24.3-A2), author-blind', async () => {
    const { host, bridge } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    const mara = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });
    const ctx = (await host.host.vaultAndKey())!;
    // A fact Mara revealed in a coaching SESSION (not onboarding, not a questionnaire) — the §24 gap: it used
    // to be excluded from the semantic reference, so a questionnaire could re-ask it.
    await saveInsight(ctx.fs, ctx.key, {
      id: 'sess1',
      schemaVersion: 1,
      source: 'session',
      subjectPersonId: mara.id,
      summary: 'Reflecting on work.',
      facts: [{ id: 'f1', text: 'Feels burned out at her nursing job.', shareable: false }],
      confidence: 'medium',
      categories: ['Work & purpose'],
      approved: true,
      provenance: { at: '2026-07-13T00:00:00.000Z' },
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
    });

    const seen: string[] = [];
    let call = 0;
    host.host.claude = {
      send: () => Promise.resolve(''),
      stream: (options, onDelta) => {
        seen.push(options.messages.map((m) => m.content).join('\n'));
        const text =
          call === 0
            ? JSON.stringify({
                title: 'X',
                questions: [
                  { type: 'shortText', prompt: 'One fresh question?' },
                  { type: 'shortText', prompt: 'Two fresh question?' },
                ],
              })
            : '[1,2]';
        call += 1;
        onDelta(text);
        return Promise.resolve({
          text,
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };

    const result = await bridge.questionnairesGenerate({
      type: 'general',
      sensitivity: 'standard',
      existingPrompts: [],
      recipientPersonId: mara.id,
    });
    expect(result.ok).toBe(true);
    const reference = seen[1] ?? '';
    expect(reference).toMatch(/ALREADY KNOWN about them from sessions/);
    expect(reference).toContain('Feels burned out at her nursing job.'); // the session fact reaches the pass
    expect(JSON.stringify(result)).not.toContain('burned out'); // author-blind
  });

  it('frames a CHILD recipient with the child register even when the edge is stored child→parent (§24.4-B2)', async () => {
    const { host, bridge, ownerId } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    const sam = await bridge.peopleSave({ displayName: 'Sam', isSubject: true, tags: [] });
    // Edge stored CHILD→PARENT (from Sam's editor): "the owner IS Sam's parent" → type 'parent'. The
    // recipient's role to the AUTHOR must still resolve to CHILD (the asymmetric-direction bug the fix closes).
    await bridge.relationshipsSave({ fromPersonId: sam.id, toPersonId: ownerId, type: 'parent' });
    let sent = '';
    host.host.claude = {
      send: () => Promise.resolve(''),
      stream: (options, onDelta) => {
        sent = options.messages.map((m) => m.content).join('\n');
        const json = JSON.stringify({
          title: 'X',
          questions: [{ type: 'shortText', prompt: 'Q?' }],
        });
        onDelta(json);
        return Promise.resolve({
          text: json,
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    const result = await bridge.questionnairesGenerate({
      type: 'general',
      sensitivity: 'standard',
      existingPrompts: [],
      recipientPersonId: sam.id,
    });
    expect(result.ok).toBe(true);
    expect(sent).toMatch(/for their CHILD/i); // resolved correctly despite the reversed edge…
    expect(sent).not.toMatch(/for their PARENT/i); // …NOT the raw edge type (which would be 'parent')
  });

  it('materializes a suggestion into a full generation; gated + non-household refused (§19.4)', async () => {
    const { host, bridge } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    const mara = await bridge.peopleSave({
      displayName: 'Mara',
      isSubject: true,
      tags: [],
      notes: 'Loves cooking; new job.',
    });

    // Stub the model: gap-finder returns a suggestion; generation returns a questionnaire WITH options.
    host.host.claude = {
      send: () => Promise.resolve(''),
      stream: (options, onDelta) => {
        const userText = options.messages.map((m) => m.content).join('\n');
        const text = userText.includes('Suggest up to 3 questionnaires')
          ? JSON.stringify([
              {
                title: 'Energy & rest',
                type: 'general',
                rationale: 'Worth a look.',
                questions: [{ type: 'yesNo', prompt: 'Rested lately?' }],
              },
            ])
          : JSON.stringify({
              title: 'Energy & rest',
              questions: [
                {
                  type: 'multiChoice',
                  prompt: 'Which drain you?',
                  required: false,
                  options: ['Meetings', 'Conflict', 'Noise'],
                },
              ],
            });
        onDelta(text);
        return Promise.resolve({
          text,
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };

    // Generate + save a suggestion, then materialize it.
    const gen = await bridge.questionnaireSuggestionsGenerate({ recipientPersonId: mara.id });
    const suggestionId = gen.saved?.[0]?.id ?? 'x';
    const result = await bridge.questionnaireSuggestionMaterialize({
      recipientPersonId: mara.id,
      suggestionId,
    });
    expect(result.ok).toBe(true);
    // The full generation came back WITH options (the blank-options bug is gone, §19.4).
    expect(result.questions?.[0]?.type).toBe('multiChoice');
    expect(result.questions?.[0]?.options).toEqual(['Meetings', 'Conflict', 'Noise']);

    // A non-household recipient is refused (no spend on an untailorable target).
    expect(
      await bridge.questionnaireSuggestionMaterialize({
        recipientPersonId: 'not-a-person',
        suggestionId,
      }),
    ).toMatchObject({ ok: false, reason: 'DENIED' });
  });

  it('recipient-first saved suggestions (§18): generate tailors + accumulates, list reads with no spend, delete removes, non-household is denied', async () => {
    const { host, bridge, ownerId } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    // Notes give the gap-finder substantive context (else the §11 thin-context pre-call guard would short-circuit).
    const mara = await bridge.peopleSave({
      displayName: 'Mara',
      isSubject: true,
      tags: [],
      notes: 'Enjoys cooking together; just started a new job.',
    });

    // A questionnaire ALREADY asked of Mara — its distinctive prompt must reach the model as de-dup grounding.
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

    // Capture what reaches the model; return DISTINCT ideas on a "Suggest more" (avoid-list present) call.
    let sentUserText = '';
    host.host.claude = {
      send: () => Promise.resolve(''),
      stream: (options, onDelta) => {
        sentUserText = options.messages.map((m) => m.content).join('\n');
        const second = sentUserText.includes('ALREADY proposed these');
        const titles = second ? ['Deeper dive'] : ['First idea', 'Second idea'];
        const json = JSON.stringify(
          titles.map((t) => ({
            title: t,
            type: 'general',
            rationale: 'r',
            questions: [{ type: 'yesNo', prompt: `${t}?` }],
          })),
        );
        onDelta(json);
        return Promise.resolve({
          text: json,
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };

    // First generate: tailored to Mara, fed her history as avoid-only grounding, and accumulates 2.
    const first = await bridge.questionnaireSuggestionsGenerate({ recipientPersonId: mara.id });
    expect(first.ok).toBe(true);
    expect(first.added).toBe(2);
    expect(first.saved?.map((s) => s.title)).toEqual(['First idea', 'Second idea']);
    expect(sentUserText).toContain('specifically for Mara'); // recipient-first tailoring
    expect(sentUserText).toContain('What is your secret codeword?'); // their history reaches the model
    expect(sentUserText).toMatch(/never quote, restate, reference/i); // the never-reveal safety clause
    // The recipient's private prior content is NEVER returned to the author — only generated ideas.
    expect(JSON.stringify(first.saved)).not.toContain('secret codeword');

    // List reads the persisted set (no AI spend — the captured text doesn't change).
    sentUserText = '';
    const listed = await bridge.questionnaireSuggestionsList({ recipientPersonId: mara.id });
    expect(listed.map((s) => s.title)).toEqual(['First idea', 'Second idea']);
    expect(sentUserText).toBe(''); // no model call on a read

    // "Suggest more" accumulates a genuinely NEW idea (prior titles fed as avoid).
    const more = await bridge.questionnaireSuggestionsGenerate({ recipientPersonId: mara.id });
    expect(more.added).toBe(1);
    expect(more.saved?.map((s) => s.title)).toEqual(['Deeper dive', 'First idea', 'Second idea']);
    expect(sentUserText).toMatch(/ALREADY proposed these/i);
    expect(sentUserText).toContain('First idea'); // the saved titles are the avoid list

    // Delete one — the rest remain.
    const target = more.saved?.find((s) => s.title === 'First idea');
    const remaining = await bridge.questionnaireSuggestionDelete({
      recipientPersonId: mara.id,
      suggestionId: target?.id ?? 'x',
    });
    expect(remaining.map((s) => s.title)).toEqual(['Deeper dive', 'Second idea']);

    // A non-household recipient id is refused on the persisted path (no spend on an untailorable target).
    expect(
      await bridge.questionnaireSuggestionsGenerate({ recipientPersonId: 'not-a-person' }),
    ).toMatchObject({ ok: false, reason: 'DENIED' });

    // The saved set lives under the AUTHOR — a Guest (no questionnaires.create) is gated out everywhere.
    const guest = await bridge.peopleSave({ displayName: 'Guest', isSubject: false, tags: [] });
    await bridge.accessSetAccount({ personId: guest.id, roleId: 'guest', pin: null });
    expect((await bridge.sessionSetActive({ personId: guest.id })).ok).toBe(true);
    expect(await bridge.questionnaireSuggestionsList({ recipientPersonId: mara.id })).toEqual([]);
    expect(
      await bridge.questionnaireSuggestionsGenerate({ recipientPersonId: mara.id }),
    ).toMatchObject({ ok: false, reason: 'DENIED' });
    // Back as the owner (returning to the Owner requires their PIN) — the set is intact (the guest's gated
    // read/generate never touched it).
    await bridge.sessionSetActive({ personId: ownerId, pin: '1234' });
    expect(
      (await bridge.questionnaireSuggestionsList({ recipientPersonId: mara.id })).map(
        (s) => s.title,
      ),
    ).toEqual(['Deeper dive', 'Second idea']);
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

  it('memoryOutboundSharing reports the active person’s OWN shared items + recipients; gated on memory.own (42 §5.3)', async () => {
    const { bridge, host, ownerId } = await freshOwner();
    const ctx = (await host.host.vaultAndKey())!;
    const partner = await bridge.peopleSave({ displayName: 'Pat', isSubject: true, tags: [] });
    await bridge.relationshipsSave({
      fromPersonId: ownerId,
      toPersonId: partner.id,
      type: 'partner',
    });
    const at = new Date().toISOString();
    await saveInsight(ctx.fs, ctx.key, {
      id: 'os1',
      schemaVersion: 1,
      source: 'session',
      subjectPersonId: ownerId,
      summary: 's',
      facts: [
        { id: 'fp', text: 'a partner-scoped thing', shareable: false, shareableTypes: ['partner'] },
        { id: 'fpriv', text: 'a private thing', shareable: false },
      ],
      confidence: 'low',
      categories: [],
      approved: true,
      provenance: { at },
      createdAt: at,
      updatedAt: at,
    });

    const out = await bridge.memoryOutboundSharing();
    const fp = out.items.find((i) => i.id === 'fp');
    expect(fp?.types).toEqual(['partner']);
    expect(fp?.recipients.map((r) => r.id)).toEqual([partner.id]);
    // A private fact is not outbound at all.
    expect(out.items.some((i) => i.id === 'fpriv')).toBe(false);

    // A Guest (no memory.own) gets nothing — own-scoped + capability-gated in the bridge.
    const guest = await bridge.peopleSave({ displayName: 'Guest', isSubject: false, tags: [] });
    await bridge.accessSetAccount({ personId: guest.id, roleId: 'guest', pin: null });
    expect((await bridge.sessionSetActive({ personId: guest.id })).ok).toBe(true);
    expect(await bridge.memoryOutboundSharing()).toEqual({ items: [] });
  });

  it('insights:update scopes a fact to a relationship type + deliberately un-restricts a sensitive one (44 §3.4)', async () => {
    const { bridge, host, ownerId } = await freshOwner();
    const ctx = (await host.host.vaultAndKey())!;
    const partner = await bridge.peopleSave({ displayName: 'Bee', isSubject: true, tags: [] });
    const sibling = await bridge.peopleSave({ displayName: 'Cee', isSubject: true, tags: [] });
    await bridge.relationshipsSave({
      fromPersonId: ownerId,
      toPersonId: partner.id,
      type: 'partner',
    });
    await bridge.relationshipsSave({
      fromPersonId: ownerId,
      toPersonId: sibling.id,
      type: 'sibling',
    });
    const at = new Date().toISOString();
    await saveInsight(ctx.fs, ctx.key, {
      id: 'ins1',
      schemaVersion: 1,
      source: 'session',
      subjectPersonId: ownerId,
      summary: 's',
      facts: [
        { id: 'f1', text: 'plays guitar', shareable: false },
        { id: 'f2', text: 'a sensitive matter', shareable: false, restricted: true },
      ],
      confidence: 'low',
      categories: [],
      approved: true,
      provenance: { at },
      createdAt: at,
      updatedAt: at,
    });

    // Scope f1 to Partner (never broadcast); send all facts the way the renderer does.
    await bridge.insightsUpdate({
      subjectPersonId: ownerId,
      id: 'ins1',
      facts: [
        { id: 'f1', text: 'plays guitar', shareable: false, shareableTypes: ['partner'] },
        { id: 'f2', text: 'a sensitive matter', shareable: false },
      ],
    });
    let stored = (await bridge.insightsList()).find((i) => i.id === 'ins1')!;
    expect(stored.facts).toHaveLength(2); // no fact dropped
    expect(stored.facts.find((f) => f.id === 'f1')?.shareableTypes).toEqual(['partner']);
    expect(stored.facts.find((f) => f.id === 'f1')?.shareable).toBe(false);
    // The restricted fact is preserved by the merge (a normal edit never strips it).
    expect(stored.facts.find((f) => f.id === 'f2')?.restricted).toBe(true);

    // f1 reaches the partner's coaching context, never the sibling's.
    const partnerCtx = await summarizeForContext(ctx.fs, ctx.key, partner.id, [
      { id: ownerId, displayName: 'Owner', grantedTypes: ['partner'] },
    ]);
    expect(partnerCtx).toContain('plays guitar');
    const siblingCtx = await summarizeForContext(ctx.fs, ctx.key, sibling.id, [
      { id: ownerId, displayName: 'Owner', grantedTypes: ['sibling'] },
    ]);
    expect(siblingCtx).not.toContain('plays guitar');
    expect(siblingCtx).not.toContain('a sensitive matter');

    // Deliberately un-restrict f2 (the 42 §8 two-step) + scope to Partner.
    await bridge.insightsUpdate({
      subjectPersonId: ownerId,
      id: 'ins1',
      facts: [
        { id: 'f1', text: 'plays guitar', shareable: false, shareableTypes: ['partner'] },
        {
          id: 'f2',
          text: 'a sensitive matter',
          shareable: false,
          shareableTypes: ['partner'],
          restricted: false,
        },
      ],
    });
    stored = (await bridge.insightsList()).find((i) => i.id === 'ins1')!;
    expect(stored.facts.find((f) => f.id === 'f2')?.restricted).toBe(false);
    const partnerCtx2 = await summarizeForContext(ctx.fs, ctx.key, partner.id, [
      { id: ownerId, displayName: 'Owner', grantedTypes: ['partner'] },
    ]);
    expect(partnerCtx2).toContain('a sensitive matter');
  });

  it('intake:setAnswerSharing changes an answer’s scope post-onboarding; gated on intake.own (44 §3.5)', async () => {
    const { bridge } = await freshOwner();
    await bridge.intakeSubmitForm({
      sectionId: 'values',
      answers: { values: ['Honesty'] },
      sharing: { values: ['partner'] },
    });
    expect(
      await bridge.intakeSetAnswerSharing({
        sectionId: 'values',
        questionId: 'values',
        types: ['sibling'],
      }),
    ).toBe(true);
    const state = await bridge.intakeGetState();
    expect(state.session.sections.find((s) => s.id === 'values')?.answerSharing?.values).toEqual([
      'sibling',
    ]);
    // A phantom (unanswered) question is a no-op.
    expect(
      await bridge.intakeSetAnswerSharing({
        sectionId: 'values',
        questionId: 'nope',
        types: ['partner'],
      }),
    ).toBe(false);

    // A Guest (no intake.own) can't change sharing.
    const guest = await bridge.peopleSave({ displayName: 'Guest', isSubject: false, tags: [] });
    await bridge.accessSetAccount({ personId: guest.id, roleId: 'guest', pin: null });
    expect((await bridge.sessionSetActive({ personId: guest.id })).ok).toBe(true);
    expect(
      await bridge.intakeSetAnswerSharing({
        sectionId: 'values',
        questionId: 'values',
        types: ['partner'],
      }),
    ).toBe(false);
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

  it('auto-reconcile: runs when warranted (queues a merge PROPOSAL), throttles, and honors the opt-out (39 §3.3/§3.4)', async () => {
    const { bridge, host, ownerId } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    const ctx = (await host.host.vaultAndKey())!;
    const at = new Date().toISOString();
    // Seed 5 approved insights — a duplicate pair (dupA/dupB) + three others — so the threshold trips.
    for (const id of ['dupA', 'dupB', 'x1', 'x2', 'x3']) {
      await saveInsight(ctx.fs, ctx.key, {
        id,
        schemaVersion: 1,
        source: 'session',
        subjectPersonId: ownerId,
        summary: `summary-${id}`,
        facts: [{ id: `f-${id}`, text: `fact ${id}`, shareable: false }],
        confidence: 'low',
        categories: [],
        approved: true,
        provenance: { conversationId: id, at },
        createdAt: at,
        updatedAt: at,
      });
    }
    // The reconcile model recalibrates confidence + proposes merging dupA into dupB.
    host.host.claude = {
      send: () => Promise.resolve(''),
      stream: (_options, onDelta) => {
        const text = JSON.stringify({
          insights: ['dupA', 'dupB', 'x1', 'x2', 'x3'].map((id) => ({ id, confidence: 'high' })),
          merges: [{ from: 'dupA', into: 'dupB' }],
        });
        onDelta(text);
        return Promise.resolve({
          text,
          usage: { inputTokens: 5, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };

    // First auto pass runs (5 new, never reconciled) and QUEUES the merge — it never silently folds.
    const first = await bridge.memoryRefresh({ auto: true });
    expect(first).toMatchObject({ ok: true, mergedCount: 0, proposedCount: 1 });
    const state = await bridge.memoryReconcileState();
    expect(state.lastReconciledAt).toBeTruthy();
    expect(state.proposals).toHaveLength(1);
    // Both insights still exist — the proposal hasn't been applied.
    const afterPass = (await bridge.insightsList()).map((i) => i.id);
    expect(afterPass).toContain('dupA');
    expect(afterPass).toContain('dupB');

    // Second auto pass within 24h is throttled → a calm SKIPPED no-op (no extra spend).
    expect(await bridge.memoryRefresh({ auto: true })).toMatchObject({
      ok: false,
      reason: 'SKIPPED',
    });

    // Confirming the proposal applies the merge (the source is folded away).
    await bridge.memoryResolveProposal({ proposalId: state.proposals[0]!.id, action: 'merge' });
    expect((await bridge.insightsList()).some((i) => i.id === 'dupA')).toBe(false);
    expect((await bridge.memoryReconcileState()).proposals).toHaveLength(0);

    // With the opt-out off, an auto pass is skipped regardless of warrant.
    await bridge.setSetting({ key: 'memory.autoReconcile', value: false, scope: 'vault' });
    expect(await bridge.memoryRefresh({ auto: true })).toMatchObject({
      ok: false,
      reason: 'SKIPPED',
    });
  });

  it('auto-reconcile: a transient ERROR (no spend) does NOT consume the 24h throttle — it retries (39 §3.3)', async () => {
    const { bridge, host, ownerId } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    const ctx = (await host.host.vaultAndKey())!;
    const at = new Date().toISOString();
    for (const id of ['a1', 'a2', 'a3', 'a4', 'a5']) {
      await saveInsight(ctx.fs, ctx.key, {
        id,
        schemaVersion: 1,
        source: 'session',
        subjectPersonId: ownerId,
        summary: `summary-${id}`,
        facts: [{ id: `f-${id}`, text: `fact ${id}`, shareable: false }],
        confidence: 'low',
        categories: [],
        approved: true,
        provenance: { conversationId: id, at },
        createdAt: at,
        updatedAt: at,
      });
    }
    // First auto pass: the stream THROWS before any tokens are spent → a transient ERROR.
    host.host.claude = {
      send: () => Promise.resolve(''),
      stream: () => Promise.reject(new Error('network blip')),
    };
    expect(await bridge.memoryRefresh({ auto: true })).toMatchObject({
      ok: false,
      reason: 'ERROR',
    });

    // The throttle was NOT stamped (no spend), so the very next auto pass still RUNS — a network blip
    // doesn't suppress the cadence for 24h.
    host.host.claude = {
      send: () => Promise.resolve(''),
      stream: (_options, onDelta) => {
        const text = JSON.stringify({
          insights: ['a1', 'a2', 'a3', 'a4', 'a5'].map((id) => ({ id, confidence: 'high' })),
          merges: [],
        });
        onDelta(text);
        return Promise.resolve({
          text,
          usage: { inputTokens: 5, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    expect(await bridge.memoryRefresh({ auto: true })).toMatchObject({ ok: true });

    // …and now that a pass actually ran, the throttle IS stamped — the following auto pass is SKIPPED.
    expect(await bridge.memoryRefresh({ auto: true })).toMatchObject({
      ok: false,
      reason: 'SKIPPED',
    });
  });

  it('reaps orphaned shareableWith from other people’s facts when a person is deleted (39 §4.5)', async () => {
    const { bridge, host, ownerId } = await freshOwner();
    const friend = await bridge.peopleSave({ displayName: 'Friend', isSubject: true, tags: [] });
    const ctx = (await host.host.vaultAndKey())!;
    const at = new Date().toISOString();
    // The owner has an insight whose fact is targeted-shared with `friend`.
    await saveInsight(ctx.fs, ctx.key, {
      id: 'ins1',
      schemaVersion: 1,
      source: 'session',
      subjectPersonId: ownerId,
      summary: 'About the owner',
      facts: [
        { id: 'f1', text: 'shared with friend', shareable: false, shareableWith: [friend.id] },
      ],
      confidence: 'low',
      categories: [],
      approved: true,
      provenance: { at },
      createdAt: at,
      updatedAt: at,
    });

    await bridge.peopleDelete(friend.id);

    // The dangling reference is gone from the owner's (still-present) fact.
    const owners = await bridge.insightsList();
    const f1 = owners.find((i) => i.id === 'ins1')?.facts.find((f) => f.id === 'f1');
    expect('shareableWith' in (f1 ?? {})).toBe(false);
  });

  it('goals: lists/sets-status/updates/deletes the active person’s own, gated on memory.own (39 §6)', async () => {
    const { bridge, host, ownerId } = await freshOwner();
    const ctx = (await host.host.vaultAndKey())!;
    const { saveGoal } = await import('@selfos/core/goals');
    const base = {
      schemaVersion: 1 as const,
      provenance: { at: new Date().toISOString() },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveGoal(ctx.fs, ctx.key, {
      ...base,
      id: 'g1',
      subjectPersonId: ownerId,
      text: 'run a marathon',
      status: 'open',
    });

    expect((await bridge.goalsList()).map((g) => g.text)).toEqual(['run a marathon']);
    expect((await bridge.goalsSetStatus({ goalId: 'g1', status: 'done' }))?.status).toBe('done');
    expect((await bridge.goalsUpdate({ goalId: 'g1', text: 'run a half marathon' }))?.text).toBe(
      'run a half marathon',
    );

    // The owner can CREATE a new goal for themselves (60 §3.1.3) — a fresh open goal, clamped life-area.
    const created = await bridge.goalsCreate({
      text: 'meditate daily',
      due: '2026-09-01',
      lifeArea: 'nope',
    });
    expect(created?.status).toBe('open');
    expect(created?.due).toBe('2026-09-01');
    expect(created?.lifeArea).toBeUndefined(); // off-taxonomy dropped
    expect((await bridge.goalsList()).map((g) => g.text)).toContain('meditate daily');

    // A Guest (no memory.own) sees none and can't mutate or create.
    const guest = await bridge.peopleSave({ displayName: 'Guest', isSubject: false, tags: [] });
    await bridge.accessSetAccount({ personId: guest.id, roleId: 'guest', pin: null });
    expect((await bridge.sessionSetActive({ personId: guest.id })).ok).toBe(true);
    expect(await bridge.goalsList()).toEqual([]);
    expect(await bridge.goalsSetStatus({ goalId: 'g1', status: 'open' })).toBeNull();
    expect(await bridge.goalsCreate({ text: 'sneaky' })).toBeNull();

    // Back as the owner (PIN required returning to the owner), delete both.
    expect((await bridge.sessionSetActive({ personId: ownerId, pin: '1234' })).ok).toBe(true);
    await bridge.goalsDelete({ goalId: 'g1' });
    if (created) await bridge.goalsDelete({ goalId: created.id });
    expect(await bridge.goalsList()).toEqual([]);
  });

  it('goalsSuggest (60 §3.1.3): metered goal.suggest, clamps life-area, gated memory.own', async () => {
    const { bridge, host, ownerId } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    const ctx = (await host.host.vaultAndKey())!;
    // Seed some context so the pre-call thin-context check passes (else it's a calm empty state, no spend).
    await saveInsight(ctx.fs, ctx.key, {
      id: 'i1',
      schemaVersion: 1,
      source: 'session',
      subjectPersonId: ownerId,
      summary: 'Keeps mentioning his sister and wanting to move more.',
      facts: [{ id: 'f1', text: 'Misses his sister.', shareable: false }],
      confidence: 'high',
      categories: ['Relationships'],
      approved: true,
      provenance: { conversationId: 'i1', at: new Date().toISOString() },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const r = await bridge.goalsSuggest();
    expect(r.ok).toBe(true);
    expect(r.suggestions?.map((s) => s.text)).toContain('Call your sister this week');
    // The off-taxonomy life-area on the second suggestion is dropped.
    expect(r.suggestions?.find((s) => s.text.includes('walk'))?.lifeArea).toBeUndefined();
    expect(
      (await bridge.usageSummary({ scope: 'person', period: 'month' })).byType['goal.suggest']
        ?.count ?? 0,
    ).toBeGreaterThan(0);

    // A Guest (no memory.own) is denied without spending.
    const guest = await bridge.peopleSave({ displayName: 'Guest', isSubject: false, tags: [] });
    await bridge.accessSetAccount({ personId: guest.id, roleId: 'guest', pin: null });
    expect((await bridge.sessionSetActive({ personId: guest.id })).ok).toBe(true);
    expect(await bridge.goalsSuggest()).toMatchObject({ ok: false, reason: 'DENIED' });
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
      name: 'Sploshing',
    });
    expect(afterAdd.custom.activities).toEqual(['Sploshing']);
    await bridge.questionnairesAddIntimacyTopic({ kind: 'fantasies', name: 'Pirate roleplay' });

    // A Member can READ the merged inventory (for the builder) but CANNOT add or remove (owner-only).
    await bridge.sessionSetActive({ personId: member.id });
    const memberView = await bridge.questionnairesIntimacyTopics();
    expect(memberView.custom.activities).toEqual(['Sploshing']);
    await expect(
      bridge.questionnairesAddIntimacyTopic({ kind: 'activities', name: 'Sneaky' }),
    ).rejects.toThrow(/permitted/);
    await expect(
      bridge.questionnairesRemoveIntimacyTopic({ kind: 'activities', name: 'Sploshing' }),
    ).rejects.toThrow(/permitted/);

    // The Owner removes a custom topic.
    await bridge.sessionSetActive({ personId: ownerId, pin: '1234' });
    const afterRemove = await bridge.questionnairesRemoveIntimacyTopic({
      kind: 'activities',
      name: 'sploshing', // case-insensitive
    });
    expect(afterRemove.custom.activities).toEqual([]);
    expect(afterRemove.custom.fantasies).toEqual(['Pirate roleplay']);
  });

  it('intimacy topics AI suggest (§16.5a): owner gets DEDUPED suggestions; a member is denied; AI-off is calm', async () => {
    const { bridge, ownerId } = await freshOwner();
    await bridge.setSetting({ key: 'ai.enabled', value: true, scope: 'vault' });
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });

    const res = await bridge.questionnairesSuggestIntimacyTopics({ subject: 'sensory play' });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    // The fake returns a built-in ('Sensual massage') + fresh ones → the built-in is deduped out.
    expect(res.suggestions.activities).toEqual(['Mutual edging']);
    expect(res.suggestions.fantasies).toEqual(['Rivals-to-lovers roleplay']);

    // A member cannot suggest (owner-only, people.manage) — a calm failure, never a throw.
    const member = await bridge.peopleSave({ displayName: 'Mem', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: member.id, roleId: 'member', pin: null });
    await bridge.sessionSetActive({ personId: member.id });
    const denied = await bridge.questionnairesSuggestIntimacyTopics({ subject: 'x' });
    expect(denied.ok).toBe(false);
    if (denied.ok) throw new Error('expected denial');
    expect(denied.reason).toBe('ERROR');

    // AI off → a calm AI_OFF for the owner (no dead button).
    await bridge.sessionSetActive({ personId: ownerId, pin: '1234' });
    await bridge.setSetting({ key: 'ai.enabled', value: false, scope: 'vault' });
    const off = await bridge.questionnairesSuggestIntimacyTopics({});
    expect(off.ok).toBe(false);
    if (off.ok) throw new Error('expected AI_OFF');
    expect(off.reason).toBe('AI_OFF');
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
      fromSelf: false, // Ben sent it to the recipient — not a self check-in (§3.3 Received filter)
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

  it('recipient re-opens + edits + resubmits → Results stale + answers-updated nudge; re-analyze clears it (56)', async () => {
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
    // A PRIVATE send so we also prove the answers-updated summary carries no raw answers.
    const { assignment } = await bridge.assignmentsCreate({
      questionnaireId: q.id,
      privacy: 'private',
    });

    // Recipient submits.
    await bridge.sessionSetActive({ personId: recipient.id });
    await bridge.assignmentsSubmit({
      assignmentId: assignment.id,
      answers: [{ questionId: 'q1', value: 'first answer' }],
    });

    // Owner analyzes (a Claude returning valid JSON).
    const claude = {
      send: () => Promise.resolve('{}'),
      stream: (_options: unknown, onDelta: (s: string) => void) => {
        const json = JSON.stringify({ summary: 'A summary.', facts: [], confidence: 'medium' });
        onDelta(json);
        return Promise.resolve({
          text: json,
          usage: { inputTokens: 5, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    host.host.claude = claude;
    await bridge.sessionSetActive({ personId: ownerId, pin: '1234' });
    expect((await bridge.insightsAnalyze({ assignmentId: assignment.id })).ok).toBe(true);
    let results = await bridge.assignmentsResults(q.id);
    expect(results[0]).toMatchObject({ analyzed: true, analysisStale: false, revision: 1 });
    expect(await bridge.notificationsAnswersUpdated()).toEqual([]); // nothing edited yet

    // Recipient re-opens, edits, and resubmits → revision 2.
    await bridge.sessionSetActive({ personId: recipient.id });
    await bridge.assignmentsReopen(assignment.id);
    expect((await bridge.assignmentsGet(assignment.id))?.answerable).toBe(true); // editable again
    await bridge.assignmentsSubmit({
      assignmentId: assignment.id,
      answers: [{ questionId: 'q1', value: 'a much better answer' }],
    });

    // Owner: Results flags the analysis stale; the answers-updated nudge names the recipient, carries the
    // revision (the re-surface signature) + questionnaire link, and NO raw answers (a Private send).
    await bridge.sessionSetActive({ personId: ownerId, pin: '1234' });
    results = await bridge.assignmentsResults(q.id);
    expect(results[0]).toMatchObject({ analyzed: true, analysisStale: true, revision: 2 });
    const nudges = await bridge.notificationsAnswersUpdated();
    expect(nudges).toHaveLength(1);
    expect(nudges[0]).toMatchObject({
      assignmentId: assignment.id,
      questionnaireId: q.id,
      recipientName: 'Mara',
      revision: 2,
    });
    expect(JSON.stringify(nudges[0])).not.toContain('better answer'); // no raw answers in the summary

    // Re-analyze → analyzedRevision catches up → no longer stale, the nudge clears.
    host.host.claude = claude;
    expect((await bridge.insightsAnalyze({ assignmentId: assignment.id })).ok).toBe(true);
    expect((await bridge.assignmentsResults(q.id))[0]?.analysisStale).toBe(false);
    expect(await bridge.notificationsAnswersUpdated()).toEqual([]);
  });

  it('reopen is recipient-scoped — the sender can’t re-open the recipient’s send (56)', async () => {
    const { bridge, ownerId } = await freshOwner();
    const recipient = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: recipient.id, roleId: 'member', pin: null });
    const q = await bridge.questionnairesSave({
      title: 'Weekly check-in',
      type: 'role-feedback',
      sensitivity: 'standard',
      recipient: { kind: 'person', personId: recipient.id },
      questions: [{ id: 'q1', type: 'shortText', prompt: 'How?', required: true }],
    });
    const { assignment } = await bridge.assignmentsCreate({
      questionnaireId: q.id,
      privacy: 'standard',
    });
    await bridge.sessionSetActive({ personId: recipient.id });
    await bridge.assignmentsSubmit({
      assignmentId: assignment.id,
      answers: [{ questionId: 'q1', value: 'x' }],
    });

    // The SENDER (owner) is not the recipient → reopen is refused (recipient-scoped in the bridge).
    await bridge.sessionSetActive({ personId: ownerId, pin: '1234' });
    await expect(bridge.assignmentsReopen(assignment.id)).rejects.toThrow(/permitted/);

    // The recipient CAN re-open their own submitted send.
    await bridge.sessionSetActive({ personId: recipient.id });
    await bridge.assignmentsReopen(assignment.id);
    expect((await bridge.assignmentsGet(assignment.id))?.answerable).toBe(true);
  });

  it('the edit list is author-scoped — a questionnaire sent to you does NOT show in your list', async () => {
    const { bridge, ownerId } = await freshOwner();
    const member = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: member.id, roleId: 'member', pin: null });

    // The OWNER authors a questionnaire and sends it to the member.
    const ownerQ = await bridge.questionnairesSave({
      title: 'Owner asks the member',
      type: 'role-feedback',
      sensitivity: 'standard',
      recipient: { kind: 'person', personId: member.id },
      questions: [{ id: 'q1', type: 'shortText', prompt: 'How?', required: true }],
    });
    await bridge.assignmentsCreate({ questionnaireId: ownerQ.id, privacy: 'standard' });

    // The MEMBER authors their own questionnaire.
    await bridge.sessionSetActive({ personId: member.id });
    const memberQ = await bridge.questionnairesSave({
      title: 'Member’s own',
      type: 'role-feedback',
      sensitivity: 'standard',
      recipient: { kind: 'person', personId: ownerId },
      questions: [{ id: 'q1', type: 'shortText', prompt: 'Hi?', required: true }],
    });

    // The member's edit list shows ONLY their own — the owner's send-to-them is in their Inbox, not here.
    const memberList = (await bridge.questionnairesList()).map((q) => q.id);
    expect(memberList).toContain(memberQ.id);
    expect(memberList).not.toContain(ownerQ.id);
    // …but it IS in their Inbox (as a recipient).
    expect((await bridge.assignmentsInbox()).map((i) => i.assignmentId).length).toBe(1);

    // The owner's edit list shows their own, not the member's authored one.
    await bridge.sessionSetActive({ personId: ownerId, pin: '1234' });
    const ownerList = (await bridge.questionnairesList()).map((q) => q.id);
    expect(ownerList).toContain(ownerQ.id);
    expect(ownerList).not.toContain(memberQ.id);
  });

  it('a legacy creator-less questionnaire stays visible to the Owner (not orphaned), hidden from members', async () => {
    const { host, bridge } = await freshOwner();
    const member = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: member.id, roleId: 'member', pin: null });
    // Author a def, then strip its creatorPersonId on disk to simulate a pre-38 (creator-less) questionnaire.
    const legacy = await bridge.questionnairesSave({
      title: 'Legacy',
      type: 'role-feedback',
      sensitivity: 'standard',
      questions: [{ id: 'q1', type: 'shortText', prompt: 'Hi?', required: true }],
    });
    const ctx = await host.host.vaultAndKey();
    if (!ctx) throw new Error('no vault');
    const full = await getQuestionnaire(ctx.fs, ctx.key, legacy.id);
    const withoutCreator: Record<string, unknown> = { ...full };
    delete withoutCreator.creatorPersonId;
    await writeEncryptedJson(
      ctx.fs,
      `questionnaires/defs/${legacy.id}.enc`,
      withoutCreator,
      ctx.key,
    );

    // The Owner still sees it (so it isn't orphaned / becomes deletable per §3.9); a member does not.
    expect((await bridge.questionnairesList()).map((q) => q.id)).toContain(legacy.id);
    await bridge.sessionSetActive({ personId: member.id });
    expect((await bridge.questionnairesList()).map((q) => q.id)).not.toContain(legacy.id);
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

  it('aggregate (§21.5): Private sends are excluded entirely (words AND numbers), viewResults-gated', async () => {
    const { bridge, ownerId } = await freshOwner();
    const mara = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: mara.id, roleId: 'member', pin: null });
    const noah = await bridge.peopleSave({ displayName: 'Noah', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: noah.id, roleId: 'member', pin: null });
    const q = await bridge.questionnairesSave({
      title: 'Team pulse',
      type: 'role-feedback',
      sensitivity: 'standard',
      recipient: { kind: 'person', personId: mara.id },
      questions: [
        {
          id: 'rate',
          type: 'rating',
          prompt: 'How connected?',
          required: true,
          scale: { min: 1, max: 5 },
        },
        {
          id: 'pick',
          type: 'singleChoice',
          prompt: 'Best word?',
          required: true,
          options: ['Calm', 'Tense'],
        },
      ],
    });

    // One STANDARD send (Mara → rating 4, choice "Calm") and one PRIVATE send (Noah → rating 2, choice "Tense").
    const submitAs = async (
      personId: string,
      privacy: 'standard' | 'private',
      rate: number,
      pick: string,
    ): Promise<void> => {
      // Re-target the questionnaire to this recipient, then send + answer as them.
      await bridge.questionnairesSave({
        id: q.id,
        title: 'Team pulse',
        type: 'role-feedback',
        sensitivity: 'standard',
        recipient: { kind: 'person', personId },
        questions: q.questions,
      });
      const { assignment: a } = await bridge.assignmentsCreate({ questionnaireId: q.id, privacy });
      await bridge.sessionSetActive({ personId });
      await bridge.assignmentsSubmit({
        assignmentId: a.id,
        answers: [
          { questionId: 'rate', value: rate },
          { questionId: 'pick', value: pick },
        ],
      });
      await bridge.sessionSetActive({ personId: ownerId, pin: '1234' });
    };
    await submitAs(mara.id, 'standard', 4, 'Calm');
    await submitAs(noah.id, 'private', 2, 'Tense');

    const agg = await bridge.assignmentsAggregate(q.id);
    const rating = agg.questions.find((a) => a.questionId === 'rate');
    const choice = agg.questions.find((a) => a.questionId === 'pick');
    // Private is EXCLUDED entirely (§21.5): the numeric average is the STANDARD 4 only — the private 2 does
    // NOT pull it toward 3.
    expect(rating?.kind).toBe('average');
    if (rating?.kind === 'average') {
      expect(rating.average).toBe(4);
      expect(rating.responseCount).toBe(1); // the standard send only
    }
    // The distribution counts the STANDARD send only; the private "Tense" is neither shown NOR counted.
    expect(choice?.kind).toBe('distribution');
    if (choice?.kind === 'distribution') {
      expect(choice.options).toEqual([
        { label: 'Calm', count: 1 },
        { label: 'Tense', count: 0 },
      ]);
      expect(choice.responseCount).toBe(1); // only the standard respondent — the private one is excluded
    }

    // Gated on viewResults: a Guest gets an empty aggregate even though sends exist.
    const guest = await bridge.peopleSave({ displayName: 'Guest', isSubject: false, tags: [] });
    await bridge.accessSetAccount({ personId: guest.id, roleId: 'guest', pin: null });
    await bridge.sessionSetActive({ personId: guest.id });
    expect(await bridge.assignmentsAggregate(q.id)).toEqual({ questions: [] });
  });

  it('private send Results (§21.5): NOTHING from the answers — no words, no numbers; only the derived insight', async () => {
    const { bridge, ownerId, host } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    const mara = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: mara.id, roleId: 'member', pin: null });
    const q = await bridge.questionnairesSave({
      title: 'Quiet check-in',
      type: 'role-feedback',
      sensitivity: 'standard',
      recipient: { kind: 'person', personId: mara.id },
      questions: [
        {
          id: 'r',
          type: 'rating',
          prompt: 'How connected?',
          required: true,
          scale: { min: 1, max: 5 },
        },
        { id: 't', type: 'longText', prompt: 'Anything on your mind?', required: true },
      ],
    });
    const { assignment: a } = await bridge.assignmentsCreate({
      questionnaireId: q.id,
      privacy: 'private',
    });
    await bridge.sessionSetActive({ personId: mara.id });
    await bridge.assignmentsSubmit({
      assignmentId: a.id,
      answers: [
        { questionId: 'r', value: 4 },
        { questionId: 't', value: 'a private written thought' },
      ],
    });
    await bridge.sessionSetActive({ personId: ownerId, pin: '1234' });

    let result = (await bridge.assignmentsResults(q.id))[0];
    // A private send surfaces NOTHING from the answers — not the words, not the numbers (§21.5).
    expect(result?.answers).toBeUndefined();
    expect('numericAnswers' in (result ?? {})).toBe(false);
    // Neither the written text nor the numeric value is anywhere in the serialized result.
    expect(JSON.stringify(result)).not.toContain('a private written thought');

    // A private send contributes NOTHING to the aggregate either — no question appears from it (§21.5).
    expect(await bridge.assignmentsAggregate(q.id)).toEqual({ questions: [] });

    // Analyze → the derived Insight's summary + id are surfaced (the insight is the ONLY allowed output).
    host.host.claude = {
      send: () => Promise.resolve('{}'),
      stream: (_options, onDelta) => {
        const json = JSON.stringify({
          summary: 'They feel fairly connected but are carrying something unspoken.',
          facts: [{ text: 'Quietly stressed', shareable: false }],
          confidence: 'medium',
        });
        onDelta(json);
        return Promise.resolve({
          text: json,
          usage: { inputTokens: 5, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    expect((await bridge.insightsAnalyze({ assignmentId: a.id })).ok).toBe(true);
    result = (await bridge.assignmentsResults(q.id))[0];
    expect(result?.analyzed).toBe(true);
    expect(result?.insightSummary).toBe(
      'They feel fairly connected but are carrying something unspoken.',
    );
    expect(typeof result?.insightId).toBe('string');
    // Still no raw written answers after analysis.
    expect(result?.answers).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('a private written thought');
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
    // The latest send is unanswered → `answered` is false (the "Share a link" affordance still shows).
    expect(states[q.id]?.answered).toBe(false);

    // Sender-scoped: the recipient (Mara) sent nothing herself, so her own send-states are empty —
    // the owner's send of `q` does not leak into another person's list.
    await bridge.sessionSetActive({ personId: mara.id });
    expect(await bridge.questionnairesSendStates()).toEqual({});
  });

  it('questionnairesSendStates: `answered` flips true once the latest send is submitted (§17.14e)', async () => {
    const { bridge, ownerId } = await freshOwner();
    const mara = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: mara.id, roleId: 'member', pin: null });
    const q = await bridge.questionnairesSave({
      title: 'Weekly check-in',
      type: 'general',
      sensitivity: 'standard',
      recipient: { kind: 'person', personId: mara.id },
      questions: [{ id: 'a', type: 'shortText', prompt: 'How?', required: true }],
    });
    await bridge.assignmentsCreate({ questionnaireId: q.id, privacy: 'standard' });
    // Before the recipient answers, `answered` is false.
    expect((await bridge.questionnairesSendStates())[q.id]?.answered).toBe(false);

    // Mara answers it in her Inbox → submitted.
    await bridge.sessionSetActive({ personId: mara.id });
    const inbox = await bridge.assignmentsInbox();
    const item = inbox[0];
    if (!item) throw new Error('expected an inbox item');
    await bridge.assignmentsSubmit({
      assignmentId: item.assignmentId,
      answers: [{ questionId: 'a', value: 'Doing well' }],
    });

    // Back to the sender (returning to the Owner needs the Owner's PIN): the latest send is now answered →
    // `answered` is true (the share affordance hides).
    await bridge.sessionSetActive({ personId: ownerId, pin: '1234' });
    expect((await bridge.questionnairesSendStates())[q.id]?.answered).toBe(true);
  });

  it('questionnairesSentOverview: per-recipient answered status, new-response + analysed counts, gated (§3.1)', async () => {
    const { bridge, ownerId, host } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    const mara = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: mara.id, roleId: 'member', pin: null });
    const q = await bridge.questionnairesSave({
      title: 'Weekly check-in',
      type: 'general',
      sensitivity: 'standard',
      recipient: { kind: 'person', personId: mara.id },
      questions: [{ id: 'a', type: 'shortText', prompt: 'How?', required: true }],
    });

    // Never sent → no overview.
    expect(await bridge.questionnairesSentOverview()).toEqual({});

    // Send it twice to the bound recipient (a re-ask); the recipient is deduped to their latest send.
    await bridge.assignmentsCreate({ questionnaireId: q.id, privacy: 'standard' });
    const { assignment: latest } = await bridge.assignmentsCreate({
      questionnaireId: q.id,
      privacy: 'standard',
    });
    let overview = await bridge.questionnairesSentOverview();
    expect(overview[q.id]?.recipients).toEqual([{ name: 'Mara', status: 'sent', answered: false }]);
    expect(overview[q.id]?.answeredCount).toBe(0);
    expect(overview[q.id]?.newResponses).toBe(0);
    expect(typeof overview[q.id]?.lastSentAt).toBe('string');
    // The card privacy chip reads the derived mode (§3.1 card privacy badges).
    expect(overview[q.id]?.privacy).toBe('standard');

    // Mara answers the latest send → she reads as answered, and it's a "new" (un-analysed) response.
    await bridge.sessionSetActive({ personId: mara.id });
    await bridge.assignmentsSubmit({
      assignmentId: latest.id,
      answers: [{ questionId: 'a', value: 'Doing well' }],
    });
    await bridge.sessionSetActive({ personId: ownerId, pin: '1234' });
    overview = await bridge.questionnairesSentOverview();
    expect(overview[q.id]?.recipients[0]).toMatchObject({ name: 'Mara', answered: true });
    expect(typeof overview[q.id]?.recipients[0]?.answeredAt).toBe('string');
    expect(overview[q.id]?.answeredCount).toBe(1);
    expect(overview[q.id]?.newResponses).toBe(1);
    // Answered-not-analysed → an answered time + a send the card can one-tap Analyze, and no excerpt yet.
    expect(typeof overview[q.id]?.answeredAt).toBe('string');
    expect(overview[q.id]?.analyzed).toBe(false);
    expect(overview[q.id]?.analyzableAssignmentId).toBe(latest.id);
    expect(overview[q.id]?.insightSummary).toBeUndefined();

    // Analysing it clears the "new" badge (the sender has reviewed it) but it's still answered.
    host.host.claude = {
      send: () => Promise.resolve('{}'),
      stream: (_options, onDelta) => {
        const json = JSON.stringify({
          summary: 'Going well.',
          facts: [{ text: 'Feels good about it', shareable: true }],
          confidence: 'high',
        });
        onDelta(json);
        return Promise.resolve({
          text: json,
          usage: { inputTokens: 5, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    expect((await bridge.insightsAnalyze({ assignmentId: latest.id })).ok).toBe(true);
    overview = await bridge.questionnairesSentOverview();
    expect(overview[q.id]?.answeredCount).toBe(1);
    expect(overview[q.id]?.newResponses).toBe(0);
    // Now fully analysed → the excerpt (insight summary) is surfaced + no analyzable send remains.
    expect(overview[q.id]?.analyzed).toBe(true);
    expect(overview[q.id]?.insightSummary).toBe('Going well.');
    expect(overview[q.id]?.analyzableAssignmentId).toBeUndefined();
    // The deep-link id names the derived Insight itself, so "View in Memory" can open it directly.
    const derived = (await bridge.insightsList()).find(
      (i) => i.provenance.assignmentId === latest.id,
    );
    expect(derived?.id).toBeTruthy();
    expect(overview[q.id]?.insightId).toBe(derived?.id);

    // Sender-scoped: the recipient sees none of the owner's sends in her own overview.
    await bridge.sessionSetActive({ personId: mara.id });
    expect(await bridge.questionnairesSentOverview()).toEqual({});

    // Gated on viewResults: a Guest (no viewResults) gets an empty overview even though sends exist.
    const guest = await bridge.peopleSave({ displayName: 'Guest', isSubject: false, tags: [] });
    await bridge.accessSetAccount({ personId: guest.id, roleId: 'guest', pin: null });
    await bridge.sessionSetActive({ personId: guest.id });
    expect(await bridge.questionnairesSentOverview()).toEqual({});
  });

  it('card privacy badges (§3.1): sentOverview derives private/mixed; a compatibility Inbox item carries its visibility', async () => {
    const { bridge, ownerId } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    const mara = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: mara.id, roleId: 'member', pin: null });
    const noah = await bridge.peopleSave({ displayName: 'Noah', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: noah.id, roleId: 'member', pin: null });

    // A Private send → the overview says so (the Sent card chip reads "Private · insights only").
    const questions = [{ id: 'a', type: 'shortText' as const, prompt: 'How?', required: true }];
    const q = await bridge.questionnairesSave({
      title: 'Quiet check-in',
      type: 'general',
      sensitivity: 'standard',
      recipient: { kind: 'person', personId: mara.id },
      questions,
    });
    await bridge.assignmentsCreate({ questionnaireId: q.id, privacy: 'private' });
    let overview = await bridge.questionnairesSentOverview();
    expect(overview[q.id]?.privacy).toBe('private');

    // The recipient's Inbox item: a plain send carries its privacy, and NO compatibility visibility.
    await bridge.sessionSetActive({ personId: mara.id });
    const maraItem = (await bridge.assignmentsInbox()).find((i) => i.title === 'Quiet check-in');
    expect(maraItem?.privacy).toBe('private');
    expect(maraItem?.compatibilityVisibility).toBeUndefined();
    await bridge.sessionSetActive({ personId: ownerId, pin: '1234' });

    // Re-target the questionnaire to Noah and send Standard: two recipients whose latest sends differ
    // → the card-level mode is `mixed` (the legacy multi-recipient shape).
    await bridge.questionnairesSave({
      id: q.id,
      title: 'Quiet check-in',
      type: 'general',
      sensitivity: 'standard',
      recipient: { kind: 'person', personId: noah.id },
      questions,
    });
    await bridge.assignmentsCreate({ questionnaireId: q.id, privacy: 'standard' });
    overview = await bridge.questionnairesSentOverview();
    expect(overview[q.id]?.privacy).toBe('mixed');

    // A compatibility send's Inbox item carries the visibility mode, so the recipient's chip states the
    // REAL promise — for senderSeesAll the answers ARE shared, which a generic "private" would misstate.
    const cq = await bridge.questionnairesSave({
      title: 'Us check',
      type: 'role-feedback',
      sensitivity: 'standard',
      recipient: { kind: 'person', personId: mara.id },
      questions: [
        {
          id: 'c1',
          type: 'rating',
          prompt: 'Connected?',
          required: true,
          scale: { min: 1, max: 5 },
        },
      ],
      compatibility: { enabled: true, visibility: 'senderSeesAll' },
    });
    const sent = await bridge.assignmentsCreateCompatibility({ questionnaireId: cq.id });
    expect(sent.ok).toBe(true);
    await bridge.sessionSetActive({ personId: mara.id });
    const compatItem = (await bridge.assignmentsInbox()).find((i) => i.compatibilityVisibility);
    expect(compatItem?.compatibilityVisibility).toBe('senderSeesAll');
  });

  it('assignmentsInbox: carries the category + answered time; setFavorite pins it (device-local, per-person) (§3.3)', async () => {
    const { bridge, ownerId } = await freshOwner();
    const mara = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: mara.id, roleId: 'member', pin: null });
    const q = await bridge.questionnairesSave({
      title: 'What you appreciate',
      type: 'appreciation',
      sensitivity: 'standard',
      recipient: { kind: 'person', personId: mara.id },
      questions: [{ id: 'a', type: 'shortText', prompt: 'What stands out?', required: true }],
    });
    const { assignment } = await bridge.assignmentsCreate({
      questionnaireId: q.id,
      privacy: 'standard',
    });

    // The recipient's Inbox item carries the questionnaire's category (for the card eyebrow) + no answer yet.
    await bridge.sessionSetActive({ personId: mara.id });
    let inbox = await bridge.assignmentsInbox();
    expect(inbox[0]).toMatchObject({ type: 'appreciation', favorite: false });
    expect(inbox[0]?.answeredAt).toBeUndefined();

    // Pin it → favourite sticks (device-local).
    await bridge.assignmentsSetFavorite({ assignmentId: assignment.id, favorite: true });
    expect((await bridge.assignmentsInbox())[0]?.favorite).toBe(true);

    // Answering stamps the answered time; the favourite is unaffected.
    await bridge.assignmentsSubmit({
      assignmentId: assignment.id,
      answers: [{ questionId: 'a', value: 'Your patience' }],
    });
    inbox = await bridge.assignmentsInbox();
    expect(typeof inbox[0]?.answeredAt).toBe('string');
    expect(inbox[0]?.favorite).toBe(true);

    // Per-person + device-local: the owner (a different person) doesn't inherit Mara's favourite, and
    // unfavouriting clears it.
    await bridge.sessionSetActive({ personId: ownerId, pin: '1234' });
    expect(
      (await bridge.assignmentsInbox()).find((i) => i.assignmentId === assignment.id),
    ).toBeUndefined();
    await bridge.sessionSetActive({ personId: mara.id });
    await bridge.assignmentsSetFavorite({ assignmentId: assignment.id, favorite: false });
    expect((await bridge.assignmentsInbox())[0]?.favorite).toBe(false);
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

  it('intake per-question sharing (43): the IPC carries the scope, synthesis tags the fact, and a partner sees it while a sibling does not', async () => {
    const { bridge, host, ownerId } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
    host.host.claude = {
      send: () => Promise.resolve(''),
      stream: (_options, onDelta) => {
        const text = JSON.stringify({
          portrait: 'You value honesty.',
          facts: [{ text: 'Values honesty above all', section: 'values' }],
          crisisFlag: false,
        });
        onDelta(text);
        return Promise.resolve({
          text,
          usage: { inputTokens: 5, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    // A partner B and a sibling C of the owner.
    const partner = await bridge.peopleSave({ displayName: 'Bee', isSubject: true, tags: [] });
    const sibling = await bridge.peopleSave({ displayName: 'Cee', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: partner.id, roleId: 'member', pin: null });
    await bridge.accessSetAccount({ personId: sibling.id, roleId: 'member', pin: null });
    // edge.type = "to is from's ___": B is the owner's partner; C is the owner's sibling.
    await bridge.relationshipsSave({
      fromPersonId: ownerId,
      toPersonId: partner.id,
      type: 'partner',
    });
    await bridge.relationshipsSave({
      fromPersonId: ownerId,
      toPersonId: sibling.id,
      type: 'sibling',
    });

    // The owner scopes a `values` answer to Partner via the IPC; the returned state persists it.
    const state = await bridge.intakeSubmitForm({
      sectionId: 'values',
      answers: { values: ['Honesty'] },
      sharing: { values: ['partner'] },
    });
    expect(state.session.sections.find((s) => s.id === 'values')?.answerSharing?.values).toEqual([
      'partner',
    ]);

    // Synthesis tags the derived fact with the same scope (never broadcast).
    expect((await bridge.intakeSynthesize({})).ok).toBe(true);
    const fact = (await bridge.insightsList())
      .find((i) => i.source === 'intake')!
      .facts.find((f) => f.text.includes('honesty'))!;
    expect(fact.shareable).toBe(false);
    expect(fact.shareableTypes).toEqual(['partner']);

    // The partner's coaching context surfaces it (behind the confidentiality preamble); the sibling's never.
    const ctx = (await host.host.vaultAndKey())!;
    const partnerCtx = await summarizeForContext(ctx.fs, ctx.key, partner.id, [
      { id: ownerId, displayName: 'Owner', grantedTypes: ['partner'] },
    ]);
    expect(partnerCtx).toContain('honesty');
    const siblingCtx = await summarizeForContext(ctx.fs, ctx.key, sibling.id, [
      { id: ownerId, displayName: 'Owner', grantedTypes: ['sibling'] },
    ]);
    expect(siblingCtx).not.toContain('honesty');
  });
});

describe('discovery dismissals (41)', () => {
  it('persists dismissed hint keys per person, keyed by the active person id', async () => {
    const { bridge, ownerId, host } = await freshOwner();
    expect(await bridge.getDiscoveryDismissals()).toEqual([]);
    await bridge.setDiscoveryDismissals(['orientation', 'tip.gapFinder']);
    expect(await bridge.getDiscoveryDismissals()).toEqual(['orientation', 'tip.gapFinder']);
    expect(host.device().discoveryDismissals?.[ownerId]).toEqual(['orientation', 'tip.gapFinder']);

    // A different person sees their OWN (empty) dismissals — no leakage across personas.
    const mara = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });
    expect((await bridge.sessionSetActive({ personId: mara.id })).ok).toBe(true);
    expect(await bridge.getDiscoveryDismissals()).toEqual([]);

    // The owner's dismissals survive a round-trip switch (returning to the owner needs their PIN).
    expect((await bridge.sessionSetActive({ personId: ownerId, pin: '1234' })).ok).toBe(true);
    expect(await bridge.getDiscoveryDismissals()).toEqual(['orientation', 'tip.gapFinder']);
  });
});

describe('notifications (35)', () => {
  it('persists notification read/dismissed state per person, keyed by the active person id', async () => {
    const { bridge, ownerId, host } = await freshOwner();
    await bridge.setNotificationState({ read: { 'sync-conflict': '2' }, dismissed: {} });
    expect(await bridge.getNotificationState()).toEqual({
      read: { 'sync-conflict': '2' },
      dismissed: {},
    });
    expect(host.device().notificationState?.[ownerId]).toEqual({
      read: { 'sync-conflict': '2' },
      dismissed: {},
    });

    // A different person sees their OWN (empty) state — no leakage across personas.
    const mara = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });
    expect((await bridge.sessionSetActive({ personId: mara.id })).ok).toBe(true);
    expect(await bridge.getNotificationState()).toEqual({ read: {}, dismissed: {} });

    // The owner's state is untouched after switching back (returning to the owner needs their PIN).
    expect((await bridge.sessionSetActive({ personId: ownerId, pin: '1234' })).ok).toBe(true);
    expect((await bridge.getNotificationState()).read).toEqual({ 'sync-conflict': '2' });
  });

  it('returns no responses-arrived summaries when the active person has no sends', async () => {
    const { bridge } = await freshOwner();
    expect(await bridge.notificationsResponsesArrived()).toEqual([]);
  });

  it('denies the responses-arrived read to a person without questionnaires.viewResults (a Guest)', async () => {
    const { bridge } = await freshOwner();
    const guest = await bridge.peopleSave({ displayName: 'Guest', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: guest.id, roleId: 'guest', pin: null });
    expect((await bridge.sessionSetActive({ personId: guest.id })).ok).toBe(true);
    expect(await bridge.notificationsResponsesArrived()).toEqual([]);
  });

  it('summarizes a questionnaire once a recipient submits a response (the responses-arrived source)', async () => {
    const { bridge, ownerId } = await freshOwner();
    const recipient = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: recipient.id, roleId: 'member', pin: null });
    const q = await bridge.questionnairesSave({
      title: 'Weekly check-in',
      type: 'role-feedback',
      sensitivity: 'standard',
      recipient: { kind: 'person', personId: recipient.id },
      questions: [{ id: 'q1', type: 'shortText', prompt: 'How are we doing?', required: true }],
    });
    const { assignment } = await bridge.assignmentsCreate({ questionnaireId: q.id });

    // No submission yet → nothing to surface.
    expect(await bridge.notificationsResponsesArrived()).toEqual([]);

    // The recipient submits; switching back to the owner (the sender) surfaces the summary.
    await bridge.sessionSetActive({ personId: recipient.id });
    await bridge.assignmentsSubmit({
      assignmentId: assignment.id,
      answers: [{ questionId: 'q1', value: 'Doing well' }],
    });
    await bridge.sessionSetActive({ personId: ownerId, pin: '1234' });

    const summaries = await bridge.notificationsResponsesArrived();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      questionnaireId: q.id,
      title: 'Weekly check-in',
      submittedCount: 1,
      // The newest responder names the notification ("Mara answered …"), with a submit time (38 §4.2).
      latestRecipientName: 'Mara',
    });
    expect(typeof summaries[0]?.at).toBe('string');
  });

  it('re-asks a household questionnaire in one action — a fresh send, no re-authoring (38 §3.3)', async () => {
    const { bridge, ownerId } = await freshOwner();
    const recipient = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: recipient.id, roleId: 'member', pin: null });
    const q = await bridge.questionnairesSave({
      title: 'Weekly check-in',
      type: 'role-feedback',
      sensitivity: 'standard',
      recipient: { kind: 'person', personId: recipient.id },
      questions: [{ id: 'q1', type: 'shortText', prompt: 'How are we doing?', required: true }],
    });
    const first = await bridge.assignmentsCreate({ questionnaireId: q.id });

    const reAsked = await bridge.assignmentsReAsk({ questionnaireId: q.id });
    expect(reAsked.assignment.id).not.toBe(first.assignment.id);
    expect(reAsked.assignment.questionnaireId).toBe(q.id);
    expect(reAsked.assignment.status).toBe('sent');
    // Both sends now exist for this questionnaire — trends aggregate every submitted send (no re-authoring).
    const results = await bridge.assignmentsResults(q.id);
    expect(results).toHaveLength(2);
    void ownerId;
  });

  it('re-ask auto-revokes the prior relay link so it can’t double-submit (38 §3.6)', async () => {
    const { host, bridge } = await freshOwner();
    await bridge.relayConnect({ apiToken: 'cf-token', accountId: 'acct' });
    const q = await bridge.questionnairesSave({
      title: 'Outside view',
      type: 'blind-spots',
      sensitivity: 'standard',
      recipient: { kind: 'external', displayName: 'Alex' },
      questions: [{ id: 'a', type: 'shortText', prompt: 'How do I come across?', required: true }],
    });
    // First send mints a relay link the recipient could unlock.
    const first = await bridge.assignmentsCreateRelayLink({
      questionnaireId: q.id,
      senderVisibleToRecipient: true,
    });
    const relayFetch = host.host.relay.fetch;
    const oldToken = first.link.split('/q/')[1]?.split('#')[0] ?? '';
    expect(oldToken).not.toBe(''); // a real token, so the 404 below can't pass for the wrong reason
    const okBefore = await relayFetch('https://relay/api/unlock', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: oldToken, pin: first.pin }),
    });
    expect(okBefore.status).toBe(200); // the old link works before the re-ask

    // Re-ask → a brand-new send + fresh link, and the prior mailbox is revoked.
    const reAsked = await bridge.assignmentsReAsk({ questionnaireId: q.id });
    expect(reAsked.assignment.id).not.toBe(first.assignmentId);
    expect(reAsked.link).toMatch(/\.workers\.dev\/q\//);
    expect(reAsked.link).not.toBe(first.link);

    // The OLD link can no longer be unlocked — no duplicate-submit window (the central §3.6 claim).
    const after = await relayFetch('https://relay/api/unlock', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: oldToken, pin: first.pin }),
    });
    expect(after.status).toBe(404);
  });

  it('refuses to re-ask a compatibility questionnaire (use Duplicate instead, 38 §3.3)', async () => {
    const { bridge } = await freshOwner();
    const other = await bridge.peopleSave({ displayName: 'Angel', isSubject: true, tags: [] });
    const q = await bridge.questionnairesSave({
      title: 'Compatibility',
      type: 'role-feedback',
      sensitivity: 'standard',
      recipient: { kind: 'person', personId: other.id },
      compatibility: { enabled: true, visibility: 'sharedReport' },
      questions: [{ id: 'q1', type: 'shortText', prompt: 'How connected?', required: true }],
    });
    await expect(bridge.assignmentsReAsk({ questionnaireId: q.id })).rejects.toThrow(
      /compatibility/i,
    );
  });

  it('does not nudge about a freshly-sent (within-window) unanswered questionnaire (38 §3.3)', async () => {
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
    await bridge.assignmentsCreate({ questionnaireId: q.id });
    // Just sent → still inside the 7-day window → no reminder yet (and the relay drain never auto-runs).
    expect(await bridge.notificationsRemindersDue()).toEqual([]);
  });

  it('denies the reminders read to a person without questionnaires.viewResults (a Guest)', async () => {
    const { bridge } = await freshOwner();
    const guest = await bridge.peopleSave({ displayName: 'Guest', isSubject: false, tags: [] });
    await bridge.accessSetAccount({ personId: guest.id, roleId: 'guest', pin: null });
    await bridge.sessionSetActive({ personId: guest.id });
    expect(await bridge.notificationsRemindersDue()).toEqual([]);
  });

  it('exports results to a file outside the vault; a Private send exports NO answers — words or numbers (§21.5)', async () => {
    const { bridge, ownerId, host } = await freshOwner();
    // Capture what gets written to disk (the export bytes) without a real save dialog.
    const saved: { name: string; bytes: Uint8Array }[] = [];
    host.host.saveImageFile = (name, bytes) => {
      saved.push({ name, bytes });
      return Promise.resolve(`/tmp/${name}`);
    };
    const recipient = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: recipient.id, roleId: 'member', pin: null });
    const q = await bridge.questionnairesSave({
      title: 'Weekly check-in',
      type: 'role-feedback',
      sensitivity: 'standard',
      recipient: { kind: 'person', personId: recipient.id },
      questions: [
        { id: 'prose', type: 'shortText', prompt: 'Anything to add?', required: false },
        {
          id: 'rate',
          type: 'rating',
          prompt: 'Rate it',
          required: true,
          scale: { min: 1, max: 5 },
        },
      ],
    });
    // PRIVATE send → NEITHER the prose NOR the numeric answer may be exported (§21.5).
    const { assignment } = await bridge.assignmentsCreate({
      questionnaireId: q.id,
      privacy: 'private',
    });
    await bridge.sessionSetActive({ personId: recipient.id });
    await bridge.assignmentsSubmit({
      assignmentId: assignment.id,
      answers: [
        { questionId: 'prose', value: 'secret prose' },
        { questionId: 'rate', value: 4 },
      ],
    });
    await bridge.sessionSetActive({ personId: ownerId, pin: '1234' });

    const path = await bridge.assignmentsExportResults({ questionnaireId: q.id, format: 'csv' });
    expect(path).toBe('/tmp/weekly-check-in.csv');
    const csv = new TextDecoder().decode(saved[0]?.bytes);
    // A Private send's answers never reach the file — not the prose, not the numeric value (§21.5).
    expect(csv).not.toContain('secret prose');
    expect(csv).not.toContain(',4');

    // The JSON export is the same boundary — a private send's words and numbers are absent there too.
    await bridge.assignmentsExportResults({ questionnaireId: q.id, format: 'json' });
    const json = new TextDecoder().decode(saved[1]?.bytes);
    expect(json).not.toContain('secret prose');
    expect(json).not.toContain('"value": 4');
  });

  it('opens only http(s) URLs externally, via the host shell', async () => {
    const host = makeHost();
    const opened: string[] = [];
    host.host.openExternal = (url: string) => {
      opened.push(url);
      return Promise.resolve();
    };
    const bridge = createCoreBridge(host.host);
    await bridge.openExternal('https://github.com/Highfivery/SelfOS/releases');
    expect(opened).toEqual(['https://github.com/Highfivery/SelfOS/releases']);
    // A non-http(s) scheme is refused before reaching the shell.
    await expect(bridge.openExternal('file:///etc/passwd')).rejects.toThrow();
    expect(opened).toHaveLength(1);
  });

  it('persists the update-available dismiss APP-GLOBALLY (shared across personas, survives a switch)', async () => {
    const { bridge, ownerId, host } = await freshOwner();
    // The owner dismisses the update AND reads a per-person sync-conflict notice.
    await bridge.setNotificationState({
      read: { 'sync-conflict': '2' },
      dismissed: { 'update-available': '0.5.0' },
    });
    // The update key lives in the shared blob; the conflict in the owner's per-person blob (the split).
    expect(host.device().globalNotificationState).toEqual({
      read: {},
      dismissed: { 'update-available': '0.5.0' },
    });
    expect(host.device().notificationState?.[ownerId]).toEqual({
      read: { 'sync-conflict': '2' },
      dismissed: {},
    });

    // A different person sees the SAME update dismiss (app-global) but NOT the owner's per-person conflict.
    const mara = await bridge.peopleSave({ displayName: 'Mara', isSubject: true, tags: [] });
    expect((await bridge.sessionSetActive({ personId: mara.id })).ok).toBe(true);
    expect(await bridge.getNotificationState()).toEqual({
      read: {},
      dismissed: { 'update-available': '0.5.0' },
    });
  });
});

describe('update awareness (36)', () => {
  it('caches a successful check, and updatesGetState returns the cached result', async () => {
    const { bridge, host } = await freshOwner();
    const result = {
      current: '0.4.0',
      latest: '0.5.0',
      isUpdateAvailable: true,
      releaseUrl: 'https://github.com/Highfivery/SelfOS/releases/tag/v0.5.0',
      publishedAt: '2026-06-20T00:00:00Z',
      checkedAt: '2026-06-23T00:00:00.000Z',
    };
    host.host.checkForUpdate = () => Promise.resolve(result);

    expect(await bridge.updatesCheck()).toEqual(result);
    expect(host.device().lastUpdateCheckResult).toEqual(result);
    expect(host.device().latestKnownVersion).toBe('0.5.0');
    expect(host.device().lastUpdateCheckAt).toBe('2026-06-23T00:00:00.000Z');
    expect(await bridge.updatesGetState()).toEqual(result);
  });

  it('does NOT overwrite the cached result when a check fails (returns null)', async () => {
    const { bridge, host } = await freshOwner();
    const good = {
      current: '0.4.0',
      latest: '0.5.0',
      isUpdateAvailable: true,
      releaseUrl: 'https://github.com/Highfivery/SelfOS/releases',
      checkedAt: '2026-06-23T00:00:00.000Z',
    };
    host.host.checkForUpdate = () => Promise.resolve(good);
    await bridge.updatesCheck();

    // A later failed check (offline/rate-limited) returns null and leaves the cache intact (§7).
    host.host.checkForUpdate = () => Promise.resolve(null);
    expect(await bridge.updatesCheck()).toBeNull();
    expect(await bridge.updatesGetState()).toEqual(good);
  });

  describe('self-assessments (50 §6)', () => {
    /** Max-rate every matrix cell of a test, so subscales land high — exercises take + bridge end-to-end. */
    const maxAnswers = (testId: string): Record<string, unknown> => {
      const def = getTest(testId)!;
      const answers: Record<string, unknown> = {};
      for (const item of def.items) {
        if (item.type === 'matrix' && item.matrix) {
          const record: Record<string, number> = {};
          for (const row of item.matrix.rows) record[matrixRowKey(row)] = item.matrix.max;
          answers[item.id] = record;
        }
      }
      return answers;
    };

    it('lists the catalog (18+ filtered until acked) and takes a test → a TestResult + a test Insight', async () => {
      const { bridge, ownerId, host } = await freshOwner();

      // 18+ tests are withheld from the catalog AND `testsGet`/`testsTake` until acknowledged (the trust boundary).
      let list = await bridge.testsList();
      expect(list.adultAcknowledged).toBe(false);
      expect(list.tests.map((t) => t.id)).toContain('bigfive-ipip-120');
      expect(list.tests.map((t) => t.id)).not.toContain('kink-interests');
      expect(await bridge.testsGet({ testId: 'kink-interests' })).toBeNull();
      expect(await bridge.testsTake({ testId: 'kink-interests', answers: {} })).toBeNull();

      // A non-sensitive take scores + persists + bridges an approved test Insight (own context).
      const result = await bridge.testsTake({ testId: 'ecr-r', answers: maxAnswers('ecr-r') });
      expect(result?.testId).toBe('ecr-r');
      expect(result?.scores).toHaveLength(2);
      const { fs, key } = (await host.host.vaultAndKey())!;
      const testInsight = (await listInsightsForPerson(fs, key, ownerId)).find(
        (i) => i.source === 'test',
      );
      expect(testInsight?.approved).toBe(true);
      expect(testInsight?.facts.every((f) => !f.restricted)).toBe(true);

      // After acknowledging, the 18+ group appears + becomes takeable.
      list = await bridge.testsAcknowledgeAdult();
      expect(list.adultAcknowledged).toBe(true);
      expect(list.tests.map((t) => t.id)).toContain('kink-interests');
      expect((await bridge.testsGet({ testId: 'kink-interests' }))?.id).toBe('kink-interests');
    });

    it('a sensitive (kink) result is partner-shareable + own-context-gated to intimacy, not a money chat (54)', async () => {
      const { bridge, ownerId, host } = await freshOwner();
      await bridge.testsAcknowledgeAdult();
      const result = await bridge.testsTake({
        testId: 'kink-interests',
        answers: maxAnswers('kink-interests'),
      });
      expect(result?.insightId).toBeTruthy();
      const { fs, key } = (await host.host.vaultAndKey())!;
      const insight = (await listInsightsForPerson(fs, key, ownerId)).find(
        (i) => i.source === 'test',
      )!;
      expect(insight.facts.length).toBeGreaterThan(0);
      // 54: NOT `restricted` (so it can be shared with the partner type — `restricted` stays reserved for
      // break-glass intake), but partner-scoped + tagged lifeArea Intimacy so the own-context gate keeps it
      // in intimacy only.
      expect(insight.facts.every((f) => !f.restricted)).toBe(true);
      expect(insight.facts.every((f) => f.shareableTypes?.includes('partner'))).toBe(true);
      expect(insight.facts.every((f) => f.lifeArea === 'Intimacy')).toBe(true);

      const intimacy = await summarizeForContext(fs, key, ownerId, [], { lifeAreas: ['Intimacy'] });
      expect(intimacy).toContain('intimacy interests');
      const money = await summarizeForContext(fs, key, ownerId, [], { lifeAreas: ['Money'] });
      expect(money).not.toContain('intimacy interests');
    });

    it('a retake reuses the insight + chains; delete-all removes the derived Insight', async () => {
      const { bridge, ownerId, host } = await freshOwner();
      const first = await bridge.testsTake({ testId: 'ecr-r', answers: maxAnswers('ecr-r') });
      const second = await bridge.testsTake({ testId: 'ecr-r', answers: maxAnswers('ecr-r') });
      expect(second?.reTakeOf).toBe(first?.id);
      expect(second?.insightId).toBe(first?.insightId);
      expect(await bridge.testsResults({ testId: 'ecr-r' })).toHaveLength(2);

      await bridge.testsDeleteAll({ testId: 'ecr-r' });
      expect(await bridge.testsResults({ testId: 'ecr-r' })).toHaveLength(0);
      const { fs, key } = (await host.host.vaultAndKey())!;
      expect(
        (await listInsightsForPerson(fs, key, ownerId)).filter((i) => i.source === 'test'),
      ).toHaveLength(0);
    });

    it('narrate is the ONLY metered call (take records nothing); $ is admin-only', async () => {
      const { bridge } = await freshOwner();
      await bridge.setSetting({ key: 'ai.enabled', value: true, scope: 'vault' });
      await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-test' });
      const result = await bridge.testsTake({ testId: 'ecr-r', answers: maxAnswers('ecr-r') });
      // take spends nothing — no usage event of any type.
      expect((await bridge.usageSummary({ scope: 'person', period: 'month' })).byType).toEqual({});

      const out = await bridge.testsNarrate({ testId: 'ecr-r', resultId: result!.id });
      expect(out.ok).toBe(true);
      if (out.ok) expect(out.costUsd).toBeDefined(); // owner is admin → $ shown
      expect(
        (await bridge.usageSummary({ scope: 'person', period: 'month' })).byType['test.narrate']
          ?.count,
      ).toBe(1);
    });

    it('denies tests to a person without tests.own (Guest)', async () => {
      const { bridge } = await freshOwner();
      const guest = await bridge.peopleSave({ displayName: 'Guest', isSubject: false, tags: [] });
      await bridge.accessSetAccount({ personId: guest.id, roleId: 'guest', pin: null });
      await bridge.sessionSetActive({ personId: guest.id });
      expect((await bridge.testsList()).tests).toHaveLength(0);
      expect(await bridge.testsGet({ testId: 'ecr-r' })).toBeNull();
      expect(await bridge.testsTake({ testId: 'ecr-r', answers: {} })).toBeNull();
    });
  });
});

describe('createCoreBridge — Together (58) foundation', () => {
  const asPerson = async (host: ReturnType<typeof makeHost>, personId: string): Promise<void> => {
    await host.host.updateDeviceState({ activePersonId: personId });
  };

  /** Seed a household with two subjects (Ben the owner + Angel) linked by a live `partner` edge. */
  async function seedPair(): Promise<{
    host: ReturnType<typeof makeHost>;
    bridge: ReturnType<typeof createCoreBridge>;
    ben: string;
    angel: string;
    edgeId: string;
  }> {
    const { host, bridge, ownerId } = await freshOwner();
    // The owner sets a Claude key (auto-shared to the vault, 25 §5.6) so couples turns can resolve it.
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-together-test' });
    const angel = await bridge.peopleSave({ displayName: 'Angel', isSubject: true, tags: [] });
    const edge = await bridge.relationshipsSave({
      fromPersonId: ownerId,
      toPersonId: angel.id,
      type: 'partner',
    });
    return { host, bridge, ben: ownerId, angel: angel.id, edgeId: edge.id };
  }

  it('full invite lifecycle: create → invited for both → accept → active; declined never leaks (§3.3–§3.5)', async () => {
    const { host, bridge, ben, angel } = await seedPair();
    const created = await bridge.togetherCreate({
      partnerPersonId: angel,
      topic: 'Feeling distant',
    });
    expect(created.ok).toBe(true);
    const sessionId = created.ok ? created.session.id : '';
    expect(created.ok && created.session.status).toBe('invited');
    expect(created.ok && created.session.topic).toBe('Feeling distant');

    // Angel sees the invitation (her projection): status invited, not yet acked.
    await asPerson(host, angel);
    const angelList = await bridge.togetherList();
    expect(angelList).toHaveLength(1);
    expect(angelList[0]?.status).toBe('invited');
    const angelGet = await bridge.togetherGet(sessionId);
    expect(angelGet?.viewerAcked).toBe(false);
    // Partner names resolved for the avatar pair.
    expect(angelGet?.participants.map((p) => p.displayName).sort()).toEqual(['Angel', 'Ben']);

    // Angel accepts → both acked → active for both.
    const accepted = await bridge.togetherAccept(sessionId);
    expect(accepted?.status).toBe('active');
    expect(accepted?.viewerAcked).toBe(true);
    await asPerson(host, ben);
    expect((await bridge.togetherGet(sessionId))?.status).toBe('active');
  });

  it('quiet decline is viewer-projected: the initiator reads invited (never declined); the decliner drops it (§3.5)', async () => {
    const { host, bridge, ben, angel } = await seedPair();
    const created = await bridge.togetherCreate({ partnerPersonId: angel });
    const sessionId = created.ok ? created.session.id : '';

    await asPerson(host, angel);
    await bridge.togetherDecline(sessionId);
    // Decliner: the session is gone from her world entirely.
    expect(await bridge.togetherList()).toHaveLength(0);
    expect(await bridge.togetherGet(sessionId)).toBeNull();

    // Initiator: still just "invited" — never "declined", never notified.
    await asPerson(host, ben);
    const benList = await bridge.togetherList();
    expect(benList).toHaveLength(1);
    expect(benList[0]?.status).toBe('invited');
    expect(await bridge.togetherGet(sessionId)).not.toBeNull();
  });

  it('withdraw: the initiator undoes a pending invite → gone for BOTH; a recipient can’t withdraw (§3.4)', async () => {
    const { host, bridge, ben, angel } = await seedPair();
    const created = await bridge.togetherCreate({ partnerPersonId: angel, topic: 'Reconnecting' });
    const sessionId = created.ok ? created.session.id : '';

    // Angel (the recipient) cannot withdraw Ben's invite — it stays in her world.
    await asPerson(host, angel);
    expect(await bridge.togetherWithdraw(sessionId)).toBe(false);
    expect(await bridge.togetherGet(sessionId)).not.toBeNull();

    // Ben (the initiator) withdraws → gone for him.
    await asPerson(host, ben);
    expect(await bridge.togetherWithdraw(sessionId)).toBe(true);
    expect(await bridge.togetherList()).toHaveLength(0);
    expect(await bridge.togetherGet(sessionId)).toBeNull();

    // …and gone for Angel too — the shared session folder was deleted.
    await asPerson(host, angel);
    expect(await bridge.togetherList()).toHaveLength(0);
    expect(await bridge.togetherGet(sessionId)).toBeNull();
  });

  it('withdraw is refused once the recipient has ACCEPTED (no longer a pending invite) (§3.4)', async () => {
    const { host, bridge, ben, angel } = await seedPair();
    const created = await bridge.togetherCreate({ partnerPersonId: angel });
    const sessionId = created.ok ? created.session.id : '';
    await asPerson(host, angel);
    await bridge.togetherAccept(sessionId); // now active for both
    await asPerson(host, ben);
    expect(await bridge.togetherWithdraw(sessionId)).toBe(false);
    expect(await bridge.togetherGet(sessionId)).not.toBeNull(); // untouched
  });

  it('an expired invitation derives `expired` for the initiator (30-day window)', async () => {
    const { host, bridge, ben, angel } = await seedPair();
    const ctx = (await host.host.vaultAndKey())!;
    const id = 'seed-old';
    const old = '2026-01-01T00:00:00.000Z';
    await writeEncryptedJson(
      ctx.fs,
      `together/sessions/${id}/session.enc`,
      {
        id,
        schemaVersion: 1,
        pairKey: pairKeyFor(ben, angel),
        participantIds: [ben, angel],
        initiatorPersonId: ben,
        createdAt: old,
      },
      ctx.key,
    );
    await writeEncryptedJson(
      ctx.fs,
      `together/sessions/${id}/state/${ben}.enc`,
      { schemaVersion: 1, personId: ben, rulesAckAt: old, updatedAt: old },
      ctx.key,
    );
    await asPerson(host, ben);
    expect((await bridge.togetherGet(id))?.status).toBe('expired');
  });

  it('"send again" mints a FRESH session id; the old one is untouched', async () => {
    const { bridge, angel } = await seedPair();
    const a = await bridge.togetherCreate({ partnerPersonId: angel });
    const b = await bridge.togetherCreate({ partnerPersonId: angel });
    expect(a.ok && b.ok).toBe(true);
    expect(a.ok && b.ok && a.session.id !== b.session.id).toBe(true);
    expect(await bridge.togetherList()).toHaveLength(2);
  });

  it('membership + create gates: a non-participant sees nothing; a non-subject/no-edge partner is refused', async () => {
    const { host, bridge, ben, angel } = await seedPair();
    const created = await bridge.togetherCreate({ partnerPersonId: angel });
    const sessionId = created.ok ? created.session.id : '';

    // A third subject with NO edge to the pair can't read the session.
    const cara = await bridge.peopleSave({ displayName: 'Cara', isSubject: true, tags: [] });
    await asPerson(host, cara.id);
    expect(await bridge.togetherList()).toHaveLength(0);
    expect(await bridge.togetherGet(sessionId)).toBeNull();

    // Creating with a non-subject contact → PARTNER_NOT_SUBJECT.
    await asPerson(host, ben);
    const contact = await bridge.peopleSave({ displayName: 'Dee', isSubject: false, tags: [] });
    const badSubject = await bridge.togetherCreate({ partnerPersonId: contact.id });
    expect(badSubject.ok).toBe(false);
    expect(!badSubject.ok && badSubject.reason).toBe('PARTNER_NOT_SUBJECT');

    // Creating with a subject you have NO partner edge to → NO_EDGE.
    const noEdge = await bridge.togetherCreate({ partnerPersonId: cara.id });
    expect(!noEdge.ok && noEdge.reason).toBe('NO_EDGE');
  });

  it('deleting the partner edge re-gates the session for both; restoring it restores access (§7)', async () => {
    const { host, bridge, ben, angel, edgeId } = await seedPair();
    const created = await bridge.togetherCreate({ partnerPersonId: angel });
    const sessionId = created.ok ? created.session.id : '';
    expect(await bridge.togetherList()).toHaveLength(1);

    await bridge.relationshipsDelete(edgeId);
    expect(await bridge.togetherList()).toHaveLength(0); // inaccessible to the initiator
    expect(await bridge.togetherGet(sessionId)).toBeNull();
    await asPerson(host, angel);
    expect(await bridge.togetherGet(sessionId)).toBeNull(); // …and the partner

    // Restore the edge → access returns (data was never deleted).
    await asPerson(host, ben);
    await bridge.relationshipsSave({ fromPersonId: ben, toPersonId: angel, type: 'partner' });
    expect(await bridge.togetherList()).toHaveLength(1);
    expect(await bridge.togetherGet(sessionId)).not.toBeNull();
  });

  it('a corrupt session file is skipped, not fatal (§7 tolerant reads)', async () => {
    const { host, bridge, angel } = await seedPair();
    await bridge.togetherCreate({ partnerPersonId: angel });
    const ctx = (await host.host.vaultAndKey())!;
    await ctx.fs.writeAtomic(
      'together/sessions/corrupt/session.enc',
      new TextEncoder().encode('not-encrypted'),
    );
    // The corrupt session is skipped; the real one still lists.
    expect(await bridge.togetherList()).toHaveLength(1);
  });

  it('deleting a participant reaps their Together sessions (§5.6 person-delete reap)', async () => {
    const { host, bridge, ben, angel } = await seedPair();
    await bridge.togetherCreate({ partnerPersonId: angel });
    expect(await bridge.togetherList()).toHaveLength(1);
    // Delete Angel (as the owner Ben) → the shared session folder is reaped.
    await asPerson(host, ben);
    await bridge.peopleDelete(angel);
    const ctx = (await host.host.vaultAndKey())!;
    expect(await ctx.fs.list('together/sessions')).toHaveLength(0);
  });

  it('pause is non-attributed: the pauser sees onHold; the partner’s view is unchanged (§8.3)', async () => {
    const { host, bridge, ben, angel } = await seedPair();
    const created = await bridge.togetherCreate({ partnerPersonId: angel });
    const sessionId = created.ok ? created.session.id : '';
    await asPerson(host, angel);
    await bridge.togetherAccept(sessionId); // both acked → active

    await asPerson(host, ben);
    const paused = await bridge.togetherSetPaused({ sessionId, paused: true });
    expect(paused?.status).toBe('onHold');
    // Angel's view is unaffected — pause is the pauser's own state only.
    await asPerson(host, angel);
    expect((await bridge.togetherGet(sessionId))?.status).toBe('active');
  });

  it('leave ends the session for both, neutrally (§8.3)', async () => {
    const { host, bridge, ben, angel } = await seedPair();
    const created = await bridge.togetherCreate({ partnerPersonId: angel });
    const sessionId = created.ok ? created.session.id : '';
    await asPerson(host, angel);
    await bridge.togetherAccept(sessionId);
    await bridge.togetherLeave(sessionId);
    expect((await bridge.togetherGet(sessionId))?.status).toBe('ended');
    await asPerson(host, ben);
    expect((await bridge.togetherGet(sessionId))?.status).toBe('ended');
  });

  it('a couples turn streams + persists; both partners see the shared exchange (§3.6)', async () => {
    const { host, bridge, ben, angel } = await seedPair();
    const created = await bridge.togetherCreate({ partnerPersonId: angel });
    const sessionId = created.ok ? created.session.id : '';
    await asPerson(host, angel);
    await bridge.togetherAccept(sessionId);
    const turn = await bridge.togetherSendMessage({ sessionId, text: 'I miss us.' });
    expect(turn.ok).toBe(true);
    if (turn.ok) {
      expect(turn.view.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
      expect(turn.view.messages[0]?.authorPersonId).toBe(angel);
    }
    expect(host.togetherChunks.length).toBeGreaterThan(0); // the coach reply streamed
    await asPerson(host, ben);
    const benView = await bridge.togetherGet(sessionId);
    expect(benView?.messages.map((m) => m.role)).toEqual(['user', 'assistant']); // shared, both see it
    expect(benView?.yourTurn).toBe(true); // Angel + the coach wrote last → Ben's turn
  });

  it('a private aside (+ its coach reply) is hidden from the partner; her turn/unread badges are unchanged (§3.6)', async () => {
    const { host, bridge, ben, angel } = await seedPair();
    const created = await bridge.togetherCreate({ partnerPersonId: angel });
    const sessionId = created.ok ? created.session.id : '';
    await asPerson(host, angel);
    await bridge.togetherAccept(sessionId);
    const angelBefore = await bridge.togetherGet(sessionId);

    // Ben sends a PRIVATE aside — visible only to him.
    await asPerson(host, ben);
    const asideTurn = await bridge.togetherSendMessage({
      sessionId,
      text: 'I’m scared to say this out loud.',
      privateAside: true,
    });
    expect(asideTurn.ok).toBe(true);
    if (asideTurn.ok) {
      expect(asideTurn.view.messages).toHaveLength(2); // the aside + the coach's private reply
      expect(asideTurn.view.messages.every((m) => m.privateAside)).toBe(true);
    }
    // An ordinary aside coach REPLY must NOT trip the coach-INITIATED private-note signal (§3.14 Part B) —
    // Ben just watched it arrive; `together-private` fires only for an unprompted note.
    const benList = await bridge.togetherList();
    expect(benList.find((s) => s.id === sessionId)?.lastPrivateCoachAt).toBeUndefined();

    // Angel's projection: nothing new — no aside, no coach reply, no placeholder; her badges unchanged.
    await asPerson(host, angel);
    const angelAfter = await bridge.togetherGet(sessionId);
    expect(angelAfter?.messages).toHaveLength(0);
    expect(angelAfter?.yourTurn).toBe(angelBefore?.yourTurn);
    expect(angelAfter?.unreadCount).toBe(angelBefore?.unreadCount);
  });

  it('a coach-initiated private note reaches ONLY the named partner; the shared reply is marker-free (§3.14 Part B)', async () => {
    const { host, bridge, ben, angel } = await seedPair();
    const created = await bridge.togetherCreate({ partnerPersonId: angel, topic: 'Us' });
    const sessionId = created.ok ? created.session.id : '';
    await asPerson(host, angel);
    await bridge.togetherAccept(sessionId);

    // Ben writes an OPEN message; the coach's reply carries a PRIVATE marker addressed to Angel.
    await asPerson(host, ben);
    const turn = await bridge.togetherSendMessage({
      sessionId,
      text: 'I want us close. PRIVATENOTE',
    });
    expect(turn.ok).toBe(true);

    // Ben's projection: his message + the SHARED coach reply — no private note, and the reply is marker-free.
    const benView = await bridge.togetherGet(sessionId);
    expect(benView?.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(benView?.messages.every((m) => !m.content.includes('PRIVATECOACHTEXT'))).toBe(true);
    expect(benView?.messages.every((m) => !m.content.includes('SELFOS:PRIVATE'))).toBe(true);
    expect(benView?.lastPrivateCoachAt).toBeUndefined();

    // Angel's projection: the shared reply PLUS the private coach note (authored for her, a private aside).
    await asPerson(host, angel);
    const angelView = await bridge.togetherGet(sessionId);
    expect(angelView?.messages.map((m) => `${m.role}:${m.privateAside ? 'p' : '-'}`)).toEqual([
      'user:-',
      'assistant:-',
      'assistant:p',
    ]);
    const note = angelView?.messages[2];
    expect(note?.content).toContain('PRIVATECOACHTEXT');
    expect(note?.privateAside).toBe(true);
    // The summary carries the private-note signal for Angel (drives `together-private`), not for Ben.
    const angelList = await bridge.togetherList();
    expect(angelList.find((s) => s.id === sessionId)?.lastPrivateCoachAt).toBe(note?.ts);
  });

  it('over-budget: the initiator sees the standard notice; the partner a NEUTRAL session one — no ratio/$ (§6.2)', async () => {
    const { host, bridge, ben, angel } = await seedPair();
    const created = await bridge.togetherCreate({ partnerPersonId: angel });
    const sessionId = created.ok ? created.session.id : '';
    await asPerson(host, angel);
    await bridge.togetherAccept(sessionId);

    // Put BEN (the initiator + payer) over budget, at the vault level.
    const ctx = (await host.host.vaultAndKey())!;
    await setPersonBudget(ctx.fs, ctx.key, ben, { limitUsd: 0.01, period: 'week', warnRatio: 0.8 });
    await recordUsage(ctx.fs, ctx.key, {
      id: 'u-over',
      schemaVersion: 1,
      type: 'together.chat',
      personId: ben,
      model: 'claude-sonnet-4-6',
      at: new Date().toISOString(),
      inputTokens: 1,
      outputTokens: 1,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      costUsd: 5,
    });

    // The partner (non-initiator) sees a neutral, session-scoped notice — never a ratio, $, or whose budget.
    const partnerTurn = await bridge.togetherSendMessage({ sessionId, text: 'you there?' });
    expect(!partnerTurn.ok && partnerTurn.reason).toBe('BUDGET');
    if (!partnerTurn.ok) {
      expect(partnerTurn.message).not.toContain('$');
      expect(partnerTurn.message).toContain('paused for this session');
    }

    // The initiator sees their own standard budget message.
    await asPerson(host, ben);
    const initiatorTurn = await bridge.togetherSendMessage({ sessionId, text: 'hmm' });
    expect(!initiatorTurn.ok && initiatorTurn.reason).toBe('BUDGET');
    expect(!initiatorTurn.ok && initiatorTurn.message).toBe('AI budget reached for this period.');
  });

  // ── Phase C: prep spaces + attachments (§3.7 / §6.1) ────────────────────────────────────────────
  const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ';

  it('prep opens the active person’s OWN solo thread + stays OUT of the Sessions list (both directions) (§3.7)', async () => {
    const { host, bridge, ben, angel } = await seedPair();
    const created = await bridge.togetherCreate({ partnerPersonId: angel });
    const sessionId = created.ok ? created.session.id : '';
    await asPerson(host, angel);
    await bridge.togetherAccept(sessionId);

    // Angel opens her prep — a solo conversation carrying the link, seeded with a static opener.
    const angelPrep = await bridge.togetherPrepOpen({ sessionId });
    expect(angelPrep?.togetherSessionId).toBe(sessionId);
    expect(angelPrep?.personId).toBe(angel);
    // Find-or-create: opening again returns the same conversation.
    expect((await bridge.togetherPrepOpen({ sessionId }))?.id).toBe(angelPrep?.id);
    // The prep thread NEVER shows in the solo Sessions list (the togetherSessionId filter).
    expect((await bridge.conversationsList()).map((c) => c.id)).not.toContain(angelPrep?.id);

    // Ben's prep is a DIFFERENT thread — invisible to Angel, absent from his Sessions list too.
    await asPerson(host, ben);
    const benPrep = await bridge.togetherPrepOpen({ sessionId });
    expect(benPrep?.id).not.toBe(angelPrep?.id);
    expect((await bridge.conversationsList()).map((c) => c.id)).not.toContain(benPrep?.id);
    await asPerson(host, angel);
    expect((await bridge.conversationsList()).map((c) => c.id)).not.toContain(benPrep?.id);
  });

  it('a private-aside attachment is readable by its author but REFUSED for the partner; a shared one is readable by both (§6.1)', async () => {
    const { host, bridge, ben, angel } = await seedPair();
    const created = await bridge.togetherCreate({ partnerPersonId: angel });
    const sessionId = created.ok ? created.session.id : '';
    await asPerson(host, angel);
    await bridge.togetherAccept(sessionId);

    // Ben attaches an image to a PRIVATE aside.
    await asPerson(host, ben);
    const asideRef = await bridge.togetherStoreAttachment({
      sessionId,
      base64: PNG_B64,
      mime: 'image/png',
    });
    if ('ok' in asideRef) throw new Error('aside store failed');
    await bridge.togetherSendMessage({
      sessionId,
      text: 'a photo, just for the coach',
      privateAside: true,
      attachments: [asideRef],
    });
    // Ben (the author) can read his aside's image.
    expect((await bridge.togetherGetAttachment({ sessionId, path: asideRef.path }))?.mime).toBe(
      'image/png',
    );

    // Ben also shares a NON-aside image both should see.
    const sharedRef = await bridge.togetherStoreAttachment({
      sessionId,
      base64: PNG_B64,
      mime: 'image/png',
    });
    if ('ok' in sharedRef) throw new Error('shared store failed');
    await bridge.togetherSendMessage({
      sessionId,
      text: 'us last summer',
      attachments: [sharedRef],
    });

    // Ben stores an ORPHAN image (bytes on disk) but never sends a message referencing it.
    const orphan = await bridge.togetherStoreAttachment({
      sessionId,
      base64: PNG_B64,
      mime: 'image/png',
    });
    if ('ok' in orphan) throw new Error('orphan store failed');

    // Angel: the aside's image is REFUSED (null — message-gated), the shared image reads fine, and the
    // owner-less ORPHAN fails CLOSED (no owning message ⇒ null, even though bytes exist on disk).
    await asPerson(host, angel);
    expect(await bridge.togetherGetAttachment({ sessionId, path: asideRef.path })).toBeNull();
    expect((await bridge.togetherGetAttachment({ sessionId, path: sharedRef.path }))?.mime).toBe(
      'image/png',
    );
    expect(await bridge.togetherGetAttachment({ sessionId, path: orphan.path })).toBeNull();
  });

  it('store rejects an unsupported mime, and a non-participant cannot read/store/prep (§5.2 trust boundary)', async () => {
    const { host, bridge, ben, angel } = await seedPair();
    const created = await bridge.togetherCreate({ partnerPersonId: angel });
    const sessionId = created.ok ? created.session.id : '';
    await asPerson(host, angel);
    await bridge.togetherAccept(sessionId);

    await asPerson(host, ben);
    const bad = await bridge.togetherStoreAttachment({
      sessionId,
      base64: PNG_B64,
      mime: 'application/pdf',
    });
    expect('ok' in bad && bad.reason).toBe('UNSUPPORTED');

    // A third household subject with no membership/edge is refused everywhere.
    const cara = await bridge.peopleSave({ displayName: 'Cara', isSubject: true, tags: [] });
    await asPerson(host, cara.id);
    expect(await bridge.togetherPrepOpen({ sessionId })).toBeNull();
    const outsider = await bridge.togetherStoreAttachment({
      sessionId,
      base64: PNG_B64,
      mime: 'image/png',
    });
    expect('ok' in outsider && outsider.reason).toBe('NOT_FOUND');
    expect(
      await bridge.togetherGetAttachment({
        sessionId,
        path: `together/sessions/${sessionId}/attachments/x.enc`,
      }),
    ).toBeNull();
  });

  // ── Phase D: wrap-up + agreements (§3.8/§3.9) ──────────────────────────────────────────────────
  it('wrap-up writes a shared report + per-partner twins; the private aside is ABSENT from BOTH; sexual facts are restricted; the initiator is billed (§3.8)', async () => {
    const { host, bridge, ben, angel } = await seedPair();
    const created = await bridge.togetherCreate({ partnerPersonId: angel });
    const sessionId = created.ok ? created.session.id : '';
    await asPerson(host, angel);
    await bridge.togetherAccept(sessionId);

    // A shared exchange, then a PRIVATE aside by Ben (its content must never reach the report or twins).
    await asPerson(host, ben);
    await bridge.togetherSendMessage({ sessionId, text: 'I want more time together.' });
    await bridge.togetherSendMessage({
      sessionId,
      text: 'SECRETASIDE I am scared.',
      privateAside: true,
    });

    const wrap = await bridge.togetherWrapUp({ sessionId });
    expect(wrap.ok).toBe(true);
    if (wrap.ok) expect(wrap.report.summary).toContain('showed up honestly');

    const ctx = (await host.host.vaultAndKey())!;
    // The report carries NO aside content.
    expect(JSON.stringify(wrap.ok ? wrap.report : {})).not.toContain('SECRETASIDE');
    // Two twins, one per partner, each feeding only that partner — neither contains the aside.
    const benTwins = (await listInsightsForPerson(ctx.fs, ctx.key, ben)).filter(
      (i) => i.source === 'together',
    );
    const angelTwins = (await listInsightsForPerson(ctx.fs, ctx.key, angel)).filter(
      (i) => i.source === 'together',
    );
    // Ben has no sexual facts → one MAIN twin. Angel has one → a MAIN twin + an INTIMACY companion (split so
    // her reflection still feeds while the sexual fact stays own-context-only + intimacy-gated, §3.8).
    expect(benTwins).toHaveLength(1);
    expect(angelTwins).toHaveLength(2);
    expect(JSON.stringify(benTwins)).not.toContain('SECRETASIDE');
    expect(JSON.stringify(angelTwins)).not.toContain('SECRETASIDE');
    expect(benTwins[0]?.provenance.pairKey).toBe(pairKeyFor(ben, angel));
    // The sexual fact lives on the RESTRICTED intimacy companion, tagged lifeArea Intimacy.
    const intimacy = angelTwins.find((i) => i.facts.some((f) => f.restricted));
    const main = angelTwins.find((i) => !i.facts.some((f) => f.restricted));
    const sensitive = intimacy?.facts.find((f) => f.text === 'a desire preference');
    expect(sensitive?.restricted).toBe(true);
    expect(sensitive?.lifeArea).toBe('Intimacy');
    // The main twin (reflection + non-sexual fact) carries no restricted fact → it feeds Angel's context.
    expect(main?.facts.some((f) => f.restricted)).toBe(false);
    // The INITIATOR (Ben) is billed for the analyze pass (§6.2).
    const usage = await queryUsage(ctx.fs, ctx.key, {
      from: '2026-01-01T00:00:00.000Z',
      to: '2030-01-01T00:00:00.000Z',
      type: 'together.analyze',
    });
    expect(usage.every((u) => u.personId === ben)).toBe(true);
    expect(usage.length).toBeGreaterThan(0);
  });

  it('reflect (mid-session) creates deduped action items + keeps the session OPEN; wrap-up marks it DONE — reflect→wrap-up never doubles the action items (§3.8/§3.9)', async () => {
    const { host, bridge, ben, angel } = await seedPair();
    const created = await bridge.togetherCreate({ partnerPersonId: angel });
    const sessionId = created.ok ? created.session.id : '';
    await asPerson(host, angel);
    await bridge.togetherAccept(sessionId);
    await asPerson(host, ben);
    await bridge.togetherSendMessage({ sessionId, text: 'Let’s protect our evenings.' });

    // A mid-session REFLECT checkpoint: creates the report + the two action items as standing agreements, but
    // leaves the session OPEN (no `wrappedUp` → not `complete`).
    const reflect = await bridge.togetherWrapUp({ sessionId, mode: 'reflect' });
    expect(reflect.ok).toBe(true);
    if (reflect.ok) expect(reflect.report.wrappedUp).toBeUndefined();
    expect((await bridge.togetherGet(sessionId))?.status).toBe('active');
    const afterReflect = await bridge.togetherGetReport({ sessionId });
    expect(
      afterReflect.agreements
        .filter((a) => a.status === 'standing')
        .map((a) => a.text)
        .sort(),
    ).toEqual(['Set a weekly check-in time', 'Trade one appreciation each evening']);

    // Now WRAP UP: same analysis (same action items) → must NOT double them, AND marks the session done.
    const wrap = await bridge.togetherWrapUp({ sessionId, mode: 'wrapUp' });
    expect(wrap.ok).toBe(true);
    if (wrap.ok) expect(wrap.report.wrappedUp).toBe(true);
    const afterWrap = await bridge.togetherGetReport({ sessionId });
    expect(afterWrap.agreements.filter((a) => a.status === 'standing')).toHaveLength(2); // not 4
    // The explicit wrap-up derives the session `complete` (§3.8) for both partners.
    expect((await bridge.togetherGet(sessionId))?.status).toBe('complete');
    await asPerson(host, angel);
    expect((await bridge.togetherGet(sessionId))?.status).toBe('complete');
  });

  it('a crisis flag routes to the affected partner’s twin ONLY, never into the shared report (§8.5)', async () => {
    const { host, bridge, ben, angel } = await seedPair();
    const created = await bridge.togetherCreate({ partnerPersonId: angel });
    const sessionId = created.ok ? created.session.id : '';
    await asPerson(host, angel);
    await bridge.togetherAccept(sessionId);
    // Angel discloses crisis in a SHARED message (the fake flags a partner whose line contains "CRISIS").
    await bridge.togetherSendMessage({ sessionId, text: 'CRISIS I feel hopeless.' });

    await asPerson(host, ben);
    const wrap = await bridge.togetherWrapUp({ sessionId });
    expect(wrap.ok).toBe(true);
    if (wrap.ok) expect(wrap.report.summary).not.toContain('CRISIS');
    const ctx = (await host.host.vaultAndKey())!;
    // The crisisFlag lands on the MAIN twin (the non-restricted one); scope past any intimacy companion.
    const angelMain = (await listInsightsForPerson(ctx.fs, ctx.key, angel)).find(
      (i) => i.source === 'together' && !i.facts.some((f) => f.restricted),
    );
    const benMain = (await listInsightsForPerson(ctx.fs, ctx.key, ben)).find(
      (i) => i.source === 'together' && !i.facts.some((f) => f.restricted),
    );
    expect(angelMain?.crisisFlag).toBe(true);
    expect(benMain?.crisisFlag).toBeUndefined();
  });

  it('agreements round-trip inline (create → edit → retire); report staleness derives; a non-participant is refused (§3.9/§11 #2)', async () => {
    const { host, bridge, ben, angel } = await seedPair();
    const created = await bridge.togetherCreate({ partnerPersonId: angel });
    const sessionId = created.ok ? created.session.id : '';
    await asPerson(host, angel);
    await bridge.togetherAccept(sessionId);
    await asPerson(host, ben);
    await bridge.togetherSendMessage({ sessionId, text: 'Let’s set a rhythm.' });

    // Create an agreement inline; it shows in the pair ledger.
    const a = await bridge.togetherSaveAgreement({
      sessionId,
      text: 'weekly date night',
      status: 'standing',
    });
    expect(a?.status).toBe('standing');
    let view = await bridge.togetherGetReport({ sessionId });
    expect(view.agreements.map((x) => x.id)).toContain(a?.id);

    // Wrap up, then send a NEW shared message → the report derives stale (§3.8).
    await bridge.togetherWrapUp({ sessionId });
    expect((await bridge.togetherGetReport({ sessionId })).stale).toBe(false);
    await bridge.togetherSendMessage({ sessionId, text: 'One more thing.' });
    expect((await bridge.togetherGetReport({ sessionId })).stale).toBe(true);

    // Edit inline (mark done), then retire.
    const done = await bridge.togetherSaveAgreement({
      sessionId,
      id: a!.id,
      text: 'weekly date night',
      status: 'done',
    });
    expect(done?.status).toBe('done');
    view = await bridge.togetherGetReport({ sessionId });
    expect(view.agreements.find((x) => x.id === a?.id)?.status).toBe('done');

    // A non-participant cannot save an agreement or read the report.
    const cara = await bridge.peopleSave({ displayName: 'Cara', isSubject: true, tags: [] });
    await asPerson(host, cara.id);
    expect(
      await bridge.togetherSaveAgreement({ sessionId, text: 'sneaky', status: 'standing' }),
    ).toBeNull();
    expect((await bridge.togetherGetReport({ sessionId })).report).toBeNull();
  });

  it('the per-session ledger shows only THIS session’s agreements + collapses duplicates (issue #206)', async () => {
    const { host, bridge, ben, angel } = await seedPair();
    // Session A + two IDENTICAL agreements (a repeated capture) made in it.
    const createdA = await bridge.togetherCreate({ partnerPersonId: angel });
    const sessionA = createdA.ok ? createdA.session.id : '';
    await asPerson(host, angel);
    await bridge.togetherAccept(sessionA);
    await asPerson(host, ben);
    await bridge.togetherSaveAgreement({
      sessionId: sessionA,
      text: 'screen-free dinners',
      status: 'standing',
    });
    await bridge.togetherSaveAgreement({
      sessionId: sessionA,
      text: 'Screen-free dinners.', // same commitment, different case/punctuation
      status: 'standing',
    });

    // A SECOND session between the SAME pair, with its own distinct agreement.
    const createdB = await bridge.togetherCreate({ partnerPersonId: angel });
    const sessionB = createdB.ok ? createdB.session.id : '';
    await asPerson(host, angel);
    await bridge.togetherAccept(sessionB);
    await asPerson(host, ben);
    await bridge.togetherSaveAgreement({
      sessionId: sessionB,
      text: 'plan a weekend trip',
      status: 'standing',
    });

    // Session A's ledger: exactly one "screen-free dinners" (deduped), and NEVER B's trip.
    const viewA = await bridge.togetherGetReport({ sessionId: sessionA });
    expect(viewA.agreements).toHaveLength(1);
    expect(viewA.agreements[0]?.text.toLowerCase()).toContain('screen-free dinners');
    expect(viewA.agreements.some((a) => a.text.toLowerCase().includes('weekend trip'))).toBe(false);

    // Session B's ledger: only B's agreement, never A's.
    const viewB = await bridge.togetherGetReport({ sessionId: sessionB });
    expect(viewB.agreements.map((a) => a.text)).toEqual(['plan a weekend trip']);
  });

  it('cross-pair agreements (spec 61): each partner sees the shared record scoped to their pairs; mark-done writes back; a non-member is refused', async () => {
    const { host, bridge, ben, angel } = await seedPair();
    const created = await bridge.togetherCreate({ partnerPersonId: angel });
    const sessionId = created.ok ? created.session.id : '';
    await asPerson(host, angel);
    await bridge.togetherAccept(sessionId);
    await asPerson(host, ben);
    const a = await bridge.togetherSaveAgreement({
      sessionId,
      text: 'weekly date night',
      status: 'standing',
    });

    // Ben sees the standing agreement across his pairs — the OTHER member (Angel) resolved for display.
    const benRows = await bridge.togetherMyAgreements();
    expect(benRows.map((r) => r.agreement.id)).toContain(a?.id);
    const benRow = benRows.find((r) => r.agreement.id === a?.id);
    expect(benRow?.partnerPersonId).toBe(angel);
    expect(benRow?.partnerName).toBe('Angel');

    // Angel sees the SAME shared record (partner resolved to Ben) — it's the one pair-level ledger.
    await asPerson(host, angel);
    const angelRows = await bridge.togetherMyAgreements();
    expect(angelRows.find((r) => r.agreement.id === a?.id)?.partnerName).toBe('Ben');

    // A third household member sees none of it (scoped to their own pairs).
    const cara = await bridge.peopleSave({ displayName: 'Cara', isSubject: true, tags: [] });
    await asPerson(host, cara.id);
    expect(await bridge.togetherMyAgreements()).toEqual([]);
    // …and cannot mark someone else's agreement done (no pair → refused).
    expect(
      await bridge.togetherSetAgreementStatus({
        partnerPersonId: angel,
        agreementId: a!.id,
        status: 'done',
      }),
    ).toBeNull();

    // Ben marks it done from the Goals surface (resolves the pair from the partner id, not the session).
    await asPerson(host, ben);
    const done = await bridge.togetherSetAgreementStatus({
      partnerPersonId: angel,
      agreementId: a!.id,
      status: 'done',
    });
    expect(done?.status).toBe('done');
    expect(done?.text).toBe('weekly date night'); // text preserved — only status changed
    // It leaves the standing set for BOTH partners.
    expect(await bridge.togetherMyAgreements()).toEqual([]);
    await asPerson(host, angel);
    expect(await bridge.togetherMyAgreements()).toEqual([]);
    // …and the shared ledger reads done for Angel.
    expect(
      (await bridge.togetherGetReport({ sessionId })).agreements.find((x) => x.id === a?.id)
        ?.status,
    ).toBe('done');

    // A completed commitment is RECORDED in the Goals "Completed & closed" read for BOTH partners (not lost when
    // it leaves the standing list) — the partner display name resolved (user request 2026-07-15).
    await asPerson(host, ben);
    const benDone = await bridge.togetherDoneCommitments();
    expect(benDone.map((r) => r.agreement.id)).toContain(a?.id);
    expect(benDone.find((r) => r.agreement.id === a?.id)?.partnerName).toBe('Angel');
    await asPerson(host, angel);
    expect(
      (await bridge.togetherDoneCommitments()).find((r) => r.agreement.id === a?.id),
    ).toBeTruthy();

    // Reopen from Goals → back to standing for BOTH; it leaves the completed list and returns to the standing one.
    await asPerson(host, ben);
    const reopened = await bridge.togetherSetAgreementStatus({
      partnerPersonId: angel,
      agreementId: a!.id,
      status: 'standing',
    });
    expect(reopened?.status).toBe('standing');
    expect(reopened?.text).toBe('weekly date night'); // text preserved across the round-trip
    expect(await bridge.togetherDoneCommitments()).toEqual([]);
    expect((await bridge.togetherMyAgreements()).map((r) => r.agreement.id)).toContain(a?.id);
  });

  // ── Phase E: guided couples catalog (§3.10) ────────────────────────────────────────────────────
  it('starts a structured guided session: seeds the opener, resolves the guide view + derives the step; a chat guide has no stepper; unknown/adult refused (§3.10)', async () => {
    const { host, bridge, ben, angel } = await seedPair();
    // The catalog withholds the 18+ group host-side (none in Phase E) and returns Connect + Repair cards.
    const catalog = await bridge.togetherCatalog();
    expect(catalog.length).toBeGreaterThan(0);
    expect(catalog.every((c) => !c.adult)).toBe(true);
    expect(catalog.some((c) => c.id === 'love-maps' && c.kind === 'structured')).toBe(true);

    // Start a structured guided session.
    const created = await bridge.togetherCreate({ partnerPersonId: angel, guideId: 'love-maps' });
    expect(created.ok).toBe(true);
    const sessionId = created.ok ? created.session.id : '';
    // The static opener is seeded as a shared coach message (no model call); the guide view resolves.
    await asPerson(host, angel);
    await bridge.togetherAccept(sessionId);
    const view = await bridge.togetherGet(sessionId);
    expect(view?.guide?.id).toBe('love-maps');
    expect(view?.guide?.kind).toBe('structured');
    expect(
      view?.messages.some((m) => m.role === 'assistant' && m.content.includes('Love Maps')),
    ).toBe(true);
    expect(view?.guideStep).toBe(0); // no coach step declared yet

    // A couples turn whose reply declares a step advances the DERIVED step (marker stripped from content).
    await asPerson(host, ben);
    // The offline fake couples reply appends a step marker when the user text mentions "step two".
    await bridge.togetherSendMessage({ sessionId, text: 'let’s move to step two' });
    const advanced = await bridge.togetherGet(sessionId);
    expect(advanced?.guideStep).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(advanced?.messages)).not.toContain('SELFOS:STEP');

    // A chat guide resolves a guide view but no stepper (guideStep undefined).
    const chat = await bridge.togetherCreate({ partnerPersonId: angel, guideId: 'four-horsemen' });
    const chatView = chat.ok ? await bridge.togetherGet(chat.session.id) : null;
    expect(chatView?.guide?.kind).toBe('chat');
    expect(chatView?.guideStep).toBeUndefined();

    // Unknown + adult guide ids are refused host-side (the desire group lands, ack-gated, in Phase F).
    expect((await bridge.togetherCreate({ partnerPersonId: angel, guideId: 'nope' })).ok).toBe(
      false,
    );
  });

  // ── Phase F: 18+ acks + explicit register + YNM (§3.10/§3.10b) ──────────────────────────────────
  /** Seed a person's intimacy activity ratings (the intake `activities` matrix, 1-5). */
  async function seedActivities(
    ctx: { fs: FileSystem; key: Uint8Array },
    personId: string,
    activities: Record<string, number>,
  ): Promise<void> {
    await writeEncryptedJson(
      ctx.fs,
      `people/${personId}/intake/session.enc`,
      {
        id: `intake-${personId}`,
        schemaVersion: 1,
        personId,
        status: 'complete',
        sections: [
          {
            id: 'intimacy',
            status: 'complete',
            restricted: true,
            messages: [],
            answers: { activities },
          },
        ],
        startedAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
      },
      ctx.key,
    );
  }

  it('the desire group + adult guides are WITHHELD until BOTH partners ack; the ack unlocks them (§3.10)', async () => {
    const { host, bridge, ben, angel } = await seedPair();
    // Neither has acked → the catalog has no desire cards, and an adult guide is refused.
    expect((await bridge.togetherCatalog()).some((c) => c.group === 'together-desire')).toBe(false);
    expect(
      (await bridge.togetherCreate({ partnerPersonId: angel, guideId: 'sensate-focus' })).ok,
    ).toBe(false);

    // Ben acks — still not both, so still withheld.
    await bridge.togetherAcknowledgeAdult();
    expect((await bridge.togetherCatalog()).some((c) => c.group === 'together-desire')).toBe(false);
    expect(
      (await bridge.togetherCreate({ partnerPersonId: angel, guideId: 'sensate-focus' })).ok,
    ).toBe(false);

    // Angel acks too → both acked → the desire group appears + an adult guide can start.
    await asPerson(host, angel);
    await bridge.togetherAcknowledgeAdult();
    await asPerson(host, ben);
    expect(
      (await bridge.togetherCatalog()).filter((c) => c.group === 'together-desire').length,
    ).toBe(4);
    const created = await bridge.togetherCreate({
      partnerPersonId: angel,
      guideId: 'sensate-focus',
    });
    expect(created.ok).toBe(true);
  });

  it('YNM is symmetric + revocable; the mutual overlap shows ONLY items both are ≥ curious about, never one-sided (§3.10b)', async () => {
    const { host, bridge, ben, angel } = await seedPair();
    const ctx = (await host.host.vaultAndKey())!;
    // Seed activity ratings: 'a-shared' both curious+, 'a-ben' Ben only, 'a-angel' Angel only.
    await seedActivities(ctx, ben, { 'a-shared': 4, 'a-ben': 5, 'a-angel': 1 });
    await seedActivities(ctx, angel, { 'a-shared': 3, 'a-ben': 2, 'a-angel': 5 });

    // Before acks: not eligible; overlap empty.
    expect((await bridge.togetherYnmStatus({ partnerPersonId: angel })).eligible).toBe(false);
    expect(await bridge.togetherYnmOverlap({ partnerPersonId: angel })).toEqual({
      ready: false,
      items: [],
    });

    // Both ack → eligible, but the overlap needs BOTH opt-ins.
    await bridge.togetherAcknowledgeAdult();
    await asPerson(host, angel);
    await bridge.togetherAcknowledgeAdult();
    await asPerson(host, ben);
    let status = await bridge.togetherYnmStatus({ partnerPersonId: angel });
    expect(status.eligible).toBe(true);
    expect(status.ready).toBe(false);

    // Ben opts in — still not both.
    status = await bridge.togetherYnmOptIn({ partnerPersonId: angel });
    expect(status.youOptedIn).toBe(true);
    expect(status.ready).toBe(false);
    expect((await bridge.togetherYnmOverlap({ partnerPersonId: angel })).ready).toBe(false);

    // Angel opts in too → ready → the mutual overlap shows ONLY 'a-shared'.
    await asPerson(host, angel);
    await bridge.togetherYnmOptIn({ partnerPersonId: ben });
    await asPerson(host, ben);
    const overlap = await bridge.togetherYnmOverlap({ partnerPersonId: angel });
    expect(overlap.ready).toBe(true);
    const keys = overlap.items.map((i) => i.key);
    expect(keys).toContain('a-shared');
    expect(keys).not.toContain('a-ben'); // one-sided (Ben only) — never shown
    expect(keys).not.toContain('a-angel'); // one-sided (Angel only) — never shown

    // Ben revokes → the overlap immediately drops to not-ready (live re-gate, §3.10b).
    await bridge.togetherYnmRevoke({ partnerPersonId: angel });
    expect((await bridge.togetherYnmOverlap({ partnerPersonId: angel })).ready).toBe(false);
    expect((await bridge.togetherYnmStatus({ partnerPersonId: angel })).ready).toBe(false);
  });

  // ── Phase G: Pulse (§3.10a — absorbs spec 11) ────────────────────────────────────────────────────
  it('Pulse surfaces each viewer’s OWN trends; desire alignment appears only when BOTH share (dual consent)', async () => {
    const { host, bridge, ben, angel } = await seedPair();

    // Ben logs a check-in sharing his desire; his own trend shows, alignment not ready (Angel hasn't shared).
    let view = await bridge.togetherPulseLog({
      partnerPersonId: angel,
      metrics: { connection: 0.4, desire: 0.8, satisfaction: 0.6 },
      shareMetrics: ['desire'],
    });
    expect(view.hasCheckIns).toBe(true);
    expect(view.checkInSeries.find((s) => s.label === 'Connection')?.points).toHaveLength(1);
    expect(view.alignment.ready).toBe(false);

    // Angel logs but does NOT share desire → still hidden for both.
    await asPerson(host, angel);
    await bridge.togetherPulseLog({ partnerPersonId: ben, metrics: { desire: 0.7 } });
    expect((await bridge.togetherPulse({ partnerPersonId: ben })).alignment.ready).toBe(false);
    await asPerson(host, ben);
    expect((await bridge.togetherPulse({ partnerPersonId: angel })).alignment.ready).toBe(false);

    // Angel shares → dual consent met → the desire alignment surfaces for both, each seeing the read.
    await asPerson(host, angel);
    await bridge.togetherPulseLog({
      partnerPersonId: ben,
      metrics: { desire: 0.75 },
      shareMetrics: ['desire'],
    });
    const angelView = await bridge.togetherPulse({ partnerPersonId: ben });
    expect(angelView.alignment.ready).toBe(true);
    expect(angelView.alignment.read).toBe('aligned');
    await asPerson(host, ben);
    view = await bridge.togetherPulse({ partnerPersonId: angel });
    expect(view.alignment.ready).toBe(true);
    expect(view.alignment.yours).toBe(0.8);
    expect(view.alignment.theirs).toBe(0.75);

    // A non-partner cannot read this pair's Pulse (live edge required, §5.2).
    const stranger = await bridge.peopleSave({
      displayName: 'Stranger',
      isSubject: true,
      tags: [],
    });
    await asPerson(host, stranger.id);
    const strangerView = await bridge.togetherPulse({ partnerPersonId: angel });
    expect(strangerView.hasCheckIns).toBe(false);
    expect(strangerView.alignment.ready).toBe(false);
  });

  // ── Phase H2: joint challenges (§5.6) ────────────────────────────────────────────────────────────
  it('a joint challenge shows for BOTH partners with the cross-partner status; a non-partner sees none', async () => {
    const { host, bridge, ben, angel } = await seedPair();
    const ctx = (await host.host.vaultAndKey())!;
    const created = await bridge.togetherCreate({ partnerPersonId: angel });
    const sessionId = created.ok ? created.session.id : '';
    // Seed a joint challenge directly (the couples coach mints it from a CHALLENGE marker in the real turn).
    await captureJointChallengeFromMarker(
      ctx.fs,
      ctx.key,
      [ben, angel],
      {
        action: 'Share one appreciation a day',
        comfort: 2,
        lifeArea: 'Relationships',
        checkInDays: 7,
      },
      sessionId,
      new Date(),
    );

    // Ben sees the joint challenge; neither has checked in yet.
    let benList = await bridge.togetherJointChallenges({ partnerPersonId: angel });
    expect(benList).toHaveLength(1);
    expect(benList[0]?.action).toBe('Share one appreciation a day');
    expect(benList[0]?.checkedInCount).toBe(0);

    // Ben checks in his own twin → 1 of 2 (his own per-person card, the 52 machinery).
    const benTwin = (await listChallenges(ctx.fs, ctx.key, ben))[0]!;
    await recordCheckIn({
      fs: ctx.fs,
      key: ctx.key,
      personId: ben,
      challengeId: benTwin.id,
      outcome: 'did',
      now: new Date(),
    });
    benList = await bridge.togetherJointChallenges({ partnerPersonId: angel });
    expect(benList[0]?.checkedInCount).toBe(1);
    expect(benList[0]?.allCheckedIn).toBe(false);

    // Create a non-partner while still the owner (peopleSave needs people.manage).
    const stranger = await bridge.peopleSave({
      displayName: 'Stranger',
      isSubject: true,
      tags: [],
    });

    // Angel sees the same joint challenge (her projection).
    await asPerson(host, angel);
    const angelList = await bridge.togetherJointChallenges({ partnerPersonId: ben });
    expect(angelList).toHaveLength(1);
    expect(angelList[0]?.groupId).toBe(benList[0]?.groupId);

    // A non-partner (no live edge) sees none.
    await asPerson(host, stranger.id);
    expect(await bridge.togetherJointChallenges({ partnerPersonId: angel })).toHaveLength(0);
  });

  // ── Phase H3: coach suggestions (§5.6) ───────────────────────────────────────────────────────────
  it('a coach suggestion is visible to BOTH participants but NOT to a non-participant (§5.6)', async () => {
    const { host, bridge, angel } = await seedPair();
    const ctx = (await host.host.vaultAndKey())!;
    const created = await bridge.togetherCreate({ partnerPersonId: angel });
    const sessionId = created.ok ? created.session.id : '';
    // Seed a coach suggestion (the couples turn writes it from a SUGGEST marker in the real flow).
    await captureSuggestionFromMarker(
      ctx.fs,
      ctx.key,
      sessionId,
      { kind: 'guide', prompt: 'Try Love Maps together', guideId: 'love-maps' },
      new Date(),
    );
    // Create the non-participant while still the owner (peopleSave needs people.manage).
    const stranger = await bridge.peopleSave({
      displayName: 'Stranger',
      isSubject: true,
      tags: [],
    });

    // Ben (a participant) sees it.
    const benList = await bridge.togetherSuggestions(sessionId);
    expect(benList).toHaveLength(1);
    expect(benList[0]?.guideId).toBe('love-maps');

    // Angel (the other participant) sees it too (her accepted session).
    await asPerson(host, angel);
    await bridge.togetherAccept(sessionId);
    expect(await bridge.togetherSuggestions(sessionId)).toHaveLength(1);

    // A non-participant sees none (session not accessible).
    await asPerson(host, stranger.id);
    expect(await bridge.togetherSuggestions(sessionId)).toHaveLength(0);
  });

  // --- Your Story (64-your-story §5.6) -------------------------------------------------------------------
  it('story: create → generate foundations → approve outline → list/get → delete', async () => {
    const { bridge } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-story' });
    await bridge.setSetting({ key: 'ai.enabled', value: true, scope: 'vault' });

    // The registry crosses via IPC (v1: the biography, with a default structure + style presets).
    const types = await bridge.storyBookTypes();
    expect(types.map((t) => t.id)).toEqual(['biography']);
    expect(types[0]?.structures.some((s) => s.isDefault)).toBe(true);
    expect(types[0]?.stylePresets.length).toBeGreaterThan(0);

    const book = await bridge.storyCreate({
      type: 'biography',
      title: 'The Story of Ben',
      config: { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true },
    });
    expect(book?.status).toBe('outlining');
    const bookId = book!.id;

    // Foundations pass (metered story.outline via the fake claude 'plan a biography of' branch).
    const gen = await bridge.storyGenerateFoundations({ bookId });
    expect(gen.ok).toBe(true);
    if (!gen.ok) return;
    expect(gen.bundle.manifest.essence).toContain('learning to speak');
    // A title the person supplied is never overwritten by the foundations pass (§3.2).
    expect(gen.bundle.manifest.title).toBe('The Story of Ben');
    expect(gen.bundle.outline?.approved).toBe(false);
    expect(gen.bundle.outline?.parts[0]?.chapters[0]?.title).toBe('The Garage');
    expect(gen.bundle.timeline?.events[0]?.label).toBe('Born in Ohio');

    // Approve the (optionally edited) outline → the book moves to drafting.
    const approved = await bridge.storyApproveOutline({ bookId, outline: gen.bundle.outline! });
    expect(approved?.status).toBe('drafting');
    expect((await bridge.storyGet({ bookId }))?.outline?.approved).toBe(true);

    expect((await bridge.storyList()).map((b) => b.id)).toEqual([bookId]);
    await bridge.storyDelete({ bookId });
    expect(await bridge.storyList()).toEqual([]);
    expect(await bridge.storyGet({ bookId })).toBeNull();
  });

  it('story: rewrite from scratch resets the book to a fresh pre-draft state, keeping the manifest (§13.6.6)', async () => {
    const { bridge } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-story' });
    await bridge.setSetting({ key: 'ai.enabled', value: true, scope: 'vault' });

    // Draft the whole book so there's an essence, outline, and chapters to discard.
    const book = await bridge.storyCreate({
      type: 'biography',
      title: 'The Story of Ben',
      config: { voice: 'third', style: 'cinematic', length: 'full', autoRefresh: true },
    });
    const bookId = book!.id;
    const drafted = await bridge.storyGenerateFullDraft({ bookId });
    if (!drafted.ok) throw new Error('draft failed');
    expect(drafted.bundle.chapters.length).toBeGreaterThanOrEqual(1);

    // Rewrite from scratch → a fresh pre-draft bundle: no chapters, no outline, no essence, status outlining.
    const reset = await bridge.storyRewriteFromScratch({ bookId });
    expect(reset?.manifest.status).toBe('outlining');
    expect(reset?.manifest.essence).toBeUndefined();
    expect(reset?.manifest.config.style).toBe('cinematic'); // config kept
    expect(reset?.manifest.title).toBe('The Story of Ben'); // title kept
    expect(reset?.outline).toBeNull();
    expect(reset?.chapters).toEqual([]);
    // The book still lists (it was reset, not deleted) and re-drafts cleanly.
    expect((await bridge.storyList()).map((b) => b.id)).toEqual([bookId]);
    const redrafted = await bridge.storyGenerateFullDraft({ bookId });
    expect(redrafted.ok).toBe(true);
    if (redrafted.ok) expect(redrafted.bundle.chapters.length).toBeGreaterThanOrEqual(1);
  });

  it('story: create-and-draft writes the whole book in one flow (auto-approve, no gate) + streams progress (§3.2)', async () => {
    const { bridge, host } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-story' });
    await bridge.setSetting({ key: 'ai.enabled', value: true, scope: 'vault' });

    // Blank title → the biographer names it; no outline-review gate — it drafts straight through.
    const book = await bridge.storyCreate({
      type: 'biography',
      title: '',
      config: { voice: 'third', style: 'warm', length: 'full', autoRefresh: true },
    });
    const res = await bridge.storyGenerateFullDraft({ bookId: book!.id });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.bundle.outline?.approved).toBe(true); // auto-approved
    expect(res.bundle.chapters.length).toBeGreaterThanOrEqual(1);
    expect(res.bundle.chapters.every((c) => c.markdown.trim().length > 0)).toBe(true); // all drafted
    expect(res.bundle.manifest.status).toBe('ready');
    expect(res.bundle.manifest.title).toBe('The Weight of Quiet'); // named by the biographer

    // Progress streamed: a reading phase → per-chapter writing → a terminal done, total = chapter count.
    const phases = host.storyProgress.map((p) => p.phase);
    expect(phases[0]).toBe('reading');
    expect(phases).toContain('writing');
    expect(phases.at(-1)).toBe('done');
    const lastWriting = [...host.storyProgress].reverse().find((p) => p.phase === 'writing');
    expect(lastWriting?.chaptersTotal).toBe(res.bundle.chapters.length);
  });

  it('story: create-and-draft streams an error + fails honestly when AI is off (§3.2)', async () => {
    const { bridge, host } = await freshOwner();
    const book = await bridge.storyCreate({
      type: 'biography',
      title: 'X',
      config: { voice: 'third', style: 'warm', length: 'full', autoRefresh: true },
    });
    const res = await bridge.storyGenerateFullDraft({ bookId: book!.id });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('NO_KEY'); // no key set
    expect(host.storyProgress.some((p) => p.phase === 'error')).toBe(true);
  });

  it('story: a blank title lets the biographer name the book, then the person can rename it (§3.2)', async () => {
    const { bridge } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-story' });
    await bridge.setSetting({ key: 'ai.enabled', value: true, scope: 'vault' });

    // Blank title → a placeholder + `titleAuto` so the foundations pass may name it.
    const book = await bridge.storyCreate({
      type: 'biography',
      title: '',
      config: { voice: 'third', style: 'cinematic', length: 'full', autoRefresh: true },
    });
    expect(book?.title).toBe('Your Story');
    expect(book?.titleAuto).toBe(true);
    const bookId = book!.id;

    // Foundations proposes a title from the content → applied because the title was still auto.
    const gen = await bridge.storyGenerateFoundations({ bookId });
    expect(gen.ok).toBe(true);
    if (!gen.ok) return;
    expect(gen.bundle.manifest.title).toBe('The Weight of Quiet');

    // The person renames it on review → their title is now their own (auto cleared).
    const renamed = await bridge.storyUpdate({ bookId, title: 'A Machine and a Voice' });
    expect(renamed?.title).toBe('A Machine and a Voice');
    expect(renamed?.titleAuto ?? false).toBe(false);

    // "Start over" re-runs foundations → the person's chosen title is preserved, never re-proposed.
    const again = await bridge.storyGenerateFoundations({ bookId });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.bundle.manifest.title).toBe('A Machine and a Voice');
  });

  it('story: foundations returns an honest failure when AI is off / no key', async () => {
    const { bridge } = await freshOwner();
    const book = await bridge.storyCreate({
      type: 'biography',
      title: 'X',
      config: { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true },
    });
    const bookId = book!.id;

    // No key yet → NO_KEY.
    const noKey = await bridge.storyGenerateFoundations({ bookId });
    expect(noKey.ok).toBe(false);
    if (!noKey.ok) expect(noKey.reason).toBe('NO_KEY');

    // Key present but AI disabled → AI_OFF (points at Settings).
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-story' });
    await bridge.setSetting({ key: 'ai.enabled', value: false, scope: 'vault' });
    const aiOff = await bridge.storyGenerateFoundations({ bookId });
    expect(aiOff.ok).toBe(false);
    if (!aiOff.ok) expect(aiOff.reason).toBe('AI_OFF');
  });

  it('story: generate chapters → book ready → review a chapter', async () => {
    const { bridge } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-story' });
    await bridge.setSetting({ key: 'ai.enabled', value: true, scope: 'vault' });
    const book = await bridge.storyCreate({
      type: 'biography',
      title: 'The Story of Ben',
      config: { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true },
    });
    const bookId = book!.id;
    const gen = await bridge.storyGenerateFoundations({ bookId });
    expect(gen.ok).toBe(true);
    if (!gen.ok) return;
    await bridge.storyApproveOutline({ bookId, outline: gen.bundle.outline! });

    // Write the chapters (one, per the fake foundations outline).
    const chapters = await bridge.storyGenerateChapters({ bookId });
    expect(chapters.ok).toBe(true);
    if (!chapters.ok) return;
    expect(chapters.generated).toBe(1);
    const chapter = chapters.bundle.chapters[0]!;
    expect(chapter.markdown).toContain('cut pine'); // the generated prose
    expect(chapter.markdown).not.toContain('[[SRC'); // markers stripped
    expect(chapter.status).toBe('new');
    expect(chapters.bundle.manifest.status).toBe('ready'); // fully drafted

    // Re-run writes nothing (idempotent).
    const rerun = await bridge.storyGenerateChapters({ bookId });
    expect(rerun.ok && rerun.generated).toBe(0);

    // Mark it reviewed.
    const reviewed = await bridge.storyReviewChapter({ bookId, chapterId: chapter.id });
    expect(reviewed?.chapters[0]?.status).toBe('reviewed');
  });

  it('story: markup layer — mark, instant edit/pin, apply the batch revision', async () => {
    const { bridge } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-story' });
    await bridge.setSetting({ key: 'ai.enabled', value: true, scope: 'vault' });
    const book = await bridge.storyCreate({
      type: 'biography',
      title: 'The Story of Ben',
      config: { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true },
    });
    const bookId = book!.id;
    const gen = await bridge.storyGenerateFoundations({ bookId });
    if (!gen.ok) throw new Error('foundations failed');
    await bridge.storyApproveOutline({ bookId, outline: gen.bundle.outline! });
    const chapters = await bridge.storyGenerateChapters({ bookId });
    if (!chapters.ok) throw new Error('chapters failed');
    const chapterId = chapters.bundle.chapters[0]!.id;

    // Add a comment mark → it appears in the chapter's markup layer.
    const marked = await bridge.storyMark({
      bookId,
      chapterId,
      mark: {
        id: 'm1',
        kind: 'comment',
        anchor: { paragraphId: 'p0', quote: 'cut pine' },
        intent: 'addContext',
        text: 'the lathe was three generations old',
        status: 'open',
        createdAt: '2026-07-15',
      },
    });
    expect(marked.marks.map((m) => m.id)).toEqual(['m1']);
    expect((await bridge.storyGetMarkup({ bookId, chapterId })).marks).toHaveLength(1);

    // Instant inline edit → the chapter's prose changes and a protected block is recorded.
    const edited = await bridge.storyEditPassage({
      bookId,
      chapterId,
      anchor: { paragraphId: 'p0', quote: 'warm oil' },
      newText: 'cold steel',
    });
    const editedChapter = edited?.chapters.find((c) => c.id === chapterId);
    expect(editedChapter?.markdown).toContain('cold steel');
    expect(editedChapter?.protectedBlocks[0]?.text).toBe('cold steel');
    // An orphaned edit is refused (null), not misapplied.
    expect(
      await bridge.storyEditPassage({
        bookId,
        chapterId,
        anchor: { paragraphId: 'p0', quote: 'nonexistent span' },
        newText: 'x',
      }),
    ).toBeNull();

    // Apply the batch revision (the fake 'REVISING' branch) → fresh prose + the mark applied; protected words
    // survive.
    const applied = await bridge.storyApplyMarkup({ bookId, chapterId });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const revised = applied.bundle.chapters.find((c) => c.id === chapterId);
    expect(revised?.markdown).toContain('finally spoke'); // the revised line
    expect(revised?.markdown).toContain('cold steel'); // the protected inline edit was preserved (enforced)
    expect(revised?.status).toBe('updated');
    expect(applied.markup.marks[0]?.status).toBe('applied');
  });

  it('story: turn a to-do into questions — mints an Inbox self-send + records a questionsSent to-do', async () => {
    const { bridge } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-story' });
    await bridge.setSetting({ key: 'ai.enabled', value: true, scope: 'vault' });
    const book = await bridge.storyCreate({
      type: 'biography',
      title: 'The Story of Ben',
      config: { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true },
    });
    const bookId = book!.id;
    const gen = await bridge.storyGenerateFoundations({ bookId });
    if (!gen.ok) throw new Error('foundations failed');
    await bridge.storyApproveOutline({ bookId, outline: gen.bundle.outline! });
    const chapters = await bridge.storyGenerateChapters({ bookId });
    if (!chapters.ok) throw new Error('chapters failed');
    const chapterId = chapters.bundle.chapters[0]!.id;

    const res = await bridge.storyTodoToQuestions({
      bookId,
      chapterId,
      focus: 'the winter he got sick',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // A questionsSent to-do is recorded, carrying the assignment id.
    const todo = res.markup.marks.find((m) => m.kind === 'todo');
    expect(todo).toMatchObject({
      todoKind: 'questions',
      status: 'questionsSent',
      assignmentId: res.assignmentId,
    });
    // It lands in the person's own Inbox (a self-send).
    const inbox = await bridge.assignmentsInbox();
    expect(inbox.some((it) => it.assignmentId === res.assignmentId)).toBe(true);

    // AI off → an honest AI_OFF, nothing minted.
    await bridge.setSetting({ key: 'ai.enabled', value: false, scope: 'vault' });
    const off = await bridge.storyTodoToQuestions({ bookId, chapterId, focus: 'something else' });
    expect(off.ok).toBe(false);
    if (!off.ok) expect(off.reason).toBe('AI_OFF');
  });

  it('story: a to-do mark flows into the book-level roll-up and can be marked done', async () => {
    const { bridge } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-story' });
    await bridge.setSetting({ key: 'ai.enabled', value: true, scope: 'vault' });
    const book = await bridge.storyCreate({
      type: 'biography',
      title: 'The Story of Ben',
      config: { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true },
    });
    const bookId = book!.id;
    const gen = await bridge.storyGenerateFoundations({ bookId });
    if (!gen.ok) throw new Error('foundations failed');
    await bridge.storyApproveOutline({ bookId, outline: gen.bundle.outline! });
    const chapters = await bridge.storyGenerateChapters({ bookId });
    if (!chapters.ok) throw new Error('chapters failed');
    const chapterId = chapters.bundle.chapters[0]!.id;

    await bridge.storyMark({
      bookId,
      chapterId,
      mark: {
        id: 'r1',
        kind: 'todo',
        text: 'upload the shop photo',
        todoKind: 'remind',
        status: 'open',
        createdAt: '2026-07-16',
      },
    });
    // The denormalized roll-up shows it.
    let roll = await bridge.storyTodos({ bookId });
    expect(roll.todos).toEqual([
      expect.objectContaining({
        id: 'r1',
        kind: 'remind',
        text: 'upload the shop photo',
        status: 'open',
      }),
    ]);
    // Mark it done → the roll-up reflects the new status.
    await bridge.storyUpdateMark({ bookId, chapterId, markId: 'r1', patch: { status: 'done' } });
    roll = await bridge.storyTodos({ bookId });
    expect(roll.todos[0]?.status).toBe('done');
  });

  it('story: exclude marks a mentioning chapter stale (option 1), then un-exclude', async () => {
    const { bridge } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-story' });
    await bridge.setSetting({ key: 'ai.enabled', value: true, scope: 'vault' });
    const book = await bridge.storyCreate({
      type: 'biography',
      title: 'The Story of Ben',
      config: { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true },
    });
    const bookId = book!.id;
    const gen = await bridge.storyGenerateFoundations({ bookId });
    if (!gen.ok) throw new Error('foundations failed');
    await bridge.storyApproveOutline({ bookId, outline: gen.bundle.outline! });
    const chapters = await bridge.storyGenerateChapters({ bookId });
    if (!chapters.ok) throw new Error('chapters failed');
    const chapterId = chapters.bundle.chapters[0]!.id; // prose mentions "warm oil"

    const res = await bridge.storyExclude({ bookId, kind: 'topic', value: 'warm oil' });
    expect(res.staled).toBe(1);
    expect(res.exclusions[0]).toMatchObject({ kind: 'topic', value: 'warm oil' });
    expect(res.bundle.chapters.find((c) => c.id === chapterId)?.status).toBe('stale');
    expect((await bridge.storyExclusions({ bookId })).map((e) => e.value)).toEqual(['warm oil']);

    // Un-exclude removes the rule; the chapter stays as it is.
    expect(await bridge.storyUnexclude({ bookId, itemId: res.exclusions[0]!.id })).toEqual([]);
    expect(await bridge.storyExclusions({ bookId })).toEqual([]);
  });

  it('story: refreshCheck returns a fresh bundle and no-ops when nothing drifted', async () => {
    const { bridge } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-story' });
    await bridge.setSetting({ key: 'ai.enabled', value: true, scope: 'vault' });
    const book = await bridge.storyCreate({
      type: 'biography',
      title: 'The Story of Ben',
      config: { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true },
    });
    const bookId = book!.id;
    const gen = await bridge.storyGenerateFoundations({ bookId });
    if (!gen.ok) throw new Error('foundations failed');
    await bridge.storyApproveOutline({ bookId, outline: gen.bundle.outline! });
    await bridge.storyGenerateChapters({ bookId });

    // Nothing has changed since the chapter was written → nothing stales, nothing rewrites; fresh bundle back.
    const res = await bridge.storyRefreshCheck({ bookId, auto: false });
    expect(res.staled).toBe(0);
    expect(res.rewritten).toBe(0);
    expect(res.bundle).not.toBeNull();
  });

  it('story: the auto refresh cadence stamps a device-local daily throttle; a manual refresh does not', async () => {
    const { host, bridge, ownerId } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-story' });
    await bridge.setSetting({ key: 'ai.enabled', value: true, scope: 'vault' });
    const book = await bridge.storyCreate({
      type: 'biography',
      title: 'The Story of Ben',
      config: { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true },
    });
    const bookId = book!.id;
    const gen = await bridge.storyGenerateFoundations({ bookId });
    if (!gen.ok) throw new Error('foundations failed');
    await bridge.storyApproveOutline({ bookId, outline: gen.bundle.outline! });
    await bridge.storyGenerateChapters({ bookId });

    // Not stamped yet.
    expect(host.device().storyRefreshCheckedAt?.[ownerId]).toBeUndefined();
    // An auto refresh runs + stamps the per-person daily-throttle marker.
    await bridge.storyRefreshCheck({ bookId, auto: true });
    const stamp = host.device().storyRefreshCheckedAt?.[ownerId];
    expect(stamp).toBeTruthy();
    // A second auto refresh within the day is throttled (no-op) — the stamp is unchanged.
    await bridge.storyRefreshCheck({ bookId, auto: true });
    expect(host.device().storyRefreshCheckedAt?.[ownerId]).toBe(stamp);
    // A manual "Refresh now" never touches the throttle stamp.
    await bridge.storyRefreshCheck({ bookId, auto: false });
    expect(host.device().storyRefreshCheckedAt?.[ownerId]).toBe(stamp);
  });

  it('story: recurring crisis suppresses the AUTO rewrite (host-side, §8) but a manual refresh still rewrites', async () => {
    const { host, bridge, ownerId } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-story' });
    await bridge.setSetting({ key: 'ai.enabled', value: true, scope: 'vault' });
    const ctx = (await host.host.vaultAndKey())!;
    const book = await bridge.storyCreate({
      type: 'biography',
      title: 'The Story of Ben',
      config: { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true },
    });
    const bookId = book!.id;
    const gen = await bridge.storyGenerateFoundations({ bookId });
    if (!gen.ok) throw new Error('foundations failed');
    await bridge.storyApproveOutline({ bookId, outline: gen.bundle.outline! });
    const chapters = await bridge.storyGenerateChapters({ bookId });
    if (!chapters.ok) throw new Error('chapters failed');
    const chapterId = chapters.bundle.chapters[0]!.id;

    // Induce a stale chapter (a rewrite candidate) via an exclusion.
    const excluded = await bridge.storyExclude({ bookId, kind: 'topic', value: 'warm oil' });
    expect(excluded.bundle.chapters.find((c) => c.id === chapterId)?.status).toBe('stale');

    // Seed a recurring-crisis signal (≥2 approved crisis flags in 14 days) on the person's OWN insights.
    const seedCrisis = (id: string): Promise<void> =>
      saveInsight(ctx.fs, ctx.key, {
        id,
        schemaVersion: 1,
        source: 'session',
        subjectPersonId: ownerId,
        summary: `hard week ${id}`,
        facts: [],
        confidence: 'medium',
        categories: ['Emotions & patterns'],
        approved: true,
        crisisFlag: true,
        provenance: { conversationId: id, at: new Date().toISOString() },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    await seedCrisis('x1');
    await seedCrisis('x2');

    // The AUTO cadence must NOT spend during recurring distress — the stale chapter stays stale, nothing rewrites.
    const auto = await bridge.storyRefreshCheck({ bookId, auto: true });
    expect(auto.rewritten).toBe(0);
    expect(auto.bundle?.chapters.find((c) => c.id === chapterId)?.status).toBe('stale');

    // A manual "Refresh now" is user-initiated (crisis is not computed) — it rewrites the stale chapter.
    const manual = await bridge.storyRefreshCheck({ bookId, auto: false });
    expect(manual.rewritten).toBeGreaterThan(0);
    expect(manual.bundle?.chapters.find((c) => c.id === chapterId)?.status).not.toBe('stale');
  });

  it('story: structural proposals — list pending, approve (restructures the outline), dismiss', async () => {
    const { host, bridge, ownerId } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-story' });
    await bridge.setSetting({ key: 'ai.enabled', value: true, scope: 'vault' });
    const ctx = (await host.host.vaultAndKey())!;
    const book = await bridge.storyCreate({
      type: 'biography',
      title: 'The Story of Ben',
      config: { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true },
    });
    const bookId = book!.id;
    const gen = await bridge.storyGenerateFoundations({ bookId });
    if (!gen.ok) throw new Error('foundations failed');
    await bridge.storyApproveOutline({ bookId, outline: gen.bundle.outline! });
    await bridge.storyGenerateChapters({ bookId });
    const before = await bridge.storyGet({ bookId });
    const partId = before!.outline!.parts[0]!.id;
    const chapterId = before!.outline!.parts[0]!.chapters[0]!.id;

    // Seed two pending proposals directly (a generation pass mints these; here we control the ids).
    await saveProposals(ctx.fs, ctx.key, ownerId, bookId, {
      schemaVersion: 1,
      proposals: [
        {
          id: 'pr-new',
          kind: 'newChapter',
          rationale: 'A new era emerged.',
          createdAt: '2026-07-16T00:00:00.000Z',
          status: 'pending',
          partId,
          title: 'The Middle Years',
          brief: 'Settling in.',
          lifeAreas: [],
        },
        {
          id: 'pr-prologue',
          kind: 'prologueRewrite',
          rationale: 'The opening no longer fits.',
          createdAt: '2026-07-16T00:00:00.000Z',
          status: 'pending',
          chapterId,
        },
      ],
    });

    // The panel lists both pending proposals.
    expect((await bridge.storyProposals({ bookId })).map((p) => p.id).sort()).toEqual([
      'pr-new',
      'pr-prologue',
    ]);

    // Approve the new-chapter proposal → it restructures the outline (a new un-written chapter appears).
    const approved = await bridge.storyResolveProposal({
      bookId,
      proposalId: 'pr-new',
      action: 'approve',
    });
    expect(approved.ok).toBe(true);
    expect(approved.proposals.map((p) => p.id)).toEqual(['pr-prologue']); // only the other stays pending
    const titles = approved.bundle!.outline!.parts.flatMap((p) => p.chapters.map((c) => c.title));
    expect(titles).toContain('The Middle Years');
    // The new chapter is un-written (stale) — drafted on the next refresh, not now.
    const shell = approved.bundle!.chapters.find((c) => c.title === 'The Middle Years');
    expect(shell?.status).toBe('stale');
    expect(shell?.markdown).toBe('');

    // Dismiss the other → it leaves the pending list (kept stored for dedup, not shown).
    const dismissed = await bridge.storyResolveProposal({
      bookId,
      proposalId: 'pr-prologue',
      action: 'dismiss',
    });
    expect(dismissed.ok).toBe(true);
    expect(await bridge.storyProposals({ bookId })).toEqual([]);
  });

  it('story: the Home signal reports the book’s living state; false for no book or a Guest', async () => {
    const { host, bridge, ownerId } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-story' });
    await bridge.setSetting({ key: 'ai.enabled', value: true, scope: 'vault' });
    const ctx = (await host.host.vaultAndKey())!;

    // No book yet → hasBook:false (starting one is the nav's job, not a Home push).
    expect(await bridge.storyHomeSignal()).toMatchObject({ hasBook: false });

    const book = await bridge.storyCreate({
      type: 'biography',
      title: 'The Story of Ben',
      config: { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true },
    });
    const bookId = book!.id;
    const gen = await bridge.storyGenerateFoundations({ bookId });
    if (!gen.ok) throw new Error('foundations failed');
    await bridge.storyApproveOutline({ bookId, outline: gen.bundle.outline! });
    // Chapters aren't written → they're all unwritten. Seed one pending proposal.
    const before = await bridge.storyGet({ bookId });
    const firstChapterId = before!.outline!.parts[0]!.chapters[0]!.id;
    await saveProposals(ctx.fs, ctx.key, ownerId, bookId, {
      schemaVersion: 1,
      proposals: [
        {
          id: 'pr1',
          kind: 'prologueRewrite',
          rationale: 'x',
          createdAt: '2026-07-16T00:00:00.000Z',
          status: 'pending',
          chapterId: firstChapterId,
        },
      ],
    });

    const sig = await bridge.storyHomeSignal();
    expect(sig.hasBook).toBe(true);
    expect(sig.unwrittenChapters).toBeGreaterThan(0);
    expect(sig.pendingProposals).toBe(1);
    expect(sig.staleChapters).toBe(0); // nothing written yet, so nothing has drifted

    // A Guest (no story.own) gets the empty signal — never another member's book state.
    const guest = await bridge.peopleSave({ displayName: 'Guest', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: guest.id, roleId: 'guest', pin: null });
    await bridge.sessionSetActive({ personId: guest.id });
    expect(await bridge.storyHomeSignal()).toMatchObject({ hasBook: false });
  });

  it('story: the interview cadence gap-passes + mints ≤1 check-in; completeness reflects it; Guest denied', async () => {
    const { bridge } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-story' });
    await bridge.setSetting({ key: 'ai.enabled', value: true, scope: 'vault' });
    const book = await bridge.storyCreate({
      type: 'biography',
      title: 'The Story of Ben',
      config: { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true },
    });
    const bookId = book!.id;
    const gen = await bridge.storyGenerateFoundations({ bookId });
    if (!gen.ok) throw new Error('foundations failed');
    await bridge.storyApproveOutline({ bookId, outline: gen.bundle.outline! });
    await bridge.storyGenerateChapters({ bookId });

    // Empty completeness before any gap pass.
    expect(await bridge.storyCompleteness({ bookId })).toMatchObject({
      stage: 'beginning',
      covered: 0,
    });

    // A manual interview check runs the gap pass + mints one check-in into the Inbox.
    const first = await bridge.storyInterviewCheck({ bookId });
    expect(first.outcome).toBe('minted');
    expect(first.assignmentId).toBeTruthy();
    // The gap pass persisted coverage → completeness climbed (chapters + highPoint = 2/12).
    expect(await bridge.storyCompleteness({ bookId })).toMatchObject({
      covered: 2,
      stage: 'beginning',
    });
    // The minted check-in is a self-send in the owner's Inbox.
    const inbox = await bridge.assignmentsInbox();
    expect(inbox.some((i) => i.assignmentId === first.assignmentId && i.fromSelf)).toBe(true);
    // A second check while it's open → nothing minted (≤1).
    expect((await bridge.storyInterviewCheck({ bookId })).outcome).toBe('openCheckin');

    // A Guest (no story.own) is denied both reads.
    const guest = await bridge.peopleSave({ displayName: 'Guest', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: guest.id, roleId: 'guest', pin: null });
    await bridge.sessionSetActive({ personId: guest.id });
    expect(await bridge.storyCompleteness({ bookId })).toMatchObject({
      stage: 'beginning',
      covered: 0,
    });
    expect((await bridge.storyInterviewCheck({ bookId })).outcome).toBe('noBook');
  });

  it('story: markup + refresh ops are denied for a person without story.own', async () => {
    const { bridge } = await freshOwner();
    // A Guest role has no story.own.
    const guest = await bridge.peopleSave({ displayName: 'Guest', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: guest.id, roleId: 'guest', pin: null });
    await bridge.sessionSetActive({ personId: guest.id });

    // Reads degrade to empty; there's no book to target, but the gate is what we're asserting.
    expect((await bridge.storyGetMarkup({ bookId: 'x', chapterId: 'c' })).marks).toEqual([]);
    expect((await bridge.storyTodos({ bookId: 'x' })).todos).toEqual([]);
    expect(await bridge.storyProposals({ bookId: 'x' })).toEqual([]);
    const applied = await bridge.storyApplyMarkup({ bookId: 'x', chapterId: 'c' });
    expect(applied.ok).toBe(false);
    const resolved = await bridge.storyResolveProposal({
      bookId: 'x',
      proposalId: 'p',
      action: 'approve',
    });
    expect(resolved.ok).toBe(false);
    const refreshed = await bridge.storyRefreshCheck({ bookId: 'x' });
    expect(refreshed).toEqual({ staled: 0, rewritten: 0, bundle: null });
    expect(await bridge.storyRewriteFromScratch({ bookId: 'x' })).toBeNull();
  });

  it('story: publish → grant → a reader reads the published head; revoke re-gates at the next read (§3.5)', async () => {
    const { bridge, ownerId } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-story' });
    await bridge.setSetting({ key: 'ai.enabled', value: true, scope: 'vault' });
    // A second household person who will be the reader.
    const reader = await bridge.peopleSave({ displayName: 'Angel', isSubject: true, tags: [] });
    await bridge.accessSetAccount({ personId: reader.id, roleId: 'member', pin: null });

    const book = await bridge.storyCreate({
      type: 'biography',
      title: 'The Story of Ben',
      config: { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true },
    });
    const bookId = book!.id;
    const gen = await bridge.storyGenerateFoundations({ bookId });
    if (!gen.ok) throw new Error('foundations failed');
    await bridge.storyApproveOutline({ bookId, outline: gen.bundle.outline! });
    const chapters = await bridge.storyGenerateChapters({ bookId });
    if (!chapters.ok) throw new Error('chapters failed');
    const chapterId = chapters.bundle.chapters[0]!.id;

    // Can't publish until a chapter is Reviewed (the gate).
    expect((await bridge.storyPublish({ bookId })).ok).toBe(false);
    await bridge.storyReviewChapter({ bookId, chapterId });
    expect(await bridge.storyPublish({ bookId })).toMatchObject({ ok: true, publishedChapters: 1 });

    // Grant the reader (the picker's featured-note read works too — the prose mentions "warm oil", not "Angel").
    expect(await bridge.storyReaderFeatured({ bookId, readerPersonId: reader.id })).toBe(false);
    expect(await bridge.storyGrantReader({ bookId, readerPersonId: reader.id })).toEqual([
      { personId: reader.id, displayName: 'Angel' },
    ]);

    // Switch to the reader → the book appears in "Shared with you" + reads the published head.
    await bridge.sessionSetActive({ personId: reader.id });
    const shared = await bridge.storySharedBooks();
    expect(shared).toHaveLength(1);
    expect(shared[0]).toMatchObject({
      authorName: 'Ben',
      title: 'The Story of Ben',
      chapterCount: 1,
      neverOpened: true, // never opened yet → drives the one-time "shared with you" notification
      updated: true,
    });
    const view = await bridge.storyReadShared({ authorPersonId: ownerId, bookId });
    expect(view?.chapters.map((c) => c.id)).toEqual([chapterId]);
    expect(view?.manifest.noteOnBook).toContain('never invented');

    // Recording the open clears the read-progress cues (device-local, per-person) — the notification stops
    // and the "Updated" marker goes quiet until the author republishes (§3.6).
    await bridge.storyMarkSharedRead({ authorPersonId: ownerId, bookId });
    expect((await bridge.storySharedBooks())[0]).toMatchObject({
      neverOpened: false,
      updated: false,
    });

    // Author revokes → the reader loses access at the next read (no stale access).
    await bridge.sessionSetActive({ personId: ownerId, pin: '1234' });
    await bridge.storyRevokeReader({ bookId, readerPersonId: reader.id });
    await bridge.sessionSetActive({ personId: reader.id });
    expect(await bridge.storySharedBooks()).toEqual([]);
    expect(await bridge.storyReadShared({ authorPersonId: ownerId, bookId })).toBeNull();
  });

  it('story: exports the published book as a Markdown file outside the vault (§3.9)', async () => {
    const { bridge, host } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-story' });
    await bridge.setSetting({ key: 'ai.enabled', value: true, scope: 'vault' });
    const saved: { name: string; bytes: Uint8Array }[] = [];
    host.host.saveImageFile = (name, bytes) => {
      saved.push({ name, bytes });
      return Promise.resolve(`/exports/${name}`);
    };
    const book = await bridge.storyCreate({
      type: 'biography',
      title: 'The Story of Ben',
      config: { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true },
    });
    const bookId = book!.id;
    const gen = await bridge.storyGenerateFoundations({ bookId });
    if (!gen.ok) throw new Error('foundations failed');
    await bridge.storyApproveOutline({ bookId, outline: gen.bundle.outline! });
    const chapters = await bridge.storyGenerateChapters({ bookId });
    if (!chapters.ok) throw new Error('chapters failed');

    // Not published yet → nothing to export.
    expect(await bridge.storyExportMarkdown({ bookId })).toBeNull();
    expect(saved).toHaveLength(0);

    await bridge.storyReviewChapter({ bookId, chapterId: chapters.bundle.chapters[0]!.id });
    await bridge.storyPublish({ bookId });
    const path = await bridge.storyExportMarkdown({ bookId });
    expect(path).toBe('/exports/The-Story-of-Ben.md');
    const md = new TextDecoder().decode(saved[0]!.bytes);
    expect(md).toContain('# The Story of Ben');
    expect(md).toContain('### '); // the published chapter heading
  });

  it('story: exports the published book as a PDF file outside the vault (§3.9)', async () => {
    const { bridge, host } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-story' });
    await bridge.setSetting({ key: 'ai.enabled', value: true, scope: 'vault' });
    const saved: { name: string; bytes: Uint8Array; mime?: string }[] = [];
    host.host.saveImageFile = (name, bytes, mime) => {
      saved.push({ name, bytes, mime });
      return Promise.resolve(`/exports/${name}`);
    };
    const book = await bridge.storyCreate({
      type: 'biography',
      title: 'The Story of Ben',
      config: { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true },
    });
    const bookId = book!.id;
    const gen = await bridge.storyGenerateFoundations({ bookId });
    if (!gen.ok) throw new Error('foundations failed');
    await bridge.storyApproveOutline({ bookId, outline: gen.bundle.outline! });
    const chapters = await bridge.storyGenerateChapters({ bookId });
    if (!chapters.ok) throw new Error('chapters failed');

    // Not published yet → nothing to export.
    expect(await bridge.storyExportPdf({ bookId })).toBeNull();
    expect(saved).toHaveLength(0);

    await bridge.storyReviewChapter({ bookId, chapterId: chapters.bundle.chapters[0]!.id });
    await bridge.storyPublish({ bookId });
    const path = await bridge.storyExportPdf({ bookId });
    expect(path).toBe('/exports/The-Story-of-Ben.pdf');
    expect(saved[0]!.mime).toBe('application/pdf');
    // The test host's fake printToPdf echoes the rendered HTML length, so a non-trivial doc means we rendered.
    expect(new TextDecoder().decode(saved[0]!.bytes)).toContain('%PDF-fake');
  });

  it('story: generates a cover behind the shared image consent + key, encrypted, then serves it (§3.8)', async () => {
    const { bridge, host } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-story' });
    await bridge.setSetting({ key: 'ai.enabled', value: true, scope: 'vault' });
    const book = await bridge.storyCreate({
      type: 'biography',
      title: 'The Story of Ben',
      config: { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true },
    });
    const bookId = book!.id;
    const gen = await bridge.storyGenerateFoundations({ bookId });
    if (!gen.ok) throw new Error('foundations failed');
    await bridge.storyApproveOutline({ bookId, outline: gen.bundle.outline! });
    const chapters = await bridge.storyGenerateChapters({ bookId });
    if (!chapters.ok) throw new Error('chapters failed');

    // Consent off → refused, nothing created.
    const off = await bridge.storyGenerateImage({ bookId, target: { kind: 'cover' } });
    expect(off.ok === false && off.reason).toBe('NO_CONSENT');
    expect(await bridge.storyImages({ bookId })).toEqual([]);

    // Turn on the ONE shared image consent + the OpenAI key → a cover generates + is indexed + served.
    await bridge.setSetting({ key: 'dreams.imageGenerationEnabled', value: true, scope: 'vault' });
    await bridge.secretSet({ id: OPENAI_API_KEY_ID, value: 'sk-openai' });
    host.imageProgress.length = 0; // ignore the consent-off call's terminal event
    const made = await bridge.storyGenerateImage({ bookId, target: { kind: 'cover' } });
    expect(made.ok).toBe(true);
    if (!made.ok) throw new Error('generate failed');
    expect(made.image.kind).toBe('cover');
    // The owner is an admin → the cost figure is present.
    expect(typeof made.costUsd).toBe('number');

    // Realtime progress (CLAUDE.md §12): the generation streamed compose → render phase events for this
    // surface's id, so the renderer shows live status instead of a bare spinner.
    const coverPhases = host.imageProgress.filter((p) => p.id === `story:${bookId}:cover`);
    expect(coverPhases.map((p) => p.phase)).toEqual(['composing', 'rendering', 'done']);

    const index = await bridge.storyImages({ bookId });
    expect(index.map((i) => i.id)).toEqual([made.image.id]);
    // The book's manifest now points at the cover.
    expect((await bridge.storyGet({ bookId }))?.manifest.coverImageId).toBe(made.image.id);
    // The bytes are served base64 (decrypted host-side); the pixels never travel through the generate result.
    const served = await bridge.storyGetImage({ bookId, imageId: made.image.id });
    expect(served?.mime).toBe('image/png');
    expect(served?.dataBase64.length).toBeGreaterThan(0);

    // Delete clears the cover pointer + the index.
    await bridge.storyDeleteImage({ bookId, imageId: made.image.id });
    expect(await bridge.storyImages({ bookId })).toEqual([]);
    expect((await bridge.storyGet({ bookId }))?.manifest.coverImageId).toBeUndefined();
  });

  it('story: uploads a photo (encrypted), captions + asks via vision, and persists the answer (§3.7)', async () => {
    const { bridge, host } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-story' });
    await bridge.setSetting({ key: 'ai.enabled', value: true, scope: 'vault' });
    const book = await bridge.storyCreate({
      type: 'biography',
      title: 'The Story of Ben',
      config: { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true },
    });
    const bookId = book!.id;

    // Upload a tiny PNG (base64) → indexed `uploaded`, decrypts back.
    const dataBase64 = Buffer.from([137, 80, 78, 71, 1, 2, 3]).toString('base64');
    const entry = await bridge.storyUploadPhoto({ bookId, mime: 'image/png', dataBase64 });
    expect(entry?.kind).toBe('uploaded');
    const images = await bridge.storyImages({ bookId });
    expect(images.map((i) => i.id)).toEqual([entry!.id]);
    const served = await bridge.storyGetImage({ bookId, imageId: entry!.id });
    expect(served?.mime).toBe('image/png');

    // Vision analysis → caption stamped + questions returned.
    host.host.claude = {
      send: () => Promise.resolve(''),
      stream: () =>
        Promise.resolve({
          text: '{"caption":"A garage in winter","questions":["Who took this?","What were you building?"]}',
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
        }),
    };
    const analysis = await bridge.storyAnalyzePhoto({ bookId, imageId: entry!.id });
    expect(analysis.ok).toBe(true);
    if (!analysis.ok) throw new Error('analyze failed');
    expect(analysis.analysis.caption).toBe('A garage in winter');
    expect(analysis.analysis.questions).toHaveLength(2);
    expect((await bridge.storyImages({ bookId }))[0]?.caption).toBe('A garage in winter');

    // Answer a question → it persists to the interview corpus.
    await bridge.storyAnswerPhoto({
      bookId,
      imageId: entry!.id,
      question: 'Who took this?',
      answer: 'My father did.',
    });
    const answers = await bridge.storyPhotoAnswers({ bookId });
    expect(answers).toEqual([
      expect.objectContaining({
        imageId: entry!.id,
        question: 'Who took this?',
        answer: 'My father did.',
      }),
    ]);

    // A crafted non-image mime is rejected at the trust boundary.
    expect(await bridge.storyUploadPhoto({ bookId, mime: 'text/plain', dataBase64 })).toBeNull();
  });

  it('story: places an uploaded photo in a chapter via the AI-suggested anchor, then moves + removes it (§3.8)', async () => {
    const { bridge, host } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-story' });
    await bridge.setSetting({ key: 'ai.enabled', value: true, scope: 'vault' });
    const book = await bridge.storyCreate({
      type: 'biography',
      title: 'The Story of Ben',
      config: { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true },
    });
    const bookId = book!.id;
    const gen = await bridge.storyGenerateFoundations({ bookId });
    if (!gen.ok) throw new Error('foundations failed');
    await bridge.storyApproveOutline({ bookId, outline: gen.bundle.outline! });
    const chapters = await bridge.storyGenerateChapters({ bookId });
    if (!chapters.ok) throw new Error('chapters failed');
    const chapterId = chapters.bundle.chapters[0]!.id;

    const dataBase64 = Buffer.from([137, 80, 78, 71, 9]).toString('base64');
    const photo = await bridge.storyUploadPhoto({ bookId, mime: 'image/png', dataBase64 });

    // The AI suggests a paragraph anchor.
    host.host.claude = {
      send: () => Promise.resolve(''),
      stream: () =>
        Promise.resolve({
          text: '0',
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
        }),
    };
    const suggested = await bridge.storySuggestPlacement({ bookId, chapterId, imageId: photo!.id });
    expect(suggested.ok).toBe(true);
    if (!suggested.ok) throw new Error('suggest failed');

    // Place it, then confirm it's on the chapter.
    let bundle = await bridge.storySetPlacement({
      bookId,
      chapterId,
      imageId: photo!.id,
      afterAnchor: suggested.afterAnchor,
      caption: 'The garage',
    });
    let chapter = bundle?.chapters.find((c) => c.id === chapterId);
    expect(chapter?.imagePlacements).toEqual([
      { imageId: photo!.id, afterAnchor: suggested.afterAnchor, caption: 'The garage' },
    ]);

    // Move it (same image → deduped, not doubled).
    bundle = await bridge.storySetPlacement({
      bookId,
      chapterId,
      imageId: photo!.id,
      afterAnchor: 'p0',
    });
    chapter = bundle?.chapters.find((c) => c.id === chapterId);
    expect(chapter?.imagePlacements).toHaveLength(1);
    expect(chapter?.imagePlacements[0]?.afterAnchor).toBe('p0');

    // Remove it.
    bundle = await bridge.storyRemovePlacement({ bookId, chapterId, imageId: photo!.id });
    chapter = bundle?.chapters.find((c) => c.id === chapterId);
    expect(chapter?.imagePlacements).toEqual([]);
  });

  it('story: a published book embeds its cover as an inline data URI in the Markdown export (§3.8)', async () => {
    const { bridge, host } = await freshOwner();
    await bridge.secretSet({ id: ANTHROPIC_API_KEY_ID, value: 'sk-story' });
    await bridge.secretSet({ id: OPENAI_API_KEY_ID, value: 'sk-openai' });
    await bridge.setSetting({ key: 'ai.enabled', value: true, scope: 'vault' });
    await bridge.setSetting({ key: 'dreams.imageGenerationEnabled', value: true, scope: 'vault' });
    const saved: { name: string; bytes: Uint8Array }[] = [];
    host.host.saveImageFile = (name, bytes) => {
      saved.push({ name, bytes });
      return Promise.resolve(`/exports/${name}`);
    };
    const book = await bridge.storyCreate({
      type: 'biography',
      title: 'The Story of Ben',
      config: { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true },
    });
    const bookId = book!.id;
    const gen = await bridge.storyGenerateFoundations({ bookId });
    if (!gen.ok) throw new Error('foundations failed');
    await bridge.storyApproveOutline({ bookId, outline: gen.bundle.outline! });
    const chapters = await bridge.storyGenerateChapters({ bookId });
    if (!chapters.ok) throw new Error('chapters failed');
    await bridge.storyReviewChapter({ bookId, chapterId: chapters.bundle.chapters[0]!.id });

    // Make a cover (the test host's fake image client returns a tiny PNG), then publish + export.
    const cover = await bridge.storyGenerateImage({ bookId, target: { kind: 'cover' } });
    if (!cover.ok) throw new Error('cover failed');
    await bridge.storyPublish({ bookId });
    await bridge.storyExportMarkdown({ bookId });
    const md = new TextDecoder().decode(saved.at(-1)!.bytes);
    expect(md).toContain('![Cover](data:image/png;base64,'); // the frozen cover is embedded inline
  });
});

import type {
  ClaudeClient,
  ClaudeStreamResult,
  ImageClient,
  ImageGenerateOutcome,
} from '@selfos/core/host';
import type { SecretStore } from '@selfos/core/host';
import { fromBase64 } from '@selfos/core/encoding';
import { DeviceStateSchema, type DeviceState, type DeviceStatePatch } from '@shared/schemas';

/**
 * Device-local stores for the **web preview** of the iOS app (07-mobile-platform §5.3, slice iii-b2),
 * backed by `localStorage` and namespaced by a simulated `?device=` id. The IndexedDB vault is shared
 * across devices; the secret store (master key + API key) and device state/settings are per-device — so
 * two browser tabs (`?device=A`, `?device=B`) behave like two devices sharing one iCloud vault, which is
 * what lets the preview exercise the invite redeem / second-device-unlock flows.
 *
 * Temporary scaffolding: on real iOS the SecretStore is the Keychain (iii-c) and device state is
 * Capacitor Preferences; here both are `localStorage` so the preview persists across reloads.
 */
const DEFAULT_DEVICE = 'A';
const DEFAULT_STATE: DeviceState = { schemaVersion: 1, vaultPath: null };

/** Which simulated device this tab is (`?device=…`), defaulting to `A`. */
export function currentDeviceId(search: string = globalThis.location?.search ?? ''): string {
  return new URLSearchParams(search).get('device') ?? DEFAULT_DEVICE;
}

function namespaced(device: string, suffix: string): string {
  return `selfos:${device}:${suffix}`;
}

/** A `localStorage`-backed `SecretStore` (master key, API key), per simulated device. */
export function webSecretStore(device: string): SecretStore {
  const keyFor = (id: string): string => namespaced(device, `secret:${id}`);
  return {
    get: (id) => Promise.resolve(localStorage.getItem(keyFor(id))),
    set: (id, value) => {
      localStorage.setItem(keyFor(id), value);
      return Promise.resolve();
    },
    has: (id) => Promise.resolve(localStorage.getItem(keyFor(id)) !== null),
    clear: (id) => {
      localStorage.removeItem(keyFor(id));
      return Promise.resolve();
    },
  };
}

/**
 * Remove legacy secret copies from WKWebView `localStorage` (07-mobile-platform §5.3, post-iii-c1). Before
 * the Keychain landed, iOS kept the master key + API key in `localStorage` (`webSecretStore`); they now
 * live in the iOS Keychain, so any `selfos:*:secret:*` entry here is an orphaned copy in lower-protection
 * storage — scrub it. **iOS-only**: never call this in the web preview, where `localStorage` IS the secret
 * store. (Device-state/settings entries are left alone — they're not secrets.)
 */
export function scrubLegacyLocalStorageSecrets(): void {
  const legacy: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && /^selfos:[^:]*:secret:/.test(key)) legacy.push(key);
  }
  for (const key of legacy) localStorage.removeItem(key);
}

export interface WebDeviceStore {
  read(): Promise<DeviceState>;
  update(patch: DeviceStatePatch): Promise<DeviceState>;
}

/** A `localStorage`-backed device-state store (active person, vault bookmark, pending join), per device. */
export function webDeviceStore(device: string): WebDeviceStore {
  const key = namespaced(device, 'deviceState');
  const read = (): Promise<DeviceState> => {
    const raw = localStorage.getItem(key);
    if (!raw) return Promise.resolve({ ...DEFAULT_STATE });
    try {
      return Promise.resolve(DeviceStateSchema.parse(JSON.parse(raw)));
    } catch {
      return Promise.resolve({ ...DEFAULT_STATE });
    }
  };
  return {
    read,
    async update(patch) {
      const next = DeviceStateSchema.parse({ ...(await read()), ...patch });
      localStorage.setItem(key, JSON.stringify(next));
      return next;
    },
  };
}

export interface WebDeviceSettings {
  read(): Promise<Record<string, unknown>>;
  write(values: Record<string, unknown>): Promise<void>;
}

/** A `localStorage`-backed device-scoped settings map, per device. */
export function webDeviceSettings(device: string): WebDeviceSettings {
  const key = namespaced(device, 'deviceSettings');
  return {
    read: () => {
      const raw = localStorage.getItem(key);
      if (!raw) return Promise.resolve({});
      try {
        const parsed: unknown = JSON.parse(raw);
        return Promise.resolve(
          typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {},
        );
      } catch {
        return Promise.resolve({});
      }
    },
    write: (values) => {
      localStorage.setItem(key, JSON.stringify(values));
      return Promise.resolve();
    },
  };
}

/**
 * A deterministic, offline `ClaudeClient` for the preview — streams a canned reply so the full Sessions
 * surface (streaming, usage, budgets) is exercisable. Real Claude (the browser-mode Anthropic SDK) lands
 * in iii-c; the API key still flows through the host, never the renderer state.
 */
export function webFakeClaudeClient(): ClaudeClient {
  const reply = 'I hear you. What feels most important about that right now?';
  return {
    send: () => Promise.resolve('ok'),
    stream: (options, onDelta): Promise<ClaudeStreamResult> => {
      const userText = options.messages.map((message) => message.content).join('\n');
      // Compatibility variant personalization (08 §3.6/§17.12/§17.14e) asks for a JSON array of objects
      // { prompt, options } — echo each prompt tagged with the OTHER participant + preserve the options, so
      // the preview exercises the full compatibility send (matching the Electron offline fake).
      if (userText.includes('answer about THEIR experience with')) {
        const about = /experience with (.+?):/.exec(userText)?.[1] ?? 'them';
        const prompts = [...userText.matchAll(/^\d+\.\s*PROMPT:\s*(.+)$/gm)].map((m) => m[1]);
        const optionLines = [...userText.matchAll(/^\s*OPTIONS:\s*(.+)$/gm)].map((m) => m[1]);
        const objs = prompts.map((p, i) => {
          let options: string[] | null = null;
          const ol = optionLines[i];
          if (ol && ol.trim() !== 'none') {
            try {
              options = JSON.parse(ol) as string[];
            } catch {
              options = null;
            }
          }
          return { prompt: `${p} — about ${about}`, options };
        });
        return Promise.resolve({
          text: JSON.stringify(objs),
          usage: { inputTokens: 80, outputTokens: 40, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      }
      // Compatibility alignment (08 §13.5d) asks for a report JSON object.
      if (userText.includes('compatibility report JSON')) {
        return Promise.resolve({
          text: JSON.stringify({
            summary: 'You two are largely aligned, with a few differences worth talking through.',
            items: [],
            crisisFlag: false,
            facts: [{ text: 'They share core values but differ on pace.', shareable: true }],
          }),
          usage: { inputTokens: 150, outputTokens: 60, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      }
      // The session-analysis turn (09 §5) asks to "summarize this session" — return a valid
      // SessionAnalysisDraft so the preview renders a real wrap-up card with facts + mood.
      if (userText.includes('summarize this session')) {
        return Promise.resolve({
          text: JSON.stringify({
            summary: 'A reflective check-in about a hard day, ending on a calmer note.',
            themes: ['stress at work'],
            goals: ['Take a short walk before bed'],
            followUps: ['See how the week settles'],
            people: [],
            moodValence: -0.2,
            moodEnergy: 0.1,
            crisisFlag: false,
          }),
          usage: { inputTokens: 180, outputTokens: 70, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      }
      // The dream-analysis synthesis turn asks for a single JSON object (12-dreams §3.2) — return a
      // valid DreamAnalysis draft so the preview can render the full synthesis card; every other turn
      // streams the canned reflective reply.
      if (options.messages.some((message) => message.content.includes('JSON object'))) {
        const draft = JSON.stringify({
          summary: 'A dream of shifting rooms and open skies.',
          emotionalLandscape: 'A mix of unease and quiet wonder.',
          wakingLifeConnections: 'Perhaps something at home feels like it is changing.',
          notableImages:
            'The rearranging house, offered as imaginative reflection rather than fact.',
          reflectiveQuestions: ['What in your life feels like it is rearranging right now?'],
          coachingPrompt: 'Notice one thing that felt steady today.',
          tags: {
            emotions: ['unease', 'wonder'],
            symbols: ['house'],
            settings: ['childhood home'],
            themes: ['change'],
            people: [],
          },
          metrics: { emotionalIntensity: 0.5, valence: 0 },
          crisisFlag: false,
          distressSignal: false,
        });
        return Promise.resolve({
          text: draft,
          usage: { inputTokens: 200, outputTokens: 90, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      }
      for (const word of reply.split(' ')) onDelta(`${word} `);
      return Promise.resolve({
        text: reply,
        usage: { inputTokens: 120, outputTokens: 18, cacheWriteTokens: 0, cacheReadTokens: 0 },
      });
    },
  };
}

// A 1×1 transparent PNG — the smallest valid image, so the web preview never touches the network.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** Deterministic offline image client for the web preview (mirrors the Electron `fakeImageClient`). */
export function webFakeImageClient(): ImageClient {
  return {
    verify: (): Promise<void> => Promise.resolve(),
    generate: (): Promise<ImageGenerateOutcome> =>
      Promise.resolve({
        ok: true,
        image: { bytes: fromBase64(TINY_PNG_BASE64), mime: 'image/png' },
      }),
  };
}

import type { ClaudeClient, ClaudeStreamResult, SecretStore } from '@selfos/core/host';
import { DeviceStateSchema, type DeviceState } from '@shared/schemas';

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

export interface WebDeviceStore {
  read(): Promise<DeviceState>;
  update(patch: Partial<DeviceState>): Promise<DeviceState>;
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
    stream: (_options, onDelta): Promise<ClaudeStreamResult> => {
      for (const word of reply.split(' ')) onDelta(`${word} `);
      return Promise.resolve({
        text: reply,
        usage: { inputTokens: 120, outputTokens: 18, cacheWriteTokens: 0, cacheReadTokens: 0 },
      });
    },
  };
}

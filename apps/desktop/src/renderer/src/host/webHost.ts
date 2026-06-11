import type { BootState } from '@shared/schemas';
import type { FileSystem } from '@selfos/core/host';
import { loadMasterKey } from '@selfos/core/crypto';
import { uuid } from '@selfos/core/id';
import { createCoreBridge, readVaultSettingsValues, type BridgeHost } from '@shared/coreBridge';
import { idbFileSystem } from './idbFileSystem';
import {
  currentDeviceId,
  webDeviceSettings,
  webDeviceStore,
  webFakeClaudeClient,
  webSecretStore,
} from './webStores';

/**
 * The **in-webview `BridgeHost`** for the iOS app's web preview (07-mobile-platform §5.3, slice iii-b2).
 * It wires the same platform primitives the shared `createCoreBridge` factory needs — but to browser
 * APIs instead of Electron: the vault is an IndexedDB `FileSystem`, secrets + device state live in
 * `localStorage` (per simulated `?device=`), and Claude is a deterministic offline fake. So the *real*
 * `@selfos/core` business logic runs in a browser, exactly as it will inside the iOS WKWebView, before
 * the native Swift `VaultFs` (iii-b3) / Keychain + real Claude (iii-c) hosts replace these stubs.
 */
const DEFAULT_MODEL = 'claude-sonnet-4-6';
/** The single shared preview vault id (the IndexedDB store is shared across `?device=` namespaces). */
const PREVIEW_VAULT_ID = 'SelfOS';
const APP_VERSION = '0.0.0-web-preview';

const encode = (value: unknown): Uint8Array =>
  new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);

export interface WebHostOptions {
  /** Injected for tests (fake-indexeddb); production uses the global `indexedDB`. */
  factory?: IDBFactory;
}

/** Build the in-webview `BridgeHost`. Exported for tests; production uses `installRealBridge`. */
export function createWebHost(options: WebHostOptions = {}): BridgeHost {
  const device = currentDeviceId();
  const secrets = webSecretStore(device);
  const deviceStore = webDeviceStore(device);
  const deviceSettings = webDeviceSettings(device);
  const claude = webFakeClaudeClient();

  // Cache one FileSystem per vault id (re-using its IndexedDB connection across ops).
  const fsCache = new Map<string, FileSystem>();
  const fileSystem = (vaultId: string): FileSystem => {
    const existing = fsCache.get(vaultId);
    if (existing) return existing;
    const fs = idbFileSystem(vaultId, options.factory ? { factory: options.factory } : {});
    fsCache.set(vaultId, fs);
    return fs;
  };

  let superAdminActive = false;
  const chatListeners = new Set<(delta: string) => void>();

  const activeVaultId = async (): Promise<string | null> =>
    (await deviceStore.read()).vaultBookmark ?? null;

  const bootState = async (): Promise<BootState> => {
    const id = await activeVaultId();
    if (!id) return { phase: 'onboarding', vaultPath: null, hasSettings: false };
    const fs = fileSystem(id);
    // Presence-only meta check (the preview always writes valid meta) — the Electron host additionally
    // schema-validates via getVaultStatus; corrupt-meta recovery isn't reachable in the in-browser store.
    if (!(await fs.read('.selfos/meta.json'))) {
      return { phase: 'vault-error', vaultPath: id, hasSettings: false };
    }
    return {
      phase: 'ready',
      vaultPath: id,
      hasSettings: (await fs.read('config/settings.json')) !== null,
    };
  };

  /** Create the vault skeleton (meta + empty settings) if absent — idempotent, like the Electron host. */
  const initVault = async (fs: FileSystem): Promise<void> => {
    if (!(await fs.read('.selfos/meta.json'))) {
      const now = new Date().toISOString();
      await fs.writeAtomic(
        '.selfos/meta.json',
        encode({ schemaVersion: 1, vaultId: uuid(), createdAt: now, updatedAt: now }),
      );
    }
    if (!(await fs.read('config/settings.json'))) {
      await fs.writeAtomic('config/settings.json', encode({ schemaVersion: 1, values: {} }));
    }
  };

  return {
    vaultAndKey: async () => {
      const id = await activeVaultId();
      if (!id) return null;
      const key = await loadMasterKey(secrets);
      return key ? { fs: fileSystem(id), key } : null;
    },
    vaultPath: activeVaultId,
    fileSystem,
    secrets,
    claude,
    readDeviceState: () => deviceStore.read(),
    updateDeviceState: (patch) => deviceStore.update(patch),
    readDeviceSettings: () => deviceSettings.read(),
    writeDeviceSettings: (values) => deviceSettings.write(values),
    activeModel: async () => {
      const id = await activeVaultId();
      if (!id) return DEFAULT_MODEL;
      const model = (await readVaultSettingsValues(fileSystem(id)))['ai.model'];
      return typeof model === 'string' ? model : DEFAULT_MODEL;
    },
    isSuperAdminActive: () => superAdminActive,
    setSuperAdminActive: (active) => {
      superAdminActive = active;
    },
    appVersion: APP_VERSION,
    emitChatChunk: (chunk) => {
      for (const listener of chatListeners) listener(chunk);
    },
    getBootState: bootState,
    refreshBootState: bootState,
    // No native picker in the browser — select the single shared preview vault.
    selectVaultFolder: () => Promise.resolve(PREVIEW_VAULT_ID),
    useVault: async (id) => {
      await initVault(fileSystem(id));
      await deviceStore.update({ vaultBookmark: id });
      return bootState();
    },
    getConflicts: () => Promise.resolve([]),
    revealVault: () => Promise.resolve(),
    // No live cross-tab change feed in the preview; reads are always fresh from IndexedDB.
    onVaultChanged: () => () => {},
    onChatChunk: (listener) => {
      chatListeners.add(listener);
      return () => chatListeners.delete(listener);
    },
  };
}

/**
 * Install the real in-webview bridge: the renderer's `window.selfos` is `createCoreBridge` over the web
 * `BridgeHost`, so the UI drives the actual `@selfos/core` logic (replacing the throwaway iii-a stub).
 */
export function installRealBridge(): void {
  window.selfos = createCoreBridge(createWebHost());
}

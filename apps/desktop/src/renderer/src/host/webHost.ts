import { Capacitor } from '@capacitor/core';
import type { BootState } from '@shared/schemas';
import type { ClaudeClient, FileSystem, SecretStore } from '@selfos/core/host';
import { loadMasterKey } from '@selfos/core/crypto';
import { uuid } from '@selfos/core/id';
import { createCoreBridge, readVaultSettingsValues, type BridgeHost } from '@shared/coreBridge';
import { idbFileSystem } from './idbFileSystem';
import { capacitorFileSystem, VaultFs, type VaultFsPlugin } from './capacitorVaultFs';
import { capacitorSecretStore, Keychain, type KeychainPlugin } from './capacitorSecretStore';
import { browserClaudeClient } from './browserClaudeClient';
import {
  currentDeviceId,
  webDeviceSettings,
  webDeviceStore,
  webFakeClaudeClient,
  webSecretStore,
} from './webStores';

/**
 * The **in-webview `BridgeHost`** for the iOS app + web preview (07-mobile-platform §5.3/§5.4). It wires
 * the shared `createCoreBridge` factory's platform primitives to browser/native APIs, so the real
 * `@selfos/core` runs in a WKWebView. One assembly (`createBridgeHost`) over two interchangeable parts:
 *
 * - **Web preview** (iii-b2): an IndexedDB `FileSystem` + a fixed vault id.
 * - **iOS native** (iii-b3): the security-scoped iCloud `VaultFs` plugin + the document picker.
 *
 * Device state + secrets + Claude are the iii-b2 `localStorage`/fake stubs on both (the native iOS
 * Keychain + browser-mode Claude replace them in iii-c). `installRealBridge` picks the part by platform.
 */
const DEFAULT_MODEL = 'claude-sonnet-4-6';
/** The single shared preview vault id (the IndexedDB store is shared across `?device=` namespaces). */
const PREVIEW_VAULT_ID = 'SelfOS';
const APP_VERSION = '0.0.0-web-preview';

const encode = (value: unknown): Uint8Array =>
  new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);

interface HostParts {
  /** Create a `FileSystem` for a vault id/bookmark (uncached — `createBridgeHost` caches per id). */
  makeFileSystem(vaultId: string): FileSystem;
  /** Choose a vault: a fixed id on web, the native folder picker's bookmark on iOS; null if cancelled. */
  selectVaultFolder(): Promise<string | null>;
  /** Device-local secret store: `localStorage` in the web preview, the iOS Keychain on a device. */
  secrets: SecretStore;
  /** Claude client: the deterministic fake in the web preview, the real browser-mode SDK on iOS. */
  claude: ClaudeClient;
}

/** Assemble a `BridgeHost` from interchangeable filesystem/picker/secrets parts (shared by web + iOS). */
function createBridgeHost(parts: HostParts): BridgeHost {
  const device = currentDeviceId();
  const secrets = parts.secrets;
  // Device-state + non-secret device-settings stay in localStorage on both platforms (the bookmark +
  // active person aren't secrets); only the master key / API key move to the Keychain (parts.secrets).
  const deviceStore = webDeviceStore(device);
  const deviceSettings = webDeviceSettings(device);
  const claude = parts.claude;

  // Cache one FileSystem per vault id/bookmark (re-using its connection/scope across ops).
  const fsCache = new Map<string, FileSystem>();
  const fileSystem = (vaultId: string): FileSystem => {
    const existing = fsCache.get(vaultId);
    if (existing) return existing;
    const fs = parts.makeFileSystem(vaultId);
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
    // Presence-only meta check (the host always writes valid meta) — the Electron host additionally
    // schema-validates via getVaultStatus. A throw here (stale iOS bookmark / iCloud gone) also lands
    // on vault-error, routing the user back to re-pick the folder (07-mobile-platform §7).
    try {
      if (!(await fs.read('.selfos/meta.json'))) {
        return { phase: 'vault-error', vaultPath: id, hasSettings: false };
      }
      return {
        phase: 'ready',
        vaultPath: id,
        hasSettings: (await fs.read('config/settings.json')) !== null,
      };
    } catch {
      return { phase: 'vault-error', vaultPath: id, hasSettings: false };
    }
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
    selectVaultFolder: parts.selectVaultFolder,
    useVault: async (id) => {
      await initVault(fileSystem(id));
      await deviceStore.update({ vaultBookmark: id });
      return bootState();
    },
    getConflicts: () => Promise.resolve([]),
    revealVault: () => Promise.resolve(),
    // No live cross-tab/device change feed yet (the NSFilePresenter is iii-b3b); reads are always fresh.
    onVaultChanged: () => () => {},
    onChatChunk: (listener) => {
      chatListeners.add(listener);
      return () => chatListeners.delete(listener);
    },
  };
}

export interface WebHostOptions {
  /** Injected for tests (fake-indexeddb); production uses the global `indexedDB`. */
  factory?: IDBFactory;
}

/** Web-preview host: an IndexedDB vault + a fixed vault id + a `localStorage` secret store. */
export function createWebHost(options: WebHostOptions = {}): BridgeHost {
  return createBridgeHost({
    makeFileSystem: (vaultId) =>
      idbFileSystem(vaultId, options.factory ? { factory: options.factory } : {}),
    selectVaultFolder: () => Promise.resolve(PREVIEW_VAULT_ID),
    secrets: webSecretStore(currentDeviceId()),
    claude: webFakeClaudeClient(),
  });
}

/**
 * iOS host: the native iCloud `VaultFs` plugin + document picker (iii-b3) and the native `Keychain`
 * secret store (iii-c1). Both plugins are injectable for tests; production uses the registered natives.
 */
export function createCapacitorHost(
  vaultFs: VaultFsPlugin = VaultFs,
  keychain: KeychainPlugin = Keychain,
): BridgeHost {
  return createBridgeHost({
    makeFileSystem: (bookmark) => capacitorFileSystem(bookmark, vaultFs),
    selectVaultFolder: async () => {
      try {
        return (await vaultFs.pickFolder()).bookmark;
      } catch {
        // The user cancelled the picker (or it failed) — stay on onboarding rather than erroring.
        return null;
      }
    },
    secrets: capacitorSecretStore(keychain),
    claude: browserClaudeClient(),
  });
}

/**
 * Install the real in-webview bridge: `window.selfos` is `createCoreBridge` over the platform host —
 * the native iOS `VaultFs` host on a device, the IndexedDB web host in a browser preview.
 */
export function installRealBridge(): void {
  const host = Capacitor.isNativePlatform() ? createCapacitorHost() : createWebHost();
  window.selfos = createCoreBridge(host);
}

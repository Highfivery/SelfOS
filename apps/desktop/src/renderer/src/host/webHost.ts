import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import type { BootState } from '@shared/schemas';
import type { ClaudeClient, FileSystem, ImageClient, SecretStore } from '@selfos/core/host';
import { loadMasterKey } from '@selfos/core/crypto';
import { uuid } from '@selfos/core/id';
import { createCoreBridge, readVaultSettingsValues, type BridgeHost } from '@shared/coreBridge';
import { fakeRelayBundle, fakeRelayFetch } from '@shared/relay/fakeRelay';
import { idbFileSystem } from './idbFileSystem';
import { capacitorFileSystem, VaultFs, type VaultFsPlugin } from './capacitorVaultFs';
import { capacitorSecretStore, Keychain, type KeychainPlugin } from './capacitorSecretStore';
import { browserClaudeClient } from './browserClaudeClient';
import { browserImageClient } from './browserImageClient';
import { checkForUpdate } from '@selfos/core/updates';
import {
  currentDeviceId,
  scrubLegacyLocalStorageSecrets,
  webDeviceSettings,
  webDeviceStore,
  webFakeClaudeClient,
  webFakeImageClient,
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
  /** Image client: the deterministic fake in the web preview, the real browser-mode OpenAI call on iOS. */
  image: ImageClient;
  /** Relay transport: the deterministic in-memory fake in the web preview, real HTTPS on iOS. */
  relay: BridgeHost['relay'];
  /** Subscribe to external vault changes; a no-op in the web preview, the native watcher on iOS. */
  onVaultChanged(listener: () => void): () => void;
  /**
   * Sync-conflict copies for the active vault (33-multi-device-housekeeping §5.C) — `[]` in the web preview
   * (no real sync), the native `VaultFs.findConflicts` on iOS. Receives the active vault id/bookmark.
   */
  getConflicts?(vaultId: string): Promise<string[]>;
  /** Whether the vault folder still has not-yet-downloaded iCloud items (33 §5.D); the native check on iOS. */
  hasPendingDownloads?(vaultId: string): Promise<boolean>;
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

  const chatListeners = new Set<(delta: string) => void>();
  const dreamListeners = new Set<(delta: string) => void>();
  const intakeListeners = new Set<(delta: string) => void>();
  const togetherListeners = new Set<(delta: string) => void>();

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
    image: parts.image,
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
    appVersion: APP_VERSION,
    // Native (Capacitor) → iOS; otherwise the browser preview → web. The titlebar renders no window
    // controls on either (02-app-shell §13.2).
    platform: Capacitor.isNativePlatform() ? 'ios' : 'web',
    relay: parts.relay,
    emitChatChunk: (chunk) => {
      for (const listener of chatListeners) listener(chunk);
    },
    emitDreamChunk: (chunk) => {
      for (const listener of dreamListeners) listener(chunk);
    },
    emitIntakeChunk: (chunk) => {
      for (const listener of intakeListeners) listener(chunk);
    },
    emitTogetherChunk: (chunk) => {
      for (const listener of togetherListeners) listener(chunk);
    },
    getBootState: bootState,
    refreshBootState: bootState,
    selectVaultFolder: parts.selectVaultFolder,
    useVault: async (id) => {
      await initVault(fileSystem(id));
      await deviceStore.update({ vaultBookmark: id });
      return bootState();
    },
    getConflicts: async () => {
      const id = await activeVaultId();
      return id && parts.getConflicts ? parts.getConflicts(id) : [];
    },
    hasPendingDownloads: async () => {
      const id = await activeVaultId();
      return id && parts.hasPendingDownloads ? parts.hasPendingDownloads(id) : false;
    },
    revealVault: () => Promise.resolve(),
    openExternal: (url) => {
      window.open(url, '_blank', 'noopener,noreferrer');
      return Promise.resolve();
    },
    checkForUpdate: () =>
      checkForUpdate({
        fetch: (input, init) => globalThis.fetch(input, init),
        currentVersion: APP_VERSION,
        now: new Date().toISOString(),
      }),
    // Export = a browser download (web preview) / share-sheet (iOS, later). No native save dialog here.
    saveImageFile: (suggestedName, bytes, mime) => {
      // Copy into a plain ArrayBuffer — a Uint8Array<ArrayBufferLike> isn't a BlobPart under the DOM lib.
      const buffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buffer).set(bytes);
      const blob = new Blob([buffer], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = suggestedName;
      a.click();
      URL.revokeObjectURL(url);
      return Promise.resolve(suggestedName);
    },
    // PDF rendering uses Electron's offscreen printToPDF — not available on the web/iOS host (§3.9).
    printToPdf: () => Promise.resolve(null),
    onVaultChanged: parts.onVaultChanged,
    onChatChunk: (listener) => {
      chatListeners.add(listener);
      return () => chatListeners.delete(listener);
    },
    onDreamChunk: (listener) => {
      dreamListeners.add(listener);
      return () => dreamListeners.delete(listener);
    },
    onIntakeChunk: (listener) => {
      intakeListeners.add(listener);
      return () => intakeListeners.delete(listener);
    },
    onTogetherChunk: (listener) => {
      togetherListeners.add(listener);
      return () => togetherListeners.delete(listener);
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
    image: webFakeImageClient(),
    // A deterministic in-memory relay so the preview can demo the external-send flow (no Cloudflare).
    relay: { fetch: fakeRelayFetch(), loadBundle: fakeRelayBundle, currentVersion: '1' },
    // The browser preview has no cross-tab/device change feed; reads are always fresh on navigation.
    onVaultChanged: () => () => {},
  });
}

/**
 * Live vault-change subscription on iOS (iii-b3b): start the native `VaultFs` watcher on the active
 * vault and forward its `vaultChanged` events; the returned cleanup stops the watch + removes the
 * listener. (Setup is async; the cleanup is safe to call before it completes.)
 */
function watchCapacitorVault(vaultFs: VaultFsPlugin, listener: () => void): () => void {
  let handle: PluginListenerHandle | undefined;
  let watching = false;
  let cancelled = false;
  void (async () => {
    const bookmark = (await webDeviceStore(currentDeviceId()).read()).vaultBookmark;
    if (!bookmark || cancelled) return;
    handle = await vaultFs.addListener('vaultChanged', listener);
    if (cancelled) {
      void handle.remove();
      return;
    }
    await vaultFs.startWatch({ bookmark });
    if (cancelled) {
      void vaultFs.stopWatch();
      void handle.remove();
      return;
    }
    watching = true;
  })();
  return () => {
    cancelled = true;
    void handle?.remove();
    if (watching) void vaultFs.stopWatch();
  };
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
    image: browserImageClient(),
    // iOS issues real outbound HTTPS for the Cloudflare REST API + the deployed Worker (07 §11.1).
    // The Worker bundle isn't shipped in the iOS app yet, so deploy throws until that's wired.
    relay: {
      fetch: (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
        globalThis.fetch(input, init),
      loadBundle: () => Promise.reject(new Error('Relay deploy is not available on iOS yet.')),
      currentVersion: '1',
    },
    onVaultChanged: (listener) => watchCapacitorVault(vaultFs, listener),
    getConflicts: (bookmark) =>
      vaultFs
        .findConflicts({ bookmark })
        .then((r) => r.conflicts)
        .catch(() => []),
    hasPendingDownloads: (bookmark) =>
      vaultFs
        .hasPendingDownloads({ bookmark })
        .then((r) => r.pending)
        .catch(() => false),
  });
}

/**
 * Install the real in-webview bridge: `window.selfos` is `createCoreBridge` over the platform host —
 * the native iOS `VaultFs` host on a device, the IndexedDB web host in a browser preview.
 */
export function installRealBridge(): void {
  if (Capacitor.isNativePlatform()) {
    // iOS keeps secrets in the Keychain — drop any legacy master key / API key left in localStorage
    // by the pre-iii-c1 stub (lower-protection storage). Web preview keeps its localStorage secrets.
    scrubLegacyLocalStorageSecrets();
    window.selfos = createCoreBridge(createCapacitorHost());
    return;
  }
  window.selfos = createCoreBridge(createWebHost());
}

import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { FileSystem } from '@selfos/core/host';
import { fromBase64, toBase64 } from '@selfos/core/encoding';

/**
 * TS side of the native **`VaultFs`** Capacitor plugin (07-mobile-platform §5.4, slice iii-b3): the iOS
 * security-scoped iCloud-Drive filesystem. The renderer holds an opaque **security-scoped bookmark**
 * (a base64 blob the picker mints) and passes it to every call; Swift resolves it, brackets the op in
 * `start/stopAccessingSecurityScopedResource`, and coordinates I/O via `NSFileCoordinator`. Bytes cross
 * the JSON bridge base64-encoded (the core `FileSystem` contract is `Uint8Array`).
 */
export interface PickFolderResult {
  /** Opaque security-scoped bookmark (base64) to persist device-local and pass back to each op. */
  bookmark: string;
  /** The chosen folder's display name (for UI). */
  name: string;
}

export interface VaultFsPlugin {
  /** Present the iOS open-directory picker; resolve the chosen folder's bookmark + name. */
  pickFolder(): Promise<PickFolderResult>;
  /** Read a vault-relative file's bytes (base64), or `data: null` if it does not exist. */
  read(options: { bookmark: string; path: string }): Promise<{ data: string | null }>;
  /** Write bytes (base64) atomically (temp-file + coordinated rename), creating parent dirs. */
  writeAtomic(options: { bookmark: string; path: string; data: string }): Promise<void>;
  /** Immediate child names under a vault-relative dir; `entries: []` if absent. */
  list(options: { bookmark: string; path: string }): Promise<{ entries: string[] }>;
  /** Remove a vault-relative file or directory (recursively); a no-op if absent. */
  remove(options: { bookmark: string; path: string }): Promise<void>;
  /** Begin observing the vault for changes (incl. iCloud syncs); emits `vaultChanged` events (iii-b3b). */
  startWatch(options: { bookmark: string }): Promise<void>;
  /** Stop observing the vault. */
  stopWatch(): Promise<void>;
  /** Subscribe to vault-change events fired by `startWatch`. */
  addListener(eventName: 'vaultChanged', listenerFunc: () => void): Promise<PluginListenerHandle>;
}

export const VaultFs = registerPlugin<VaultFsPlugin>('VaultFs');

/**
 * A core `FileSystem` over the native `VaultFs` plugin, bound to one resolved vault bookmark. `plugin`
 * is injectable for tests; production uses the registered native plugin.
 */
export function capacitorFileSystem(bookmark: string, plugin: VaultFsPlugin = VaultFs): FileSystem {
  return {
    async read(path) {
      const { data } = await plugin.read({ bookmark, path });
      return data === null ? null : fromBase64(data);
    },
    async writeAtomic(path, data) {
      await plugin.writeAtomic({ bookmark, path, data: toBase64(data) });
    },
    async list(path) {
      return (await plugin.list({ bookmark, path })).entries;
    },
    async remove(path) {
      await plugin.remove({ bookmark, path });
    },
  };
}

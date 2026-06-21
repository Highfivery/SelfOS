// @vitest-environment node
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VaultFsPlugin } from './capacitorVaultFs';
import { createCapacitorHost, createWebHost } from './webHost';

// A minimal in-memory localStorage (node env has none); the web stores read/write it. A fresh
// IDBFactory is injected per test so cross-test open connections can't deadlock the shared DB. node
// env (not jsdom) because fake-indexeddb's transaction scheduler relies on setImmediate.
function installLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, String(value)),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
  return store;
}

let storage: Map<string, string>;
let factory: IDBFactory;
beforeEach(() => {
  storage = installLocalStorage();
  factory = new IDBFactory();
});

const decodeMeta = (bytes: Uint8Array | null): { vaultId: string } | null =>
  bytes ? (JSON.parse(new TextDecoder().decode(bytes)) as { vaultId: string }) : null;

describe('createWebHost', () => {
  it('boots to onboarding when no vault is selected', async () => {
    expect(await createWebHost({ factory }).getBootState()).toEqual({
      phase: 'onboarding',
      vaultPath: null,
      hasSettings: false,
    });
  });

  it('reports vault-error when a bookmark is set but the vault has no meta', async () => {
    storage.set(
      'selfos:A:deviceState',
      JSON.stringify({ schemaVersion: 1, vaultPath: null, vaultBookmark: 'ghost' }),
    );
    expect((await createWebHost({ factory }).getBootState()).phase).toBe('vault-error');
  });

  it('useVault initializes the vault skeleton and boots ready', async () => {
    const host = createWebHost({ factory });
    expect(await host.useVault('SelfOS')).toMatchObject({
      phase: 'ready',
      vaultPath: 'SelfOS',
      hasSettings: true,
    });
    expect((await host.readDeviceState()).vaultBookmark).toBe('SelfOS');
    expect((await host.getBootState()).phase).toBe('ready');
  });

  it('initVault is idempotent — re-selecting keeps the same vault meta', async () => {
    const host = createWebHost({ factory });
    await host.useVault('SelfOS');
    const first = decodeMeta(await host.fileSystem('SelfOS').read('.selfos/meta.json'));
    await host.useVault('SelfOS');
    const second = decodeMeta(await host.fileSystem('SelfOS').read('.selfos/meta.json'));
    expect(first?.vaultId).toBeTruthy();
    expect(second?.vaultId).toBe(first?.vaultId);
  });
});

function fakePlugin(overrides: Partial<VaultFsPlugin> = {}): VaultFsPlugin {
  return {
    pickFolder: vi.fn(() => Promise.resolve({ bookmark: 'bm-xyz', name: 'SelfOS' })),
    read: vi.fn(() => Promise.resolve({ data: null })),
    writeAtomic: vi.fn(() => Promise.resolve()),
    list: vi.fn(() => Promise.resolve({ entries: [] })),
    remove: vi.fn(() => Promise.resolve()),
    startWatch: vi.fn(() => Promise.resolve()),
    findConflicts: vi.fn(() => Promise.resolve({ conflicts: [] })),
    hasPendingDownloads: vi.fn(() => Promise.resolve({ pending: false })),
    stopWatch: vi.fn(() => Promise.resolve()),
    addListener: vi.fn(() => Promise.resolve({ remove: () => Promise.resolve() })),
    ...overrides,
  };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('createCapacitorHost', () => {
  it('selectVaultFolder returns the picked folder bookmark', async () => {
    const host = createCapacitorHost(fakePlugin());
    expect(await host.selectVaultFolder()).toBe('bm-xyz');
  });

  it('selectVaultFolder returns null when the picker is cancelled or fails', async () => {
    const host = createCapacitorHost(
      fakePlugin({ pickFolder: () => Promise.reject(new Error('cancelled')) }),
    );
    expect(await host.selectVaultFolder()).toBeNull();
  });

  it('getConflicts surfaces the native VaultFs conflicts for the active vault (29 §5.C)', async () => {
    storage.set(
      'selfos:A:deviceState',
      JSON.stringify({ schemaVersion: 1, vaultPath: null, vaultBookmark: 'bm' }),
    );
    const plugin = fakePlugin({
      findConflicts: vi.fn(() =>
        Promise.resolve({ conflicts: ['journal (conflicted copy 2026-06-21).enc'] }),
      ),
    });
    const host = createCapacitorHost(plugin);
    expect(await host.getConflicts()).toEqual(['journal (conflicted copy 2026-06-21).enc']);
    expect(plugin.findConflicts).toHaveBeenCalledWith({ bookmark: 'bm' });
  });

  it('getConflicts returns [] when no vault is selected', async () => {
    expect(await createCapacitorHost(fakePlugin()).getConflicts()).toEqual([]);
  });

  it('onVaultChanged starts the native watch + forwards events; cleanup stops it', async () => {
    storage.set(
      'selfos:A:deviceState',
      JSON.stringify({ schemaVersion: 1, vaultPath: null, vaultBookmark: 'bm' }),
    );
    const remove = vi.fn(() => Promise.resolve());
    let fire: () => void = () => {};
    const plugin = fakePlugin({
      addListener: vi.fn((_event, cb) => {
        fire = cb;
        return Promise.resolve({ remove });
      }),
    });
    const fired: number[] = [];
    const cleanup = createCapacitorHost(plugin).onVaultChanged(() => fired.push(1));
    await flush();
    expect(plugin.startWatch).toHaveBeenCalledWith({ bookmark: 'bm' });
    fire();
    expect(fired).toHaveLength(1);
    cleanup();
    await flush();
    expect(plugin.stopWatch).toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
  });

  it('onVaultChanged does not watch when no vault is selected', async () => {
    const plugin = fakePlugin();
    createCapacitorHost(plugin).onVaultChanged(() => {});
    await flush();
    expect(plugin.startWatch).not.toHaveBeenCalled();
  });
});

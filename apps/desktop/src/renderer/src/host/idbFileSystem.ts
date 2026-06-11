import type { FileSystem } from '@selfos/core/host';

/**
 * An IndexedDB-backed `FileSystem` host (07-mobile-platform §5.3, slice iii-b2) for the **web preview**
 * of the iOS app — a real, persistent in-browser filesystem so the same `@selfos/core` business logic
 * (via `createCoreBridge`) can be exercised in a browser before the native Swift `VaultFs` plugin
 * (iii-b3). One object store keyed by `"<vaultId>/<vault-relative POSIX path>"` → the file bytes. The
 * store is shared across `?device=` namespaces, so two tabs act as two devices sharing one vault.
 *
 * This is preview/dev scaffolding for a built feature (the shared vault), not a shipped capability; the
 * real iOS filesystem is the security-scoped iCloud plugin in iii-b3.
 */
const DB_NAME = 'selfos-preview-vault';
const STORE = 'files';

export interface IdbFileSystemOptions {
  /** Injected for tests (fake-indexeddb); defaults to the global `indexedDB`. */
  factory?: IDBFactory;
  /** Called after each successful write/remove with the vault-relative path (for change notification). */
  onWrite?: (path: string) => void;
}

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'));
  });
}

/** Run a single keyed request inside a transaction, resolving with its result. */
function request<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const result = run(transaction.objectStore(STORE));
    result.onsuccess = () => resolve(result.result);
    result.onerror = () => reject(result.error ?? new Error('indexedDB request failed'));
  });
}

export function idbFileSystem(vaultId: string, options: IdbFileSystemOptions = {}): FileSystem {
  const factory = options.factory ?? globalThis.indexedDB;
  const dbPromise = openDb(factory);
  const prefix = `${vaultId}/`;
  const keyOf = (path: string): string => `${prefix}${path}`;

  const allKeys = async (): Promise<string[]> => {
    const db = await dbPromise;
    const keys = await request<IDBValidKey[]>(db, 'readonly', (store) => store.getAllKeys());
    return keys.filter((key): key is string => typeof key === 'string');
  };

  return {
    async read(path) {
      const db = await dbPromise;
      const value = await request<unknown>(db, 'readonly', (store) => store.get(keyOf(path)));
      if (value === undefined || value === null) return null;
      if (value instanceof Uint8Array) return value;
      if (value instanceof ArrayBuffer) return new Uint8Array(value);
      throw new Error(`idbFileSystem: unexpected stored value for ${path}`);
    },
    async writeAtomic(path, data) {
      const db = await dbPromise;
      // IndexedDB writes commit atomically per transaction — no temp-file + rename needed. Store a
      // tight copy so we don't retain a view into a larger buffer.
      await request(db, 'readwrite', (store) => store.put(data.slice(), keyOf(path)));
      options.onWrite?.(path);
    },
    async list(dir) {
      const dirPrefix = `${keyOf(dir)}/`;
      const names = new Set<string>();
      for (const key of await allKeys()) {
        if (!key.startsWith(dirPrefix)) continue;
        const name = key.slice(dirPrefix.length).split('/')[0];
        if (name) names.add(name);
      }
      return [...names];
    },
    async remove(path) {
      const db = await dbPromise;
      const target = keyOf(path);
      const childPrefix = `${target}/`;
      const toDelete = (await allKeys()).filter(
        (key) => key === target || key.startsWith(childPrefix),
      );
      if (toDelete.length > 0) {
        // Delete the file + its whole subtree in ONE transaction, so a directory removal is atomic.
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction(STORE, 'readwrite');
          const store = transaction.objectStore(STORE);
          for (const key of toDelete) store.delete(key);
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error ?? new Error('idb remove failed'));
        });
      }
      options.onWrite?.(path);
    },
  };
}

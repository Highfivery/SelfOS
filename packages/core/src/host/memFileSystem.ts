import type { FileSystem } from './fileSystem';

/**
 * In-memory `FileSystem` for platform-agnostic core tests (07-mobile-platform §10) — no node, no disk.
 * Mirrors the host contract: `read` → null when absent, `list` → immediate child names (files + dirs),
 * `remove` deletes a file or a directory (by path prefix), `writeAtomic` stores bytes verbatim.
 *
 * Limitation: directory entries are derived from file keys, so an empty or sub-dirs-only directory is
 * invisible to `list` (the real host would return it). Fine for the current services — every `list`
 * caller filters by a `.enc` file-name suffix — but a future dir-of-dirs lister would need a real host.
 */
export function memFileSystem(): FileSystem {
  const files = new Map<string, Uint8Array>();
  return {
    read: (path) => Promise.resolve(files.get(path) ?? null),
    writeAtomic: (path, data) => {
      files.set(path, data);
      return Promise.resolve();
    },
    list: (dir) => {
      const prefix = `${dir}/`;
      const names = new Set<string>();
      for (const key of files.keys()) {
        if (!key.startsWith(prefix)) continue;
        const name = key.slice(prefix.length).split('/')[0];
        if (name) names.add(name);
      }
      return Promise.resolve([...names]);
    },
    remove: (path) => {
      files.delete(path);
      const prefix = `${path}/`;
      for (const key of [...files.keys()]) if (key.startsWith(prefix)) files.delete(key);
      return Promise.resolve();
    },
  };
}
